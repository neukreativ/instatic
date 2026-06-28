/**
 * useStyleQuerySelectorAutoFocus — when the style search query changes, activate
 * the strongest selector pill that already sets a property matching the query.
 *
 * Manual pill clicks are unaffected: this hook only reacts to query changes.
 */

import { useEffect, useRef } from 'react'
import { isUserVisibleClass, type StyleRule } from '@core/page-tree'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { findRenderedCanvasNodeElement } from '@site/canvas/canvasNodeLookup'
import { deriveSelectorPickerModel } from './selectorPickerModel'
import { resolveAutoFocusSelectorForStyleQuery } from './styleQueryUtils'

export function useStyleQuerySelectorAutoFocus({
  nodeId,
  styleQuery,
  activeClassId,
  activeClass,
  activeContextId,
  inlineStyleEditing,
}: {
  nodeId: string | null
  styleQuery: string
  activeClassId: string | null
  activeClass: StyleRule | null
  activeContextId: string | null
  inlineStyleEditing: boolean
}): void {
  const site = useEditorStore((s) => s.site)
  const node = useEditorStore((s) =>
    nodeId ? selectActiveCanvasPage(s)?.nodes[nodeId] ?? null : null,
  )
  const setActiveClass = useEditorStore((s) => s.setActiveClass)
  const lastAutoFocusQueryRef = useRef('')

  useEffect(() => {
    if (inlineStyleEditing || !nodeId || !site || !node) return

    const normalizedQuery = styleQuery.trim()
    if (!normalizedQuery) {
      lastAutoFocusQueryRef.current = ''
      return
    }

    // Only auto-focus when the query itself changes — not when the user
    // manually clicks a different selector pill while the query stays put.
    if (lastAutoFocusQueryRef.current === normalizedQuery) return
    lastAutoFocusQueryRef.current = normalizedQuery

    const visibleRules = Object.fromEntries(
      Object.entries(site.styleRules).filter(([, rule]) => isUserVisibleClass(rule)),
    )
    const selectedElement = findRenderedCanvasNodeElement(nodeId)
    const { pills } = deriveSelectorPickerModel({
      rules: visibleRules,
      node,
      selectedElement,
      activeRuleId: activeClassId,
    })

    const nextActiveId = resolveAutoFocusSelectorForStyleQuery({
      query: normalizedQuery,
      pills,
      activeClassId,
      activeContextId,
      activeClass,
    })

    if (nextActiveId) {
      setActiveClass(nextActiveId)
    }
  }, [
    styleQuery,
    nodeId,
    site,
    node,
    activeClassId,
    activeClass,
    activeContextId,
    inlineStyleEditing,
    setActiveClass,
  ])
}
