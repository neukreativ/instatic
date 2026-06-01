import { describe, expect, it } from 'bun:test'
import { classifySelectorCreateInput, type PageNode, type StyleRule } from '@core/page-tree'
import { deriveSelectorPickerModel } from '@site/panels/PropertiesPanel/selectorPickerModel'

function rule(overrides: Partial<StyleRule> & { id: string; name: string }): StyleRule {
  return {
    id: overrides.id,
    name: overrides.name,
    kind: 'class',
    selector: `.${overrides.name}`,
    order: 0,
    styles: {},
    contextStyles: {},
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

function node(classIds: string[] = []): PageNode {
  return {
    id: 'title',
    moduleId: 'base.text',
    props: {},
    breakpointOverrides: {},
    children: [],
    classIds,
  }
}

describe('selectorPickerModel', () => {
  it('matches a descendant selector on the selected element subject only', () => {
    document.body.innerHTML = '<section class="hero"><h1 data-node-id="title" class="title"></h1></section>'
    const selected = document.querySelector<HTMLElement>('[data-node-id="title"]')!
    const ancestor = document.querySelector<HTMLElement>('.hero')!
    const heroTitle = rule({
      id: 'ambient-1',
      name: '.hero .title',
      kind: 'ambient',
      selector: '.hero .title',
    })

    const selectedModel = deriveSelectorPickerModel({
      rules: { [heroTitle.id]: heroTitle },
      node: node(),
      selectedElement: selected,
      activeRuleId: null,
    })
    const ancestorModel = deriveSelectorPickerModel({
      rules: { [heroTitle.id]: heroTitle },
      node: node(),
      selectedElement: ancestor,
      activeRuleId: null,
    })

    expect(selectedModel.pills.map((pill) => pill.rule.id)).toEqual(['ambient-1'])
    expect(ancestorModel.pills.map((pill) => pill.rule.id)).toEqual([])
  })

  it('includes trailing pseudo selectors as inactive matches', () => {
    document.body.innerHTML = '<a data-node-id="link" href="#">Link</a>'
    const selected = document.querySelector<HTMLElement>('[data-node-id="link"]')!
    const hover = rule({
      id: 'hover',
      name: 'a:hover',
      kind: 'ambient',
      selector: 'a:hover',
    })

    const model = deriveSelectorPickerModel({
      rules: { [hover.id]: hover },
      node: { ...node(), id: 'link' },
      selectedElement: selected,
      activeRuleId: null,
    })

    expect(model.pills).toHaveLength(1)
    expect(model.pills[0].match).toEqual({ kind: 'inactive-pseudo', pseudo: ':hover' })
  })

  it('disables non-matching ambient selector suggestions', () => {
    document.body.innerHTML = '<h1 data-node-id="title" class="title"></h1>'
    const selected = document.querySelector<HTMLElement>('[data-node-id="title"]')!
    const card = rule({ id: 'card', name: '.card', kind: 'ambient', selector: '.card' })

    const model = deriveSelectorPickerModel({
      rules: { [card.id]: card },
      node: node(),
      selectedElement: selected,
      activeRuleId: null,
    })

    expect(model.suggestions[0]).toMatchObject({
      rule: card,
      disabled: true,
      disabledReason: "Doesn't match this element",
    })
  })

  it('infers class creation for class-like input and ambient creation for selector-shaped input', () => {
    expect(classifySelectorCreateInput('display')).toEqual({ kind: 'class', name: 'display' })
    expect(classifySelectorCreateInput('.display')).toEqual({ kind: 'class', name: 'display' })
    expect(classifySelectorCreateInput('.hero .title')).toEqual({ kind: 'ambient', selector: '.hero .title' })
    expect(classifySelectorCreateInput('a:hover')).toEqual({ kind: 'ambient', selector: 'a:hover' })
  })
})
