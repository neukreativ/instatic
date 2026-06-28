import { describe, it, expect } from 'bun:test'
import { DEFAULT_BREAKPOINTS } from '@core/page-tree'
import type { StyleRule } from '@core/page-tree'
import {
  mediaQueryMatchesViewportWidth,
  resolveRuleCurrentStyles,
  resolveViewportCascadeStyles,
} from '@site/panels/PropertiesPanel/breakpointStyleCascade'

function makeRule(overrides: Partial<StyleRule> = {}): StyleRule {
  return {
    id: 'cls-1',
    name: 'grid',
    selector: '.grid',
    styles: {},
    contextStyles: {},
    ...overrides,
  }
}

describe('mediaQueryMatchesViewportWidth', () => {
  it('matches max-width queries at or below the threshold', () => {
    expect(mediaQueryMatchesViewportWidth('(max-width: 768px)', 375)).toBe(true)
    expect(mediaQueryMatchesViewportWidth('(max-width: 768px)', 768)).toBe(true)
    expect(mediaQueryMatchesViewportWidth('(max-width: 768px)', 769)).toBe(false)
  })

  it('matches min-width queries at or above the threshold', () => {
    expect(mediaQueryMatchesViewportWidth('(min-width: 768px)', 768)).toBe(true)
    expect(mediaQueryMatchesViewportWidth('(min-width: 768px)', 1200)).toBe(true)
    expect(mediaQueryMatchesViewportWidth('(min-width: 768px)', 767)).toBe(false)
  })
})

describe('resolveViewportCascadeStyles', () => {
  it('inherits tablet grid columns on mobile when mobile has no override', () => {
    const rule = makeRule({
      styles: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' },
      contextStyles: {
        tablet: { gridTemplateColumns: 'repeat(3, 1fr)' },
      },
    })

    const mobileWidth = DEFAULT_BREAKPOINTS.find((bp) => bp.id === 'mobile')!.width
    const resolved = resolveViewportCascadeStyles({
      rule,
      breakpoints: DEFAULT_BREAKPOINTS,
      viewportWidth: mobileWidth,
    })

    expect(resolved.gridTemplateColumns).toBe('repeat(3, 1fr)')
  })

  it('lets a narrower breakpoint override a wider one', () => {
    const rule = makeRule({
      styles: { gridTemplateColumns: 'repeat(4, 1fr)' },
      contextStyles: {
        tablet: { gridTemplateColumns: 'repeat(3, 1fr)' },
        mobile: { gridTemplateColumns: 'repeat(2, 1fr)' },
      },
    })

    const mobileWidth = DEFAULT_BREAKPOINTS.find((bp) => bp.id === 'mobile')!.width
    const resolved = resolveViewportCascadeStyles({
      rule,
      breakpoints: DEFAULT_BREAKPOINTS,
      viewportWidth: mobileWidth,
    })

    expect(resolved.gridTemplateColumns).toBe('repeat(2, 1fr)')
  })

  it('does not apply tablet overrides when editing at tablet width without mobile match', () => {
    const rule = makeRule({
      styles: { gridTemplateColumns: 'repeat(4, 1fr)' },
      contextStyles: {
        mobile: { gridTemplateColumns: 'repeat(2, 1fr)' },
      },
    })

    const tabletWidth = DEFAULT_BREAKPOINTS.find((bp) => bp.id === 'tablet')!.width
    const resolved = resolveViewportCascadeStyles({
      rule,
      breakpoints: DEFAULT_BREAKPOINTS,
      viewportWidth: tabletWidth,
    })

    expect(resolved.gridTemplateColumns).toBe('repeat(4, 1fr)')
  })
})

describe('resolveRuleCurrentStyles', () => {
  it('returns base styles on desktop', () => {
    const rule = makeRule({
      styles: { display: 'flex' },
      contextStyles: { tablet: { display: 'grid' } },
    })

    expect(
      resolveRuleCurrentStyles({
        rule,
        breakpoints: DEFAULT_BREAKPOINTS,
        activeContextId: null,
        activeBreakpointId: 'desktop',
        onCondition: false,
      }).display,
    ).toBe('flex')
  })

  it('cascades viewport overrides on breakpoint tabs', () => {
    const rule = makeRule({
      styles: { gridTemplateColumns: 'repeat(4, 1fr)' },
      contextStyles: { tablet: { gridTemplateColumns: 'repeat(3, 1fr)' } },
    })

    expect(
      resolveRuleCurrentStyles({
        rule,
        breakpoints: DEFAULT_BREAKPOINTS,
        activeContextId: 'mobile',
        activeBreakpointId: 'mobile',
        onCondition: false,
      }).gridTemplateColumns,
    ).toBe('repeat(3, 1fr)')
  })
})
