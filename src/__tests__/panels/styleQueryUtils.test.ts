import { describe, expect, it } from 'bun:test'
import type { StyleRule } from '@core/page-tree'
import type { SelectorPillItem } from '@site/panels/PropertiesPanel/selectorPickerModel'
import {
  findBestSelectorForStyleQuery,
  findFirstMatchingStyleSectionId,
  resolveAutoFocusSelectorForStyleQuery,
  ruleHasSetPropertyMatchingQuery,
} from '@site/panels/PropertiesPanel/styleQueryUtils'

function makeRule(
  id: string,
  name: string,
  styles: Record<string, unknown> = {},
): StyleRule {
  return {
    id,
    name,
    kind: 'class',
    selector: `.${name}`,
    order: 0,
    styles,
    contextStyles: {},
  }
}

function pill(rule: StyleRule): SelectorPillItem {
  return {
    rule,
    match: { kind: 'direct' },
    active: false,
    removable: true,
  }
}

describe('styleQueryUtils', () => {
  it('detects set border properties matching a section query', () => {
    const rule = makeRule('soft', 'soft', { borderTopWidth: '1px' })
    expect(ruleHasSetPropertyMatchingQuery(rule, 'border', null)).toBe(true)
    expect(ruleHasSetPropertyMatchingQuery(rule, 'typography', null)).toBe(false)
  })

  it('prefers the strongest selector pill that owns a set match', () => {
    const section = makeRule('section', 'section')
    const soft = makeRule('soft', 'soft', { borderTopWidth: '2px' })
    const pills = [pill(section), pill(soft)]

    expect(findBestSelectorForStyleQuery(pills, 'border', null)).toBe('soft')
  })

  it('does not auto-focus when the active rule already has a set match', () => {
    const section = makeRule('section', 'section', { borderTopWidth: '1px' })
    const soft = makeRule('soft', 'soft', { borderTopWidth: '2px' })
    const pills = [pill(section), pill(soft)]

    expect(
      resolveAutoFocusSelectorForStyleQuery({
        query: 'border',
        pills,
        activeClassId: 'section',
        activeContextId: null,
        activeClass: section,
      }),
    ).toBeNull()
  })

  it('auto-focuses the strongest selector when the active rule lacks a set match', () => {
    const section = makeRule('section', 'section')
    const soft = makeRule('soft', 'soft', { borderTopWidth: '2px' })
    const pills = [pill(section), pill(soft)]

    expect(
      resolveAutoFocusSelectorForStyleQuery({
        query: 'border',
        pills,
        activeClassId: 'section',
        activeContextId: null,
        activeClass: section,
      }),
    ).toBe('soft')
  })

  it('finds the first section id with a set matching property', () => {
    expect(
      findFirstMatchingStyleSectionId({ borderTopWidth: '1px' }, 'border'),
    ).toBe('border')
    expect(findFirstMatchingStyleSectionId({}, 'border')).toBeNull()
  })
})
