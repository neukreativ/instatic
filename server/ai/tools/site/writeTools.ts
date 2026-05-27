/**
 * Site-scope write tools — browser-bridged. The runner emits a
 * `toolRequest` for each call and waits for the browser to POST a result
 * to /admin/api/ai/tool-result.
 *
 * Each tool defines only `name`, `description`, `inputSchema`, and the
 * sentinel `execution: 'browser'`. There is NO server-side handler — the
 * runner routes browser-execution tools through the bridge instead.
 *
 * 14 mutation tools + render_snapshot = 15 total.
 *
 * Input shapes mirror the existing browser executor at
 * `src/admin/pages/site/agent/executor.ts` (which already validates each
 * call against TypeBox schemas — the schemas defined here are the single
 * source of truth that the executor will read in Phase 3).
 */

import { Type } from '@core/utils/typeboxHelpers'
import type { TSchema } from '@sinclair/typebox'
import type { AiTool } from '../types'

// ---------------------------------------------------------------------------
// Shared input pieces
// ---------------------------------------------------------------------------

const StylePatch = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number()]),
)

const BreakpointStyles = Type.Record(
  Type.String({ minLength: 1 }),
  StylePatch,
)

const ClassDefinition = Type.Object({
  name: Type.String({ minLength: 1 }),
  styles: Type.Optional(StylePatch),
  breakpointStyles: Type.Optional(BreakpointStyles),
})

// Recursive InsertTreeNode — `children` is an array of self. TypeBox's
// `Type.Recursive` is the canonical pattern for this kind of self-reference
// (the runtime ToolCall hand-walks the tree).
const InsertTreeNodeSchema: TSchema = Type.Recursive((Self) =>
  Type.Object({
    moduleId: Type.String({ minLength: 1 }),
    props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    classIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    children: Type.Optional(Type.Array(Self)),
  }),
)

// ---------------------------------------------------------------------------
// Node-level write tools
// ---------------------------------------------------------------------------

const InsertNodeInput = Type.Object({
  moduleId: Type.String({ minLength: 1 }),
  parentId: Type.String({ minLength: 1 }),
  index: Type.Optional(Type.Integer({ minimum: 0 })),
  props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  classIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

export const insertNodeTool: AiTool = {
  name: 'insertNode',
  scope: 'site',
  execution: 'browser',
  description:
    "Insert one new node under an existing parent. Returns the new node's id (use it as parentId in subsequent inserts). Use this for single-element additions; for multi-element sections (hero, pricing card, CTA block) prefer insertTree, which inserts a nested tree and supporting CSS classes in a single call. `parentId` must be a real node id (root id, or an id from a prior tool result / inspect_page). `props` are content/behaviour fields per the module schema in list_modules. `classIds` may use class ids OR class names; unknown class names fail — create the class with createClass first.",
  inputSchema: InsertNodeInput,
}

const InsertTreeInput = Type.Object({
  parentId: Type.String({ minLength: 1 }),
  index: Type.Optional(Type.Integer({ minimum: 0 })),
  classes: Type.Optional(Type.Array(ClassDefinition)),
  tree: InsertTreeNodeSchema,
})

export const insertTreeTool: AiTool = {
  name: 'insertTree',
  scope: 'site',
  execution: 'browser',
  description:
    "Insert a nested tree of nodes (and optionally create the supporting CSS classes for it) in a single call. Strongly preferred over chained insertNode calls for any multi-element build. `classes` are created/updated first, then referenced from `tree.children[].classIds` by class name. `tree.moduleId` is the root's module; `tree.children[]` are recursive — each child has the same shape. Returns the root node's id.",
  inputSchema: InsertTreeInput,
}

const DeleteNodeInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
})

export const deleteNodeTool: AiTool = {
  name: 'deleteNode',
  scope: 'site',
  execution: 'browser',
  description:
    'Remove a node and every descendant under it. Pass the real node id (from a prior tool result or inspect_page / search_nodes). Permanent within the session — the user can undo it via Cmd+Z but you cannot undo it from within the agent loop.',
  inputSchema: DeleteNodeInput,
}

const UpdateNodePropsInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
  patch: Type.Record(Type.String(), Type.Unknown()),
})

export const updateNodePropsTool: AiTool = {
  name: 'updateNodeProps',
  scope: 'site',
  execution: 'browser',
  description:
    'Patch one or more prop values on an existing node. The patch shallow-merges with the current props (omitted keys keep their current value; pass an empty string or null to clear). `breakpointId` writes a per-breakpoint override and is rejected for content props (text, tag, src, alt, href, …) — those are single-value across all breakpoints because the published page is one HTML document. For per-breakpoint *visual* variation use class breakpoint styles via createClass.breakpointStyles / updateClassStyles instead. Sanitises richtext-keyed props through DOMPurify automatically.',
  inputSchema: UpdateNodePropsInput,
}

const MoveNodeInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  newParentId: Type.String({ minLength: 1 }),
  newIndex: Type.Integer({ minimum: 0 }),
})

export const moveNodeTool: AiTool = {
  name: 'moveNode',
  scope: 'site',
  execution: 'browser',
  description:
    "Move a node to a different parent and/or position in its parent's children array. `newIndex` is 0-based among the destination parent's children. Use this for re-ordering sections, reparenting nodes between containers, or moving a child to root.",
  inputSchema: MoveNodeInput,
}

const RenameNodeInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
})

export const renameNodeTool: AiTool = {
  name: 'renameNode',
  scope: 'site',
  execution: 'browser',
  description:
    "Set the user-facing label shown for a node in the DOM tree panel. Doesn't affect the rendered HTML — only the editor display. Useful when you build a complex tree and want each node to be findable by name in the layers panel.",
  inputSchema: RenameNodeInput,
}

const DuplicateNodeInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
})

export const duplicateNodeTool: AiTool = {
  name: 'duplicateNode',
  scope: 'site',
  execution: 'browser',
  description:
    "Deep-clone a node and its entire subtree (props, classIds, breakpoint overrides, all descendants) right after the original in the same parent. Pass `count` (1-50, default 1) to produce N clones in one call — the canonical way to handle \"make 6 cards from the existing 3\" or \"add another section like this one\". Returns the first new node's id in `nodeId`. The clones share class assignments with the original, so styling stays consistent.",
  inputSchema: DuplicateNodeInput,
}

// ---------------------------------------------------------------------------
// Class-level write tools
// ---------------------------------------------------------------------------

const CreateClassInput = Type.Object({
  name: Type.String({ minLength: 1 }),
  styles: Type.Optional(StylePatch),
  breakpointStyles: Type.Optional(BreakpointStyles),
})

export const createClassTool: AiTool = {
  name: 'createClass',
  scope: 'site',
  execution: 'browser',
  description:
    'Create a new reusable CSS class with optional base and per-breakpoint styles. CSS property names are camelCase (fontSize, backgroundColor, paddingTop, gridTemplateColumns, etc.). Returns the new class id; you can then pass it to assignClass, but you can also pass the class NAME to assignClass/updateClassStyles/removeClass — the executor resolves names automatically. Class names must be unique within the site.',
  inputSchema: CreateClassInput,
}

const UpdateClassStylesInput = Type.Object({
  classId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
  patch: StylePatch,
})

export const updateClassStylesTool: AiTool = {
  name: 'updateClassStyles',
  scope: 'site',
  execution: 'browser',
  description:
    'Patch the style declarations of an existing class. The patch shallow-merges with the current styles. Pass `breakpointId` to write breakpoint-specific overrides rather than changing the base styles. `classId` accepts either the class id or its name (the executor resolves names).',
  inputSchema: UpdateClassStylesInput,
}

const AssignClassInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
})

