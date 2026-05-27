/**
 * Pure helpers for inspecting a `SiteSnapshot` from server-side
 * read tools.
 *
 * Ported from `server/handlers/agent/tools.ts` (the old MCP impl). Behaviour
 * is identical — only the input snapshot type and surrounding registration
 * code changed. Anything resembling SDK-specific glue has been left in the
 * driver layer.
 */

import type {
  ClassInfo,
  NodeInfo,
  ModuleInfo,
  SiteSnapshot,
} from './snapshot'

const TEXT_PREVIEW_KEYS = ['text', 'label', 'title', 'heading', 'content', 'caption', 'alt']
const TEXT_PREVIEW_MAX_LENGTH = 80

// ---------------------------------------------------------------------------
// search_nodes
// ---------------------------------------------------------------------------

export interface SearchNodesArgs {
  query?: string
  moduleId?: string
  classId?: string
  className?: string
  limit?: number
}

export function searchPageNodes(
  snap: SiteSnapshot,
  args: SearchNodesArgs,
): { nodes: SearchNodeResult[] } {
  const query = args.query?.trim().toLowerCase()
  const classId = args.classId?.trim()
  const className = args.className?.trim().toLowerCase()
  const limit = args.limit ?? 25
  const classNameMatches = className
    ? new Set(snap.classes
      .filter((cls) => cls.name.toLowerCase().includes(className))
      .map((cls) => cls.id))
    : null

  const nodes = snap.nodes
    .filter((node) => {
      if (args.moduleId && node.moduleId !== args.moduleId) return false
      if (classId && !node.classIds.includes(classId)) return false
      if (classNameMatches && !node.classIds.some((id) => classNameMatches.has(id))) return false
      if (!query) return true

      const classNames = node.classIds
        .map((id) => snap.classes.find((cls) => cls.id === id)?.name ?? '')
        .join(' ')
      const haystack = [
        node.id,
        node.moduleId,
        node.label ?? '',
        classNames,
        ...Object.values(node.props).map((value) => stringifySearchValue(value)),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice(0, limit)
    .map((node): SearchNodeResult => ({
      id: node.id,
      moduleId: node.moduleId,
      label: node.label,
      parentId: node.parentId,
      childCount: node.children.length,
      classIds: node.classIds,
      classNames: node.classIds.map((id) =>
        snap.classes.find((cls) => cls.id === id)?.name ?? id),
      text: Object.entries(node.props)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}: ${value}`)
        .join('; '),
    }))

  return { nodes }
}

export interface SearchNodeResult {
  id: string
  moduleId: string
  label?: string
  parentId: string | null
  childCount: number
  classIds: string[]
  classNames: string[]
  text: string
}

// ---------------------------------------------------------------------------
// inspect_node
// ---------------------------------------------------------------------------

export interface InspectNodeArgs {
  nodeId: string
  breakpointId?: string
  /** How deep to walk descendants. Default 5; pass 0 for no descendants. */
  maxDepth?: number
}

interface DescendantNode {
  id: string
  moduleId: string
  label?: string
  classIds: string[]
  classNames: string[]
  childCount: number
  textPreview?: string
  children: DescendantNode[]
}

export function inspectPageNode(
  snap: SiteSnapshot,
  args: InspectNodeArgs,
) {
  const node = snap.nodes.find((item) => item.id === args.nodeId)
  if (!node) return { node: null, error: `Node not found: ${args.nodeId}` }

  const breakpointId = args.breakpointId ?? snap.activeBreakpointId
  const resolvedProps = resolveNodeProps(node, breakpointId, snap.availableModules)
  const classes = node.classIds.map((classId) => {
    const cls = snap.classes.find((item) => item.id === classId)
    if (!cls) return { id: classId, missing: true }
    const breakpointStyles = cls.breakpointStyles?.[breakpointId] ?? {}
    return {
      id: cls.id,
      name: cls.name,
      styles: cls.styles ?? {},
      breakpointStyles,
      resolvedStyles: {
        ...(cls.styles ?? {}),
        ...breakpointStyles,
      },
    }
  })

  const maxDepth = Math.max(0, args.maxDepth ?? 5)
  const descendants = buildDescendantTree(snap, node.children, 1, maxDepth)

  return {
    node: {
      ...node,
      breakpointId,
      resolvedProps,
      classes,
      resolvedClassStyles: mergeResolvedClassStyles(classes),
      descendants,
    },
  }
}

function buildDescendantTree(
  snap: SiteSnapshot,
  childIds: string[],
  depth: number,
  maxDepth: number,
): DescendantNode[] {
  if (depth > maxDepth || childIds.length === 0) return []
  const nodes: DescendantNode[] = []
  for (const id of childIds) {
    const child = snap.nodes.find((node) => node.id === id)
    if (!child) continue
    nodes.push({
      id: child.id,
      moduleId: child.moduleId,
      label: child.label,
      classIds: child.classIds,
      classNames: child.classIds.map((classId) =>
        snap.classes.find((cls) => cls.id === classId)?.name ?? classId),
      childCount: child.children.length,
      textPreview: extractTextPreview(child.props),
      children: buildDescendantTree(snap, child.children, depth + 1, maxDepth),
    })
  }
  return nodes
}

function extractTextPreview(props: Record<string, unknown>): string | undefined {
  for (const key of TEXT_PREVIEW_KEYS) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) {
      return truncate(value)
    }
  }
  for (const value of Object.values(props)) {
    if (typeof value === 'string' && value.trim()) {
      return truncate(value)
    }
  }
  return undefined
}

function truncate(text: string): string {
  if (text.length <= TEXT_PREVIEW_MAX_LENGTH) return text
  return `${text.slice(0, TEXT_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
}

// ---------------------------------------------------------------------------
// inspect_class
// ---------------------------------------------------------------------------

export interface InspectClassArgs {
  classId: string
  breakpointId?: string
}

export function inspectPageClass(
  snap: SiteSnapshot,
  args: InspectClassArgs,
) {
  const cls = snap.classes.find(
    (item) => item.id === args.classId || item.name === args.classId,
  )
  if (!cls) return { class: null, error: `Class not found: ${args.classId}` }

  const breakpointId = args.breakpointId ?? snap.activeBreakpointId
  const breakpointStyles = cls.breakpointStyles?.[breakpointId] ?? {}
  const assignedNodes = snap.nodes
    .filter((node) => node.classIds.includes(cls.id))
    .map((node) => ({
      id: node.id,
      moduleId: node.moduleId,
      label: node.label,
      parentId: node.parentId,
    }))

  return {
    class: {
      id: cls.id,
      name: cls.name,
      breakpointId,
      styles: cls.styles ?? {},
      breakpointStyles,
      resolvedStyles: {
        ...(cls.styles ?? {}),
        ...breakpointStyles,
      },
      assignedNodes,
    },
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveNodeProps(
  node: NodeInfo,
  breakpointId: string,
  modules: ModuleInfo[],
): Record<string, unknown> {
  const override = node.breakpointOverrides[breakpointId]
  if (!override || Object.keys(override).length === 0) return node.props
  const moduleDef = modules.find((m) => m.id === node.moduleId)
  if (!moduleDef) return { ...node.props, ...override }
  const overridable = new Set(
    moduleDef.props.filter((p) => p.breakpointOverridable === true).map((p) => p.key),
  )
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(override)) {
    if (overridable.has(key)) filtered[key] = value
  }
  if (Object.keys(filtered).length === 0) return node.props
  return { ...node.props, ...filtered }
}

function mergeResolvedClassStyles(classes: Array<{
  resolvedStyles?: Record<string, unknown>
}>): Record<string, unknown> {
  return classes.reduce<Record<string, unknown>>((acc, cls) => ({
    ...acc,
    ...(cls.resolvedStyles ?? {}),
  }), {})
}

function stringifySearchValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

// Re-export ClassInfo type for callers that want it without going to snapshot.ts
export type { ClassInfo }
