/**
 * Site-scope read tools — server-side, resolve from SiteSnapshot.
 *
 * Eight tools that read the current page tree, modules, classes,
 * breakpoints, and pages. Each tool casts `ctx.snapshot` to SiteSnapshot at
 * the top of its handler — the runtime is scope-agnostic and hands tools an
 * `unknown` snapshot.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import type { AiTool } from '../types'
import type { SiteSnapshot } from './snapshot'
import {
  inspectPageClass,
  inspectPageNode,
  searchPageNodes,
  type InspectClassArgs,
  type InspectNodeArgs,
  type SearchNodesArgs,
} from './snapshotHelpers'

function asSnap(snapshot: unknown): SiteSnapshot {
  return snapshot as SiteSnapshot
}

// ---------------------------------------------------------------------------
// list_modules
// ---------------------------------------------------------------------------

const ListModulesInput = Type.Object({
  category: Type.Optional(Type.String()),
})

export const listModulesTool: AiTool = {
  name: 'list_modules',
  scope: 'site',
  execution: 'server',
  description:
    'List every page-builder module currently registered in this site (base modules plus any modules contributed by activated plugins). Each module entry includes its id, display name, category, props (content/behaviour fields you pass to insertNode/insertTree), and class-backed style targets. Call this when you need to know what kinds of elements you can insert. Optional `category` filter narrows by the module category string (case-insensitive).',
  inputSchema: ListModulesInput,
  handler: async (input, ctx) => {
    const { category } = input as Static<typeof ListModulesInput>
    const snap = asSnap(ctx.snapshot)
    const normalized = category?.toLowerCase()
    const modules = normalized
      ? snap.availableModules.filter((m) => m.category.toLowerCase() === normalized)
      : snap.availableModules
    return { modules }
  },
}

// ---------------------------------------------------------------------------
// list_classes
// ---------------------------------------------------------------------------

const ListClassesInput = Type.Object({
  query: Type.Optional(Type.String()),
})

export const listClassesTool: AiTool = {
  name: 'list_classes',
  scope: 'site',
  execution: 'server',
  description:
    'List every reusable CSS class defined in the site, with its id, name, base styles, and per-breakpoint styles. Call this before assigning a class so you know it exists and what its styles look like, or to discover an existing class to reuse instead of creating a duplicate. Optional `query` filters the list by id or name (case-insensitive substring).',
  inputSchema: ListClassesInput,
  handler: async (input, ctx) => {
    const { query } = input as Static<typeof ListClassesInput>
    const snap = asSnap(ctx.snapshot)
    const normalized = query?.toLowerCase()
    const classes = normalized
      ? snap.classes.filter((c) =>
        c.id.toLowerCase().includes(normalized) ||
        c.name.toLowerCase().includes(normalized))
      : snap.classes
    return { classes }
  },
}

// ---------------------------------------------------------------------------
// list_breakpoints
// ---------------------------------------------------------------------------

const ListBreakpointsInput = Type.Object({})

export const listBreakpointsTool: AiTool = {
  name: 'list_breakpoints',
  scope: 'site',
  execution: 'server',
  description:
    'List every responsive breakpoint configured for this site (id, label, width in px, icon name) and which one is currently active in the editor. Use the returned ids — never assume "mobile", "tablet", "desktop" — when passing breakpointId to updateNodeProps, updateClassStyles, createClass.breakpointStyles, or render_snapshot.',
  inputSchema: ListBreakpointsInput,
  handler: async (_input, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return {
      activeBreakpointId: snap.activeBreakpointId,
      breakpoints: snap.breakpoints,
    }
  },
}

// ---------------------------------------------------------------------------
// inspect_page
// ---------------------------------------------------------------------------

const InspectPageInput = Type.Object({})

export const inspectPageTool: AiTool = {
  name: 'inspect_page',
  scope: 'site',
  execution: 'server',
  description:
    "Return the full active page tree: title, root node id, selected node id, configured breakpoints, and every node's id, moduleId, label, parent, children, props, classIds, and breakpointOverrides. Call this once when you need a global view (planning multi-element changes, reorganising sections, mass edits). For a single node prefer inspect_node.",
  inputSchema: InspectPageInput,
  handler: async (_input, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return {
      page: {
        pageId: snap.pageId,
        pageTitle: snap.pageTitle,
        rootNodeId: snap.rootNodeId,
        selectedNodeId: snap.selectedNodeId,
        activeBreakpointId: snap.activeBreakpointId,
        breakpoints: snap.breakpoints,
        nodes: snap.nodes,
      },
    }
  },
}

// ---------------------------------------------------------------------------
// search_nodes
// ---------------------------------------------------------------------------

const SearchNodesInput = Type.Object({
  query: Type.Optional(Type.String()),
  moduleId: Type.Optional(Type.String()),
  classId: Type.Optional(Type.String()),
  className: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
})

export const searchNodesTool: AiTool = {
  name: 'search_nodes',
  scope: 'site',
  execution: 'server',
  description:
    'Find existing nodes that match a query. Use this to locate the target of a small edit ("the heading at the top", "the primary CTA button") without dumping the whole tree via inspect_page. Filter by free-text `query` (matches id, moduleId, label, class names, and string prop values), `moduleId` (e.g. base.text), `classId`, or `className`. `limit` defaults to 25.',
  inputSchema: SearchNodesInput,
  handler: async (args, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return searchPageNodes(snap, args as SearchNodesArgs)
  },
}

// ---------------------------------------------------------------------------
// inspect_node
// ---------------------------------------------------------------------------

const InspectNodeInput = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
  maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
})

export const inspectNodeTool: AiTool = {
  name: 'inspect_node',
  scope: 'site',
  execution: 'server',
  description:
    "Return one node's full detail PLUS its descendant subtree as a tree of light-info objects (id, moduleId, label, classIds, classNames, childCount, short textPreview, recursive children). One call gives you the whole structural picture for a section — you do NOT need to call inspect_node repeatedly to walk the tree. Detailed fields on the focal node: resolved props (base props + per-breakpoint overrides), assigned classes with resolved styles, merged class styles. `breakpointId` defaults to the active breakpoint. `maxDepth` defaults to 5 (deep enough for any reasonable section nesting); pass 0 for the focal node only.",
  inputSchema: InspectNodeInput,
  handler: async (args, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return inspectPageNode(snap, args as InspectNodeArgs)
  },
}

// ---------------------------------------------------------------------------
// inspect_class
// ---------------------------------------------------------------------------

const InspectClassInput = Type.Object({
  classId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
})

export const inspectClassTool: AiTool = {
  name: 'inspect_class',
  scope: 'site',
  execution: 'server',
  description:
    "Return one class's detail: id, name, base styles, breakpoint-specific styles for the requested breakpoint, and every node currently assigned to it. Use this before updateClassStyles so you know the existing style values, or before reusing a class to confirm it does what you expect. `classId` accepts either the id or the class name.",
  inputSchema: InspectClassInput,
  handler: async (args, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return inspectPageClass(snap, args as InspectClassArgs)
  },
}

// ---------------------------------------------------------------------------
// list_pages
// ---------------------------------------------------------------------------

const ListPagesInput = Type.Object({})

export const listPagesTool: AiTool = {
  name: 'list_pages',
  scope: 'site',
  execution: 'server',
  description:
    'List every page in the site (id, title, slug, active flag, isHomepage flag). The homepage is whichever page has slug "index". Use this for any site-level admin task: "duplicate the landing page", "list all my pages", "rename /pricing to /plans", "make this the homepage" (rename slug to "index").',
  inputSchema: ListPagesInput,
  handler: async (_input, ctx) => {
    const snap = asSnap(ctx.snapshot)
    return { pages: snap.pages }
  },
}

// ---------------------------------------------------------------------------
// All read tools — convenient barrel for the registry
// ---------------------------------------------------------------------------

export const siteReadTools: AiTool[] = [
  listModulesTool,
  listClassesTool,
  listBreakpointsTool,
  inspectPageTool,
  searchNodesTool,
  inspectNodeTool,
  inspectClassTool,
  listPagesTool,
]
