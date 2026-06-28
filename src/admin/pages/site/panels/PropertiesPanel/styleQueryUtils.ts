/**
 * styleQueryUtils — shared style-search matching + selector auto-focus helpers.
 *
 * Used by StyleSurface (preserve search across selector pills + auto-jump to
 * the pill whose rule actually sets a property matching the query) and by
 * StyleSectionsEditor (filter visible property rows).
 */

import type { CSSPropertyBag, StyleRule } from '@core/page-tree'
import {
  CLASS_STYLE_SECTIONS,
  cssPropertyLabel,
  type ClassStyleSectionDefinition,
} from './cssControlTypes'
import { hasStyleValue } from './styleValueUtils'
import type { SelectorPillItem } from './selectorPickerModel'

export function propertyMatchesStyleQuery(
  prop: keyof CSSPropertyBag,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  const raw = String(prop).toLowerCase()
  const label = cssPropertyLabel(String(prop)).toLowerCase()
  return raw.includes(normalizedQuery) || label.includes(normalizedQuery)
}

export function sectionMatchesStyleQuery(
  section: ClassStyleSectionDefinition,
  query: string,
): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true
  return (
    section.id.toLowerCase().includes(normalizedQuery) ||
    section.title.toLowerCase().includes(normalizedQuery)
  )
}

export function resolveRuleStoredStyles(
  rule: StyleRule,
  activeContextId: string | null,
): Record<string, unknown> {
  return activeContextId ? (rule.contextStyles[activeContextId] ?? {}) : rule.styles
}

/** True when the rule has at least one *set* property matching the query. */
export function ruleHasSetPropertyMatchingQuery(
  rule: StyleRule,
  query: string,
  activeContextId: string | null,
): boolean {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return false

  const storedStyles = resolveRuleStoredStyles(rule, activeContextId)

  for (const section of CLASS_STYLE_SECTIONS) {
    const sectionMatches = sectionMatchesStyleQuery(section, normalizedQuery)
    for (const prop of section.properties) {
      const propertyMatches =
        sectionMatches || propertyMatchesStyleQuery(prop, normalizedQuery)
      if (propertyMatches && hasStyleValue(storedStyles[prop])) {
        return true
      }
    }
  }

  return false
}

/**
 * Among the element's selector pills (weakest → strongest), return the id of
 * the strongest rule that has a set property matching the query.
 */
export function findBestSelectorForStyleQuery(
  pills: readonly SelectorPillItem[],
  query: string,
  activeContextId: string | null,
): string | null {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  for (let i = pills.length - 1; i >= 0; i--) {
    const { rule } = pills[i]
    if (ruleHasSetPropertyMatchingQuery(rule, normalizedQuery, activeContextId)) {
      return rule.id
    }
  }

  return null
}

/**
 * When the user searches style properties, auto-focus the selector pill that
 * actually owns a matching set value — but only if the currently active rule
 * does not already have one.
 */
export function resolveAutoFocusSelectorForStyleQuery(input: {
  query: string
  pills: readonly SelectorPillItem[]
  activeClassId: string | null
  activeContextId: string | null
  activeClass: StyleRule | null
}): string | null {
  const { query, pills, activeClassId, activeContextId, activeClass } = input
  const normalizedQuery = query.trim()
  if (!normalizedQuery || pills.length === 0) return null

  if (
    activeClass &&
    ruleHasSetPropertyMatchingQuery(activeClass, normalizedQuery, activeContextId)
  ) {
    return null
  }

  const bestId = findBestSelectorForStyleQuery(
    pills,
    normalizedQuery,
    activeContextId,
  )
  if (!bestId || bestId === activeClassId) return null
  return bestId
}

/** First curated section id with a set property matching the query. */
export function findFirstMatchingStyleSectionId(
  storedStyles: Record<string, unknown>,
  query: string,
): string | null {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return null

  for (const section of CLASS_STYLE_SECTIONS) {
    const hasSetMatch = section.properties.some(
      (prop) =>
        (sectionMatchesStyleQuery(section, normalizedQuery) ||
          propertyMatchesStyleQuery(prop, normalizedQuery)) &&
        hasStyleValue(storedStyles[prop]),
    )
    if (hasSetMatch) return section.id
  }

  return null
}
