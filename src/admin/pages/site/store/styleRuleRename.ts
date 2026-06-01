import {
  assertValidCssClassName,
  classKindSelector,
  isGeneratedClassLocked,
  type StyleRule,
} from '@core/page-tree'

/**
 * Defensive selector validity check using the browser's CSS engine. Throws
 * inside `querySelector` for invalid selectors; we turn that into a boolean
 * so the slice can reject the input cleanly.
 */
export function isValidCssSelector(selector: string): boolean {
  if (typeof document === 'undefined') return true
  try {
    document.createDocumentFragment().querySelector(selector)
    return true
  } catch {
    return false
  }
}

export function renameStyleRule(
  styleRules: Record<string, StyleRule>,
  classId: string,
  name: string,
): boolean {
  const rule = styleRules[classId]
  if (!rule || isGeneratedClassLocked(rule)) return false

  const trimmed = name.trim()
  if ((rule.kind ?? 'class') === 'ambient') {
    if (trimmed.length === 0) throw new Error('[classSlice] Ambient selector cannot be empty')
    if (!isValidCssSelector(trimmed)) throw new Error(`[classSlice] Invalid CSS selector: ${trimmed}`)
    if (Object.is(rule.selector, trimmed) && Object.is(rule.name, trimmed)) return false

    rule.name = trimmed
    rule.selector = trimmed
    rule.updatedAt = Date.now()
    return true
  }

  assertValidCssClassName(trimmed)
  const selector = classKindSelector(trimmed)
  if (Object.is(rule.name, trimmed) && Object.is(rule.selector, selector)) return false

  const existing = Object.values(styleRules).find(
    (candidate) =>
      (candidate.kind ?? 'class') === 'class' &&
      candidate.name === trimmed &&
      candidate.id !== classId,
  )
  if (existing) throw new Error(`[classSlice] A class named "${trimmed}" already exists`)

  rule.name = trimmed
  rule.selector = selector
  rule.updatedAt = Date.now()
  return true
}
