/**
 * breakpointStyleCascade — resolve the effective CSS bag shown in the
 * Properties panel at the active viewport, mirroring the published CSS cascade.
 *
 * `storedStyles` stays scoped to the active breakpoint/condition override bag
 * (what is explicitly set *here*). `currentStyles` merges base styles with
 * every viewport context whose @media query matches the active canvas width.
 */

import type { Breakpoint, StyleRule } from '@core/page-tree'
import { breakpointMediaQuery } from '@core/page-tree'
import { compareViewportContextCascade } from '@core/publisher/classCss'

const PURE_MAX_WIDTH_QUERY_RE = /^\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*\)$/i
const PURE_MIN_WIDTH_QUERY_RE = /^\(\s*min-width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*\)$/i

/** Whether a breakpoint media query matches the given canvas viewport width. */
export function mediaQueryMatchesViewportWidth(query: string, viewportWidth: number): boolean {
  const normalized = query.trim()
  const maxMatch = normalized.match(PURE_MAX_WIDTH_QUERY_RE)
  if (maxMatch) return viewportWidth <= Number(maxMatch[1])
  const minMatch = normalized.match(PURE_MIN_WIDTH_QUERY_RE)
  if (minMatch) return viewportWidth >= Number(minMatch[1])
  return false
}

/** Base styles plus every matching viewport override, in CSS cascade order. */
export function resolveViewportCascadeStyles(input: {
  rule: StyleRule
  breakpoints: readonly Breakpoint[]
  viewportWidth: number
}): Record<string, unknown> {
  const { rule, breakpoints, viewportWidth } = input
  let merged: Record<string, unknown> = { ...rule.styles }

  const ordered = breakpoints
    .map((breakpoint, index) => ({ breakpoint, index }))
    .sort(compareViewportContextCascade)

  for (const { breakpoint } of ordered) {
    const bag = rule.contextStyles[breakpoint.id]
    if (!bag || Object.keys(bag).length === 0) continue
    const query = breakpointMediaQuery(breakpoint)
    if (!mediaQueryMatchesViewportWidth(query, viewportWidth)) continue
    merged = { ...merged, ...bag }
  }

  return merged
}

/**
 * Effective styles for property controls: base on desktop, full viewport
 * cascade on breakpoint tabs, base + condition bag on custom conditions.
 */
export function resolveRuleCurrentStyles(input: {
  rule: StyleRule
  breakpoints: readonly Breakpoint[]
  activeContextId: string | null
  activeBreakpointId: string | undefined
  onCondition: boolean
}): Record<string, unknown> {
  const { rule, activeContextId, activeBreakpointId, onCondition, breakpoints } = input

  if (!activeContextId) return { ...rule.styles }

  if (onCondition) {
    return { ...rule.styles, ...(rule.contextStyles[activeContextId] ?? {}) }
  }

  const viewport = breakpoints.find((bp) => bp.id === activeBreakpointId)
  if (!viewport) {
    return { ...rule.styles, ...(rule.contextStyles[activeContextId] ?? {}) }
  }

  return resolveViewportCascadeStyles({
    rule,
    breakpoints,
    viewportWidth: viewport.width,
  })
}
