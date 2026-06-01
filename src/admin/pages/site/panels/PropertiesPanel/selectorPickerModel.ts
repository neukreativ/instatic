import { styleRuleSelector, type PageNode, type StyleRule } from '@core/page-tree'

export type SelectorMatch =
  | { kind: 'direct' }
  | { kind: 'inactive-pseudo'; pseudo: string }

export interface SelectorPillItem {
  rule: StyleRule
  match: SelectorMatch
  active: boolean
  removable: boolean
}

export interface SelectorSuggestionItem {
  rule: StyleRule
  disabled: boolean
  disabledReason: string | null
  match: SelectorMatch | null
}

export interface SelectorPickerModelInput {
  rules: Record<string, StyleRule>
  node: PageNode | null
  selectedElement: Element | null
  activeRuleId: string | null
}

export interface SelectorPickerModel {
  pills: SelectorPillItem[]
  suggestions: SelectorSuggestionItem[]
}

const SUPPORTED_TRAILING_PSEUDOS = [':hover', ':focus', ':focus-visible', ':active'] as const

export function deriveSelectorPickerModel(input: SelectorPickerModelInput): SelectorPickerModel {
  const { rules, node, selectedElement, activeRuleId } = input
  const assignedIds = node?.classIds ?? []
  const assignedIdSet = new Set(assignedIds)
  const pills: SelectorPillItem[] = []
  const suggestions: SelectorSuggestionItem[] = []

  for (const classId of assignedIds) {
    const rule = rules[classId]
    if (!rule || rule.kind === 'ambient') continue
    pills.push({
      rule,
      match: { kind: 'direct' },
      active: activeRuleId === rule.id,
      removable: true,
    })
  }

  for (const rule of sortedRules(rules)) {
    if (rule.kind === 'ambient') {
      const match = matchAmbientRule(rule, selectedElement)
      if (match) {
        pills.push({
          rule,
          match,
          active: activeRuleId === rule.id,
          removable: false,
        })
      }
      suggestions.push({
        rule,
        match,
        disabled: match === null,
        disabledReason: match === null ? "Doesn't match this element" : null,
      })
      continue
    }

    if (!assignedIdSet.has(rule.id)) {
      suggestions.push({
        rule,
        match: null,
        disabled: false,
        disabledReason: null,
      })
    }
  }

  return { pills, suggestions }
}

function sortedRules(rules: Record<string, StyleRule>): StyleRule[] {
  return Object.values(rules).slice().sort((a, b) => {
    const byOrder = normaliseOrder(a) - normaliseOrder(b)
    return byOrder !== 0 ? byOrder : a.name.localeCompare(b.name)
  })
}

function normaliseOrder(rule: StyleRule): number {
  return Number.isFinite(rule.order) ? rule.order : 0
}

function matchAmbientRule(rule: StyleRule, selectedElement: Element | null): SelectorMatch | null {
  if (!selectedElement) return null
  const selector = styleRuleSelector(rule)
  if (safeMatches(selectedElement, selector)) return { kind: 'direct' }

  const pseudo = trailingSupportedPseudo(selector)
  if (!pseudo) return null
  const stripped = selector.slice(0, -pseudo.length).trim()
  if (!stripped) return null
  return safeMatches(selectedElement, stripped) ? { kind: 'inactive-pseudo', pseudo } : null
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector)
  } catch (_err) {
    // Corrupt persisted selectors must not break the Properties panel render path.
    return false
  }
}

function trailingSupportedPseudo(selector: string): string | null {
  return SUPPORTED_TRAILING_PSEUDOS.find((pseudo) => selector.endsWith(pseudo)) ?? null
}
