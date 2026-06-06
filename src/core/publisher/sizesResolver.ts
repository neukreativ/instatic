/**
 * Publisher — `sizes='auto'` resolver.
 *
 * The image module's `sizes` prop accepts an explicit media-query string
 * (e.g. `(min-width: 1024px) 50vw, 100vw`). When the author leaves it at the
 * default `'auto'`, this resolver walks the image's ancestor chain and
 * derives a `sizes` string from the innermost ancestor that constrains the
 * box's width via CSS.
 *
 * Scope (v1):
 *   - Only `width` and `maxWidth` are inspected.
 *   - Only pixel values (`"800px"`, `"800"`) count — `%` / `vw` / `auto`
 *     would need a parent-width context the publisher doesn't compute.
 *   - The **innermost** ancestor with a pixel-valued cap wins. Once one is
 *     found, traversal stops — outer ancestors can't loosen an inner cap.
 *   - The cap can change per viewport context via
 *     `class.contextStyles[breakpointId]`. Each defined viewport override emits
 *     a separate `sizes` candidate using that context's configured media query.
 *
 * Output: a `sizes` string emitted next to `srcset`, e.g.
 *   `(max-width: 375px) 320px, (max-width: 768px) 700px, 1200px`
 *
 * Returns `null` when no constraining ancestor is found — caller (the image
 * module) falls back to the simpler `'100vw'` default.
 *
 * Why ancestor-only, not the image's own classes? The same image is
 * commonly wrapped in a `max-width: 1200px` container — that's where the
 * real cap lives. The image's own classes typically pin display semantics
 * (border-radius, object-fit), not width. Still, this resolver inspects
 * the image node itself first so authors who DO pin a width directly on
 * the image still benefit.
 */
import { breakpointMediaQuery, type Page, type PageNode, type SiteDocument } from '@core/page-tree'
import { compareViewportContextCascade } from './classCss'

/** Effective pixel cap inferred from CSS. `null` means "no pixel constraint". */
type WidthCap = number | null

/**
 * Inspect a single CSS-style bag for a pixel-valued width / maxWidth.
 *
 * `maxWidth` wins over `width` because the visual editor's typical pattern
 * is to set `width: 100%; max-width: 1200px;` on containers — the cap is
 * the meaningful number.
 */
function widthCapFromBag(bag: Record<string, unknown> | undefined): WidthCap {
  if (!bag) return null
  return pixelOrNull(bag.maxWidth) ?? pixelOrNull(bag.width)
}

/**
 * Parse `"800px"` / `"800"` / `800` → `800`. Returns `null` for any non-pixel
 * unit (`%`, `vw`, `rem`, `auto`, etc.), empty strings, NaN, and non-positive
 * numbers.
 */
function pixelOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Reject explicit non-px units / CSS functions outright.
  if (/(?:%|vw|vh|rem|em|auto|min\(|max\(|clamp\(|calc\()/.test(trimmed)) return null
  const m = trimmed.match(/^(\d+(?:\.\d+)?)(?:px)?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Per-viewport width cap for one node. Returns `null` for the base tier
 * (no constraint), and a number for each viewport context id that declares a
 * pixel cap.
 *
 * Multi-class semantics: in v1, the **last classId** declaring a width is
 * authoritative — same direction as CSS source-order ties between
 * equally-specific selectors. Earlier classes' declarations are
 * overridden. Classes with no width / maxWidth are skipped.
 */
function nodeCaps(
  node: PageNode,
  site: SiteDocument,
  breakpointIds: string[],
): { base: WidthCap; byBreakpoint: Map<string, WidthCap> } {
  let base: WidthCap = null
  const byBreakpoint = new Map<string, WidthCap>()

  for (const classId of node.classIds ?? []) {
    const cls = site.styleRules[classId]
    if (!cls) continue
    const fromBase = widthCapFromBag(cls.styles)
    if (fromBase !== null) base = fromBase
    for (const bpId of breakpointIds) {
      const fromBp = widthCapFromBag(cls.contextStyles?.[bpId])
      if (fromBp !== null) byBreakpoint.set(bpId, fromBp)
    }
  }
  return { base, byBreakpoint }
}

/**
 * Walk from `nodeId` outward. Returns `[node, parent, grandparent, …,
 * root]` — innermost first.
 *
 * Uses the node's denormalised `parentId` pointer (O(depth)), so no per-page
 * parent map needs building. Every page reaching the publisher — real, synthetic
 * VC, or composed template — has its parentId index derived first.
 */
function ancestorChain(nodeId: string, page: Page): PageNode[] {
  const out: PageNode[] = []
  const visited = new Set<string>()
  let current: string | null | undefined = nodeId
  while (current && !visited.has(current)) {
    visited.add(current)
    const node: PageNode | undefined = page.nodes[current]
    if (!node) break
    out.push(node)
    current = node.parentId
  }
  return out
}

/**
 * Find the innermost ancestor (inclusive of `nodeId` itself) whose CSS
 * declares any width cap (base or per-viewport). The result is that
 * ancestor's per-tier caps — outer ancestors don't get inspected once a
 * constraint is found because outer ancestors cannot make an inner cap
 * looser.
 */
function findConstrainingAncestor(
  nodeId: string,
  page: Page,
  site: SiteDocument,
): { base: WidthCap; byBreakpoint: Map<string, WidthCap> } | null {
  const chain = ancestorChain(nodeId, page)
  const breakpointIds = site.breakpoints.map((b) => b.id)
  for (const node of chain) {
    const caps = nodeCaps(node, site, breakpointIds)
    if (caps.base !== null || caps.byBreakpoint.size > 0) return caps
  }
  return null
}

/** Convert a width cap → CSS `sizes` source value. */
function capToSize(cap: WidthCap): string {
  return cap === null ? '100vw' : `${Math.round(cap)}px`
}

/**
 * Resolve a per-viewport `sizes` string for the image at `nodeId`.
 *
 * Returns `null` when nothing in the chain constrains the image — caller
 * falls back to `'100vw'`.
 */
export function resolveAutoSizes(
  nodeId: string,
  page: Page,
  site: SiteDocument,
): string | null {
  const caps = findConstrainingAncestor(nodeId, page, site)
  if (!caps) return null

  const viewportEntries = site.breakpoints
    .map((breakpoint, index) => ({ breakpoint, index }))
    .filter(({ breakpoint }) => caps.byBreakpoint.has(breakpoint.id))
    .sort(compareViewportContextCascade)
    .reverse()

  const candidates: string[] = []
  for (const { breakpoint } of viewportEntries) {
    const cap = caps.byBreakpoint.get(breakpoint.id)
    if (cap === undefined) continue
    const query = breakpointMediaQuery(breakpoint)
    if (!isSafeSizesMediaQuery(query)) continue
    candidates.push(`${query} ${capToSize(cap)}`)
  }

  if (caps.base === null && candidates.length === 0) return null
  candidates.push(capToSize(caps.base))
  return candidates.join(', ')
}

function isSafeSizesMediaQuery(query: string): boolean {
  return !/[{}]/.test(query) && !/<\//.test(query) && !/;/.test(query)
}
