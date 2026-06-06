/**
 * Visual Components — TypeBox schemas and derived types.
 *
 * Schemas are the source of truth. Types are derived via `Static<typeof Schema>`.
 * No parallel TypeScript interfaces — schema definitions ARE the contract.
 *
 * Architecture source: Contribution #619 §2
 * Constraint #269: This file must NOT import from editor/ or editor-store/.
 */

import { Type, type Static, withFallback } from '@core/utils/typeboxHelpers'
import { BaseNodeSchema, NodeTreeSchema, type BaseNode, parsePropBindings, reindexNodeParents } from '@core/page-tree'

// ---------------------------------------------------------------------------
// VCParamType — valid param type values
// ---------------------------------------------------------------------------

const VCParamTypeSchema = Type.Union([
  Type.Literal('string'),
  Type.Literal('number'),
  Type.Literal('boolean'),
  Type.Literal('url'),
  Type.Literal('enum'),
  Type.Literal('color'),
  Type.Literal('image'),
  Type.Literal('richText'),
  Type.Literal('slot'),
])

export type VCParamType = Static<typeof VCParamTypeSchema>

const VC_PARAM_TYPE_VALUES: VCParamType[] = [
  'string', 'number', 'boolean', 'url', 'enum', 'color', 'image', 'richText', 'slot',
]

// ---------------------------------------------------------------------------
// VCNode — a node inside a Visual Component tree (structurally identical to BaseNode)
//
// VCNode uses the same flat-map structure as PageNode.
// The VC tree is stored as a NodeTree<VCNode> = { nodes: Record<string, VCNode>, rootNodeId }.
// Unlike PageNode, VCNode carries no `dynamicBindings` — that field is exclusive
// to CMS template pages.
// ---------------------------------------------------------------------------

/**
 * A node inside a Visual Component tree.
 *
 * Structurally identical to BaseNode — no nested child objects, no
 * `dynamicBindings`. The VC tree uses the same flat-map shape as Page.nodes,
 * stored in VisualComponent.tree: NodeTree<VCNode>.
 */
export const VCNodeSchema = BaseNodeSchema
export type VCNode = BaseNode

// ---------------------------------------------------------------------------
// VCParam — a named parameter on a Visual Component
// ---------------------------------------------------------------------------

const VCParamSchema = Type.Object({
  /** Stable ID — generated with nanoid(); survives param renames */
  id: Type.String(),
  /** Free-form name; uniqueness within the VC is validated at the slice boundary */
  name: Type.String(),
  /** Param type — unknown values fall back to 'string' in the parser helper */
  type: withFallback(VCParamTypeSchema, 'string' as const),
  /** Optional human-readable description shown in the Properties Panel */
  description: Type.Optional(Type.String()),
  defaultValue: Type.Unknown(),
  required: Type.Boolean(),
  /** Only meaningful when type === 'enum' — non-string items are silently dropped */
  enumOptions: Type.Optional(Type.Array(Type.String())),
})

export type VCParam = Static<typeof VCParamSchema>

/**
 * Tolerant parser for a single VCParam. Handles:
 *   - type fallback to 'string' for unknown values
 *   - enumOptions preprocessing: filter to strings only, absent → undefined
 *   - required fallback to false
 *   - defaultValue fallback to ''
 * Returns null for structurally invalid entries (missing id or name).
 */
function parseVCParam(raw: unknown): VCParam | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.name !== 'string') return null

  const type: VCParamType = VC_PARAM_TYPE_VALUES.includes(r.type as VCParamType)
    ? (r.type as VCParamType)
    : 'string'

  const enumOptions = Array.isArray(r.enumOptions)
    ? r.enumOptions.filter((x): x is string => typeof x === 'string')
    : undefined

  return {
    id: r.id,
    name: r.name,
    type,
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    defaultValue: r.defaultValue !== undefined ? r.defaultValue : '',
    required: typeof r.required === 'boolean' ? r.required : false,
    ...(enumOptions !== undefined ? { enumOptions } : {}),
  }
}

// ---------------------------------------------------------------------------
// parseVCNode — tolerant flat VCNode parser
//
// Replicates the Zod .catch() fallback behaviour for fields that use
// withFallback() in BaseNodeSchema (props, breakpointOverrides, classIds).
// Required by parseVisualComponent to handle persisted data where nodes
// may have been stored without classIds or other optional-with-fallback fields.
// ---------------------------------------------------------------------------

/**
 * Tolerant parser for a single VCNode (used by parseVisualComponent).
 *
 * Unlike strict schema validation, this function handles:
 *   - Missing classIds → default []
 *   - Missing/invalid props → default {}
 *   - Missing/invalid breakpointOverrides → default {}
 *   - propBindings: per-entry filtered via parsePropBindings
 *
 * Returns null when required fields (id, moduleId, children) are invalid.
 * VCNode is a flat node in a flat-map tree (no recursive nesting).
 */
