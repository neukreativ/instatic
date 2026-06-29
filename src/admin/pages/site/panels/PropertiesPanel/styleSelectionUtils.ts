/**
 * styleSelectionUtils — smart style-target selection for "active expanded" mode.
 *
 * Picks the node / selector most likely to hold editable styles when the user
 * clicks the canvas: descendants with set values beat empty wrappers, and the
 * selector pill with the most overrides wins over an arbitrary first class.
 */

import type { StyleRule } from '@core/page-tree'
import { flattenSubtree, isUserVisibleClass, styleRuleSelector } from '@core/page-tree'
import type { PageNode } from '@core/page-tree'
import type { NodeTree } from '@core/page-tree'
import type { EditorStore } from '@site/store/types'
import { readPropertiesSectionsMode } from '@site/preferences/editorPreferences'
import {
  isContentTextModuleId,
  isTextContentEventTarget,
} from '@site/canvas/canvasEventTarget'
import {
  CLASS_STYLE_SECTIONS,
  getActiveStyleTab,
  getCustomProperties,
} from './cssControlTypes'
import { hasStyleValue } from './styleValueUtils'
import { resolveRuleStoredStyles } from './styleQueryUtils'
import type { SelectorPillItem } from './selectorPickerModel'

function readActiveTree(state: EditorStore): NodeTree<PageNode> | null {
  if (!state.site) return null
  const activeDocument = state.activeDocument
  if (activeDocument?.kind === 'visualComponent') {
    const vc = state.site.visualComponents?.find((component) => component.id === activeDocument.vcId)
    return vc ? (vc.tree as NodeTree<PageNode>) : null
  }
  const page = state.site.pages.find((entry) => entry.id === state.activePageId)
  return page ?? null
}

/** Active breakpoint / condition context for style-bag reads. */
export function resolveActiveStyleContextId(state: EditorStore): string | null {
  const activeTab = getActiveStyleTab(state.activeBreakpointId)
  const conditionId = state.activeConditionId
  if (
    conditionId !== null &&
    state.site?.conditions?.some((condition) => condition.id === conditionId)
  ) {
    return conditionId
  }
  return activeTab !== 'base' ? activeTab : null
}

/** Count stored (non-inherited) properties on a style rule in the active context. */
export function countRuleSetProperties(
  rule: StyleRule,
  activeContextId: string | null,
): number {
  const stored = resolveRuleStoredStyles(rule, activeContextId)
  let count = 0

  for (const section of CLASS_STYLE_SECTIONS) {
    for (const prop of section.properties) {
      if (hasStyleValue(stored[prop])) count += 1
    }
  }

  count += getCustomProperties(stored).length
  return count
}

/**
 * Among selector pills, return the id of the rule with the most set properties.
 * Ties favour the strongest pill (later in the weakest→strongest list).
 */
export function findSelectorWithMostSetProperties(
  pills: readonly SelectorPillItem[],
  activeContextId: string | null,
): string | null {
  let bestCount = 0
  for (const { rule } of pills) {
    if (styleRuleSelector(rule).trim() === '*') continue
    bestCount = Math.max(bestCount, countRuleSetProperties(rule, activeContextId))
  }
  if (bestCount === 0) return null

  for (let i = pills.length - 1; i >= 0; i--) {
    const { rule } = pills[i]
    if (styleRuleSelector(rule).trim() === '*') continue
    if (countRuleSetProperties(rule, activeContextId) === bestCount) {
      return rule.id
    }
  }

  return null
}

function countNodeInlineStyleProperties(node: { inlineStyles?: Record<string, unknown> }): number {
  const inline = node.inlineStyles
  if (!inline) return 0
  return Object.keys(inline).filter((key) => hasStyleValue(inline[key])).length
}

/** Score a node by how many style properties it owns (classes + inline). */
export function countNodeStyleFootprint(
  state: EditorStore,
  nodeId: string,
  activeContextId: string | null,
): number {
  if (!state.site) return 0
  const tree = readActiveTree(state)
  const node = tree?.nodes[nodeId]
  if (!node) return 0

  let count = countNodeInlineStyleProperties(node as { inlineStyles?: Record<string, unknown> })

  for (const classId of node.classIds ?? []) {
    const rule = state.site.styleRules[classId]
    if (!rule || !isUserVisibleClass(rule)) continue
    count += countRuleSetProperties(rule, activeContextId)
  }

  return count
}

/**
 * When active mode is on and the clicked node carries no styles, prefer the
 * deepest descendant that does — e.g. select the styled `h1` instead of its
 * empty wrapper `div`. Text-pixel clicks never get redirected away from the
 * content module the author clicked.
 */
export function resolveStylePreferredNodeId(
  state: EditorStore,
  clickedNodeId: string,
  clickTarget: EventTarget | null = null,
): string {
  if (isTextContentEventTarget(clickTarget)) return clickedNodeId

  const tree = readActiveTree(state)
  const clickedNode = tree?.nodes[clickedNodeId]
  if (clickedNode && isContentTextModuleId(clickedNode.moduleId)) {
    return clickedNodeId
  }

  if (readPropertiesSectionsMode() !== 'active') return clickedNodeId

  if (!tree?.nodes[clickedNodeId]) return clickedNodeId

  const activeContextId = resolveActiveStyleContextId(state)
  const clickedScore = countNodeStyleFootprint(state, clickedNodeId, activeContextId)
  if (clickedScore > 0) return clickedNodeId

  const descendants = flattenSubtree(tree, clickedNodeId).filter((id) => id !== clickedNodeId)
  let bestId = clickedNodeId
  let bestScore = 0

  for (const id of descendants) {
    const score = countNodeStyleFootprint(state, id, activeContextId)
    const node = tree.nodes[id]
    const contentModule = isContentTextModuleId(node?.moduleId)

    if (score > bestScore) {
      bestScore = score
      bestId = id
      continue
    }

    if (score === bestScore && score === 0 && contentModule) {
      bestId = id
    }
  }

  if (bestScore > 0) return bestId

  // No styled descendants — still prefer a text/content child over the wrapper.
  for (let i = descendants.length - 1; i >= 0; i--) {
    const id = descendants[i]
    if (isContentTextModuleId(tree.nodes[id]?.moduleId)) return id
  }

  return clickedNodeId
}

/** Pick the assigned class with the most set properties (active mode). */
export function pickClassIdWithMostSetProperties(
  state: EditorStore,
  classIds: readonly string[],
  activeContextId: string | null,
): string | null {
  if (!state.site || classIds.length === 0) return null

  let bestId: string | null = null
  let bestCount = 0

  for (const classId of classIds) {
    const rule = state.site.styleRules[classId]
    if (!rule || !isUserVisibleClass(rule)) continue
    const count = countRuleSetProperties(rule, activeContextId)
    if (count > bestCount) {
      bestCount = count
      bestId = classId
    }
  }

  return bestCount > 0 ? bestId : null
}

/**
 * The selector to auto-activate on node select in active mode: most overrides
 * wins; otherwise fall back to the strongest direct match (ambient selectors).
 */
export function pickAutoActiveSelectorId(
  pills: SelectorPillItem[],
  activeContextId: string | null,
): string | null {
  const mode = readPropertiesSectionsMode()

  if (mode === 'active') {
    const richest = findSelectorWithMostSetProperties(pills, activeContextId)
    if (richest) return richest
  }

  for (let i = pills.length - 1; i >= 0; i--) {
    const pill = pills[i]
    if (pill.match.kind !== 'direct') continue
    if (styleRuleSelector(pill.rule).trim() === '*') continue
    return pill.rule.id
  }

  return null
}
