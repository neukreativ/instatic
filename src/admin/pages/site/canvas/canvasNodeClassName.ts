import type { ClassPreviewAssignment } from '@site/store/slices/styleRuleSlice'
import { classNamesForClassIds, type StyleRuleRegistry } from '@core/page-tree'
import { isEmittableProperty, sanitiseCssValue } from '@core/publisher'

export function getCanvasNodeClassIds(
  classIds: readonly string[] | undefined,
  previewClassAssignment: ClassPreviewAssignment | null,
  nodeId: string,
): string[] | undefined {
  const ids = classIds ? [...classIds] : []

  if (
    previewClassAssignment?.nodeId === nodeId &&
    !ids.includes(previewClassAssignment.classId)
  ) {
    ids.push(previewClassAssignment.classId)
  }

  return ids.length > 0 ? ids : undefined
}

export function getCanvasNodeClassName(
  classIds: readonly string[] | undefined,
  previewClassAssignment: ClassPreviewAssignment | null,
  nodeId: string,
  classes: StyleRuleRegistry,
): string | undefined {
  const names = classNamesForClassIds(
    classes,
    getCanvasNodeClassIds(classIds, previewClassAssignment, nodeId),
  )
  return names.length > 0 ? names.join(' ') : undefined
}

/**
 * Convert a node's `inlineStyles` bag into a React `style` object for the
 * canvas, so the editor preview matches the published `style="…"` attribute.
 * Keys are already camelCase (React's style shape); each value is run through
 * the same `sanitiseCssValue` / `isEmittableProperty` gate the publisher uses,
 * so the canvas never renders a value the published page would drop. Returns
 * `undefined` when nothing survives (so the module emits no `style`).
 */
export function getCanvasNodeInlineStyle(
  inlineStyles: Record<string, unknown> | undefined,
): Record<string, string | number> | undefined {
  if (!inlineStyles) return undefined
  const out: Record<string, string | number> = {}
  for (const [prop, value] of Object.entries(inlineStyles)) {
    if (!isEmittableProperty(prop)) continue
    if (value === undefined || value === null || value === '') continue
    const sanitised = sanitiseCssValue(value as string | number)
    if (sanitised === null) continue
    out[prop] = sanitised
  }
  return Object.keys(out).length > 0 ? out : undefined
}