function parseVCNode(raw: unknown): VCNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.moduleId !== 'string') return null
  if (!Array.isArray(r.children)) return null

  const props: Record<string, unknown> =
    r.props && typeof r.props === 'object' && !Array.isArray(r.props)
      ? (r.props as Record<string, unknown>)
      : {}

  const breakpointOverrides: Record<string, Record<string, unknown>> =
    r.breakpointOverrides && typeof r.breakpointOverrides === 'object' && !Array.isArray(r.breakpointOverrides)
      ? (r.breakpointOverrides as Record<string, Record<string, unknown>>)
      : {}

  const children = r.children.filter((c): c is string => typeof c === 'string')

  const classIds = Array.isArray(r.classIds)
    ? r.classIds.filter((c): c is string => typeof c === 'string')
    : []

  const propBindings = parsePropBindings(r.propBindings)

  const inlineStyles =
    r.inlineStyles && typeof r.inlineStyles === 'object' && !Array.isArray(r.inlineStyles)
      ? (r.inlineStyles as Record<string, unknown>)
      : {}

  return {
    id: r.id,
    moduleId: r.moduleId,
    props,
    breakpointOverrides,
    children,
    classIds,
    ...(typeof r.label === 'string' ? { label: r.label } : {}),
    ...(typeof r.locked === 'boolean' ? { locked: r.locked } : {}),
    ...(typeof r.hidden === 'boolean' ? { hidden: r.hidden } : {}),
    ...(propBindings !== undefined ? { propBindings } : {}),
    ...(Object.keys(inlineStyles).length > 0 ? { inlineStyles } : {}),
  }
}

// ---------------------------------------------------------------------------
// VisualComponent — top-level VC document
// ---------------------------------------------------------------------------

/**
 * TypeBox schema for a VisualComponent in memory.
 *
 * The VC tree is stored as a flat NodeTree (same shape as Page.nodes) in the
 * `tree` field: { nodes: Record<string, VCNode>, rootNodeId: string }.
 *
 * Storage is in `data_rows` where `table_id = 'components'`. The adapter
 * `visualComponentFromRow` / `visualComponentToCells` in
 * `@core/data/componentFromRow` handles the round-trip.
 *
 * For tolerant parsing, use `parseVisualComponent` instead of
 * `parseValue(VisualComponentSchema, raw)`.
 *
 * Naming invariants (enforced by validateComponentName at write boundaries):
 *   - Non-empty (whitespace-only is rejected; trimmed before storage)
 *   - Unique within the site
 *
 * NOTE: `breakpoints` was removed — VCs always use the site's breakpoint set
 * (`site.breakpoints`). Storing a duplicate per-VC was dead weight: nothing
 * read `vc.breakpoints` — all publisher and editor breakpoint usage went
 * through `site.breakpoints`. Dropped in the Step 4 unified-content-storage
 * refactor (2026-05-19).
 */
export const VisualComponentSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String({ minLength: 1 }),
  /** Flat node tree — same shape as Page.nodes + rootNodeId. */
  tree: Type.Object({
    ...NodeTreeSchema.properties,
    nodes: Type.Record(Type.String(), VCNodeSchema),
  }),
  params: Type.Array(VCParamSchema),
  classIds: Type.Array(Type.String()),
  /** Falls back to Date.now() for missing or non-numeric values — handled by parser */
  createdAt: Type.Number(),
})

export type VisualComponent = Static<typeof VisualComponentSchema>

/**
 * Tolerant parser for a VisualComponent. Handles:
 *   - tree.nodes: parsed via parseVCNode (tolerant, handles missing classIds etc.)
 *   - tree.rootNodeId: required string; VC is dropped if invalid
 *   - params: silently drops items that fail parseVCParam
 *   - breakpoints: silently drops items with empty id
 *   - createdAt: falls back to Date.now() for missing/invalid timestamps
 *
 * Returns null when required fields (id, name, tree.rootNodeId) are invalid or
 * when rootNodeId is not found in the parsed nodes map.
 */
export function parseVisualComponent(raw: unknown): VisualComponent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0) return null
  if (typeof r.name !== 'string' || r.name.length === 0) return null

  // Parse tree: { rootNodeId, nodes }
  if (!r.tree || typeof r.tree !== 'object' || Array.isArray(r.tree)) return null
  const rawTree = r.tree as Record<string, unknown>
  if (typeof rawTree.rootNodeId !== 'string' || rawTree.rootNodeId.length === 0) return null
  if (!rawTree.nodes || typeof rawTree.nodes !== 'object' || Array.isArray(rawTree.nodes)) return null

  const rawNodes = rawTree.nodes as Record<string, unknown>
  const nodes: Record<string, VCNode> = {}
  for (const [_nodeId, rawNode] of Object.entries(rawNodes)) {
    const node = parseVCNode(rawNode)
    if (node) nodes[node.id] = node
  }

  // Root node must exist in the parsed map
  if (!nodes[rawTree.rootNodeId]) return null

  const params = Array.isArray(r.params)
    ? r.params.flatMap((item) => {
        const p = parseVCParam(item)
        return p ? [p] : []
      })
    : []

  const classIds = Array.isArray(r.classIds)
    ? r.classIds.filter((x): x is string => typeof x === 'string')
    : []

  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now()

  // Derive the parentId index from the children arrays — never trust a stored
  // parentId value. Backfills VC trees persisted before this field existed.
  reindexNodeParents(nodes)

  return {
    id: r.id,
    name: r.name,
    tree: { nodes, rootNodeId: rawTree.rootNodeId },
    params,
    classIds,
    createdAt,
  }
}
