import { describe, expect, it } from 'bun:test'
import { resolveSectionDefaultOpen } from '@site/panels/PropertiesPanel/propertiesSectionsMode'
import {
  countRuleSetProperties,
  findSelectorWithMostSetProperties,
} from '@site/panels/PropertiesPanel/styleSelectionUtils'
import type { StyleRule } from '@core/page-tree'
import type { SelectorPillItem } from '@site/panels/PropertiesPanel/selectorPickerModel'

function makeRule(id: string, styles: Record<string, unknown> = {}): StyleRule {
  return {
    id,
    name: id,
    kind: 'class',
    selector: `.${id}`,
    styles,
    contextStyles: {},
  }
}

function makePill(rule: StyleRule, match: SelectorPillItem['match'] = { kind: 'direct' }): SelectorPillItem {
  return { rule, match, active: false, removable: true }
}

describe('propertiesSectionsMode', () => {
  it('opens only sections with set values in active mode', () => {
    expect(resolveSectionDefaultOpen('expanded', 0)).toBe(true)
    expect(resolveSectionDefaultOpen('expanded', 3)).toBe(true)
    expect(resolveSectionDefaultOpen('collapsed', 3)).toBe(false)
    expect(resolveSectionDefaultOpen('active', 0)).toBe(false)
    expect(resolveSectionDefaultOpen('active', 2)).toBe(true)
  })
})

describe('styleSelectionUtils', () => {
  it('counts set properties on a rule', () => {
    const rule = makeRule('a', { color: '#fff', marginTop: '8px', display: null })
    expect(countRuleSetProperties(rule, null)).toBe(2)
  })

  it('picks the selector pill with the most overrides', () => {
    const sparse = makeRule('sparse', { color: '#000' })
    const rich = makeRule('rich', { color: '#fff', marginTop: '8px', paddingLeft: '4px' })
    const pills = [makePill(sparse), makePill(rich)]

    expect(findSelectorWithMostSetProperties(pills, null)).toBe('rich')
  })

  it('prefers the strongest pill when override counts tie', () => {
    const weak = makeRule('weak', { color: '#111' })
    const strong = makeRule('strong', { color: '#222' })
    const pills = [makePill(weak), makePill(strong)]

    expect(findSelectorWithMostSetProperties(pills, null)).toBe('strong')
  })
})
