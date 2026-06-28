/**
 * useStyleQuerySelectorAutoFocus — when the style search query matches a set
 * property on another selector pill, activate that pill automatically.
 *
 * Manual pill clicks are unaffected: this hook only reacts to query changes.
 */

import { useEffect } from 'react'
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

  useEffect(() => {
    if (inlineStyleEditing || !nodeId || !site || !node) return

    const normalizedQuery = styleQuery.trim()
    if (!normalizedQuery) return

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