export const assignClassTool: AiTool = {
  name: 'assignClass',
  scope: 'site',
  execution: 'browser',
  description:
    "Attach an existing CSS class to a node. The class's styles cascade onto the node according to the project's class layering rules. `classId` accepts either the id or the class name.",
  inputSchema: AssignClassInput,
}

const RemoveClassInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
})

export const removeClassTool: AiTool = {
  name: 'removeClass',
  scope: 'site',
  execution: 'browser',
  description:
    'Detach a CSS class from a node (does not delete the class itself; other nodes keep their assignment). `classId` accepts either the id or the class name.',
  inputSchema: RemoveClassInput,
}

// ---------------------------------------------------------------------------
// Page-level write tools
// ---------------------------------------------------------------------------

const AddPageInput = Type.Object({
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

export const addPageTool: AiTool = {
  name: 'addPage',
  scope: 'site',
  execution: 'browser',
  description:
    'Add a new EMPTY page to the site with the given title and optional slug (defaults to a slugified title). Use this when the user asks to create a fresh page from scratch. For "create a page like this one" or "copy the landing page", use duplicatePage instead. Returns the new page id in `nodeId`.',
  inputSchema: AddPageInput,
}

const DeletePageInput = Type.Object({
  pageId: Type.String({ minLength: 1 }),
})

export const deletePageTool: AiTool = {
  name: 'deletePage',
  scope: 'site',
  execution: 'browser',
  description:
    'Permanently delete a page and all of its content. Cannot delete the only remaining page in a site (a site must have at least one page). Use list_pages first if you need to find the page id.',
  inputSchema: DeletePageInput,
}

const RenamePageInput = Type.Object({
  pageId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

export const renamePageTool: AiTool = {
  name: 'renamePage',
  scope: 'site',
  execution: 'browser',
  description:
    "Change a page's title and/or slug. Pass `slug` as \"index\" to make this page the site's homepage (the homepage convention is whichever page lives at slug \"index\"). Pass `slug` as undefined to keep the current slug. Use list_pages first if you need to find the page id.",
  inputSchema: RenamePageInput,
}

const DuplicatePageInput = Type.Object({
  pageId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

export const duplicatePageTool: AiTool = {
  name: 'duplicatePage',
  scope: 'site',
  execution: 'browser',
  description:
    'Deep-clone an existing page (every node, prop, class assignment, and breakpoint override) under a new title and slug. Use this for "copy this page", "make a /pricing page like the /plans page", or any template-style workflow. Every node in the new page gets a fresh id; class assignments are preserved. Returns the new page id in `nodeId`.',
  inputSchema: DuplicatePageInput,
}

// ---------------------------------------------------------------------------
// render_snapshot — browser-bridged, returns a special payload
// ---------------------------------------------------------------------------

const RenderSnapshotInput = Type.Object({
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
})

export const renderSnapshotTool: AiTool = {
  name: 'render_snapshot',
  scope: 'site',
  execution: 'browser',
  description:
    "Capture a fresh screenshot of the canvas frame for one breakpoint and return it alongside browser-collected layout data: viewport dimensions, per-node bounding boxes, image-load status, and warnings (horizontal-overflow, hidden-overflow, broken-image, invisible-node). Use this to verify visual changes, debug responsive issues, or inspect a layout you can't reason about from props alone. The image is returned as MCP image content so you can see it directly. `breakpointId` defaults to the active breakpoint.",
  inputSchema: RenderSnapshotInput,
}

// ---------------------------------------------------------------------------
// All write tools — convenient barrel for the registry
// ---------------------------------------------------------------------------

export const siteWriteTools: AiTool[] = [
  insertNodeTool,
  insertTreeTool,
  deleteNodeTool,
  updateNodePropsTool,
  moveNodeTool,
  renameNodeTool,
  duplicateNodeTool,
  createClassTool,
  updateClassStylesTool,
  assignClassTool,
  removeClassTool,
  addPageTool,
  deletePageTool,
  renamePageTool,
  duplicatePageTool,
  renderSnapshotTool,
]
