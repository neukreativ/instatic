/**
 * Unit tests for cssToStyleRules — Phase 1 of the Super Import pipeline.
 *
 * One describe block per row (or group of closely-related rows) of the
 * mapping table in docs/plans/2026-05-29-super-import.md §Phase 1.
 *
 * Environment note:
 * Tests run under happy-dom (see src/__tests__/setup.ts). happy-dom's
 * CSSStyleSheet is available on globalThis.window (not globalThis directly).
 * cssToStyleRules falls back to window.CSSStyleSheet automatically.
 *
 * Malformed CSS note:
 * happy-dom does NOT throw for most malformed CSS — it silently parses
 * what it can. The try/catch in cssToStyleRules handles real browsers and
 * environments where replaceSync throws. The "resilience" tests below verify
 * graceful non-crashing behavior for both cases.
 */

import { describe, it, expect } from 'bun:test'
import { cssToStyleRules } from '@core/siteImport'

// ---------------------------------------------------------------------------
// Selector classification
// ---------------------------------------------------------------------------

describe('cssToStyleRules — selector classification', () => {
  it('.foo → kind:class, name:foo, selector:.foo', () => {
    const { rules, warnings } = cssToStyleRules('.foo { color: red }')
    expect(rules).toHaveLength(1)
    expect(rules[0].kind).toBe('class')
    expect(rules[0].name).toBe('foo')
    expect(rules[0].selector).toBe('.foo')
    expect(rules[0].styles).toMatchObject({ color: 'red' })
    expect(warnings).toHaveLength(0)
  })

  it('h1 → kind:ambient, name:h1, selector:h1', () => {
    const { rules } = cssToStyleRules('h1 { color: red }')
    expect(rules).toHaveLength(1)
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].name).toBe('h1')
    expect(rules[0].selector).toBe('h1')
  })

  it('body → ambient', () => {
    const { rules } = cssToStyleRules('body { color: red }')
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].selector).toBe('body')
  })

  it('* → ambient', () => {
    const { rules } = cssToStyleRules('* { color: red }')
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].selector).toBe('*')
  })

  it('nav → ambient', () => {
    const { rules } = cssToStyleRules('nav { color: red }')
    expect(rules[0].kind).toBe('ambient')
  })

  it('.hero .title → ambient (descendant)', () => {
    const { rules } = cssToStyleRules('.hero .title { color: red }')
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].selector).toBe('.hero .title')
  })

  it('h1 > span → ambient (child combinator)', () => {
    const { rules } = cssToStyleRules('h1 > span { color: red }')
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].selector).toBe('h1 > span')
  })

  it('a:hover → ambient (pseudo-class)', () => {
    const { rules } = cssToStyleRules('a:hover { color: red }')
    expect(rules[0].kind).toBe('ambient')
    expect(rules[0].selector).toBe('a:hover')
  })

  it('[data-state="on"] → ambient (attribute selector)', () => {
    const { rules } = cssToStyleRules('[data-state="on"] { color: red }')
    expect(rules[0].kind).toBe('ambient')
    // The selector may be normalised by the CSS engine (quotes may change);
    // we just verify kind and that the selector contains the key attribute text
    expect(rules[0].selector).toContain('data-state')
  })

  it('.foo.bar → ambient (compound — two classes, no space)', () => {
    const { rules } = cssToStyleRules('.foo.bar { color: red }')
    expect(rules[0].kind).toBe('ambient')
  })
})

// ---------------------------------------------------------------------------
// @media policy — matched breakpoint
// ---------------------------------------------------------------------------

describe('cssToStyleRules — @media → breakpointStyles (matched)', () => {
  it('base + matched @media → 1 rule, base styles + breakpointStyles', () => {
    const css = '.foo { color: red }\n@media (max-width: 768px) { .foo { color: blue } }'
    const { rules, warnings } = cssToStyleRules(css, {
      breakpoints: [{ id: 'tablet', width: 768 }],
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toMatchObject({ color: 'red' })
    expect(rules[0].breakpointStyles.tablet).toMatchObject({ color: 'blue' })
    expect(warnings).toHaveLength(0)
  })

  it('@media within tolerance is matched', () => {
    const css = '.foo { color: red }\n@media (max-width: 768px) { .foo { color: blue } }'
    const { rules, warnings } = cssToStyleRules(css, {
      breakpoints: [{ id: 'tablet', width: 780 }],
      mediaTolerance: 15,
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].breakpointStyles.tablet).toMatchObject({ color: 'blue' })
    expect(warnings).toHaveLength(0)
  })

  it('@media creates a new rule if no base rule existed for the selector', () => {
    const css = '@media (max-width: 768px) { .foo { color: blue } }'
    const { rules } = cssToStyleRules(css, {
      breakpoints: [{ id: 'mobile', width: 768 }],
    })
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toEqual({})
    expect(rules[0].breakpointStyles.mobile).toMatchObject({ color: 'blue' })
  })
})

// ---------------------------------------------------------------------------
// @media policy — unmatched (no breakpoint match)
// ---------------------------------------------------------------------------

describe('cssToStyleRules — @media unmatched → fold into base + warning', () => {
  it('unmatched @media folds inner declarations into base styles + emits warning', () => {
    const css = '.foo { color: red }\n@media (max-width: 768px) { .foo { color: blue } }'
    const { rules, warnings } = cssToStyleRules(css, {
      breakpoints: [{ id: 'desktop', width: 1200 }],
    })
    expect(rules).toHaveLength(1)
    // Base color='red' is preserved (base-takes-precedence on fold)
    expect(rules[0].styles).toMatchObject({ color: 'red' })
    // Warning is emitted
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('unmatched-media-query')
    expect(warnings[0].message).toContain('max-width')
  })

  it('unmatched @media adds NEW properties into base styles', () => {
    // The @media has a property not in the base — it should be added
    const css = '.foo { color: red }\n@media (max-width: 768px) { .foo { font-size: 14px } }'
    const { rules } = cssToStyleRules(css, {
      breakpoints: [{ id: 'desktop', width: 1200 }],
    })
    expect(rules[0].styles).toMatchObject({ color: 'red', fontSize: '14px' })
  })

  it('unmatched @media with no breakpoints emits warning', () => {
    const css = '@media (max-width: 768px) { .foo { color: red } }'
    const { rules, warnings } = cssToStyleRules(css, { breakpoints: [] })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('unmatched-media-query')
    // The rule is still created with the folded base style
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toMatchObject({ color: 'red' })
  })
})

// ---------------------------------------------------------------------------
// Dropped @-rules
// ---------------------------------------------------------------------------

describe('cssToStyleRules — dropped @-rules', () => {
  it('@keyframes → no rule, 1 dropped-at-rule warning', () => {
    const { rules, warnings } = cssToStyleRules(
      '@keyframes pulse { from { opacity: 0 } to { opacity: 1 } }',
    )
    expect(rules).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('dropped-at-rule')
  })

  it('@font-face → no rule, 1 dropped-at-rule warning (url inside is NOT in assetRefs)', () => {
    const { rules, warnings, assetRefs } = cssToStyleRules(
      "@font-face { font-family: 'Foo'; src: url('foo.woff') }",
    )
    expect(rules).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('dropped-at-rule')
    // url() inside a dropped @font-face must NOT appear in assetRefs
    expect(assetRefs).toHaveLength(0)
  })

  it('@import → no rule, 1 dropped-at-rule warning (when surfaced by the engine)', () => {
    // Note: most CSS engines silently ignore @import inside replaceSync, so
    // this may produce 0 rules + 0 warnings in some environments.
    // When the engine DOES surface an @import rule, we emit a warning.
    const { rules } = cssToStyleRules("@import url('other.css');")
    // Either 0 rules (silently ignored) or 0 rules + 1 warning (surfaced).
    // Either way, no rule must be produced.
    expect(rules).toHaveLength(0)
  })

  it('@supports → no rule, 1 dropped-at-rule warning', () => {
    const { rules, warnings } = cssToStyleRules(
      '@supports (display: grid) { .foo { display: grid } }',
    )
    expect(rules).toHaveLength(0)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('dropped-at-rule')
  })
})

// ---------------------------------------------------------------------------
// Property allowlist filtering
// ---------------------------------------------------------------------------

describe('cssToStyleRules — property allowlist', () => {
  it('unknown properties are dropped with an unknown-property warning', () => {
    const { rules, warnings } = cssToStyleRules('.foo { color: red; some-unknown-prop: 1 }')
    expect(rules).toHaveLength(1)
    // Only known property survives
    expect(Object.keys(rules[0].styles)).toEqual(['color'])
    expect(rules[0].styles).toMatchObject({ color: 'red' })
    // One warning for the unknown prop
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('unknown-property')
    expect(warnings[0].property).toContain('some')
    expect(warnings[0].selector).toBe('.foo')
  })
})

// ---------------------------------------------------------------------------
// url(...) collection
// ---------------------------------------------------------------------------

describe('cssToStyleRules — url(...) collection', () => {
  it('single url → 1 assetRef', () => {
    const { rules, assetRefs } = cssToStyleRules(
      ".foo { background-image: url('assets/bg.png') }",
    )
    expect(rules).toHaveLength(1)
    expect(assetRefs).toHaveLength(1)
    expect(assetRefs[0].ruleIndex).toBe(0)
    expect(assetRefs[0].rawUrl).toBe('assets/bg.png')
    expect(assetRefs[0].property).toBe('backgroundImage')
    expect(assetRefs[0].breakpointId).toBeUndefined()
  })

  it('multiple urls in one declaration → 2 assetRefs on same rule', () => {
    // Use background-image (not the background shorthand) to guarantee both
    // url() payloads survive CSS-engine normalization in happy-dom.
    const { rules, assetRefs } = cssToStyleRules(
      '.foo { background-image: url(a.png), url(b.png) }',
    )
    expect(rules).toHaveLength(1)
    expect(assetRefs).toHaveLength(2)
    const urls = assetRefs.map((r) => r.rawUrl)
    expect(urls).toContain('a.png')
    expect(urls).toContain('b.png')
    // Both point at the same rule
    expect(assetRefs[0].ruleIndex).toBe(0)
    expect(assetRefs[1].ruleIndex).toBe(0)
  })

  it('url in matched @media breakpointStyles → assetRef with breakpointId', () => {
    const css = '@media (max-width: 768px) { .foo { background-image: url("mobile.png") } }'
    const { assetRefs } = cssToStyleRules(css, {
      breakpoints: [{ id: 'tablet', width: 768 }],
    })
    expect(assetRefs).toHaveLength(1)
    expect(assetRefs[0].breakpointId).toBe('tablet')
    expect(assetRefs[0].rawUrl).toBe('mobile.png')
  })
})

// ---------------------------------------------------------------------------
// Resilience
// ---------------------------------------------------------------------------

describe('cssToStyleRules — resilience', () => {
  it('empty input → empty result, no warnings', () => {
    const { rules, warnings, assetRefs } = cssToStyleRules('')
    expect(rules).toHaveLength(0)
    expect(warnings).toHaveLength(0)
    expect(assetRefs).toHaveLength(0)
  })

  it('whitespace-only input → empty result, no warnings', () => {
    const { rules, warnings, assetRefs } = cssToStyleRules('   \n  \t  ')
    expect(rules).toHaveLength(0)
    expect(warnings).toHaveLength(0)
    expect(assetRefs).toHaveLength(0)
  })

  it('malformed CSS is handled gracefully without crashing', () => {
    // happy-dom does not throw for most malformed CSS; it silently parses
    // what it can. This test verifies no crash and a valid result shape.
    // In a real browser, replaceSync may throw and produce an invalid-rule
    // warning with an empty rules array.
    expect(() => cssToStyleRules('not valid css {{{')).not.toThrow()
    const result = cssToStyleRules('not valid css {{{')
    expect(result.rules).toBeDefined()
    expect(result.warnings).toBeDefined()
    expect(result.assetRefs).toBeDefined()
    // If an invalid-rule warning was emitted (real browser), no rules expected.
    if (result.warnings.some((w) => w.kind === 'invalid-rule')) {
      expect(result.rules).toHaveLength(0)
    }
  })

  it('{{{ produces empty result (happy-dom: 0 rules parsed)', () => {
    const { rules, warnings } = cssToStyleRules('{{{')
    expect(rules).toHaveLength(0)
    // May or may not emit a warning depending on environment
    expect(Array.isArray(warnings)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Property name conversion (kebab → camelCase)
// ---------------------------------------------------------------------------

describe('cssToStyleRules — property name conversion', () => {
  it('background-color → backgroundColor', () => {
    const { rules } = cssToStyleRules('.foo { background-color: red }')
    expect(rules[0].styles).toHaveProperty('backgroundColor', 'red')
    expect(rules[0].styles).not.toHaveProperty('background-color')
  })

  it('font-size → fontSize', () => {
    const { rules } = cssToStyleRules('.foo { font-size: 16px }')
    expect(rules[0].styles).toHaveProperty('fontSize', '16px')
  })

  it('z-index → zIndex', () => {
    const { rules } = cssToStyleRules('.foo { z-index: 10 }')
    expect(rules[0].styles).toHaveProperty('zIndex', '10')
  })
})

// ---------------------------------------------------------------------------
// Class name with hyphens
// ---------------------------------------------------------------------------

describe('cssToStyleRules — class names with hyphens', () => {
  it('.btn-primary → kind:class, name:btn-primary', () => {
    const { rules } = cssToStyleRules('.btn-primary { color: red }')
    expect(rules[0].kind).toBe('class')
    expect(rules[0].name).toBe('btn-primary')
    expect(rules[0].selector).toBe('.btn-primary')
  })

  it('.my-long-class-name → kind:class', () => {
    const { rules } = cssToStyleRules('.my-long-class-name { color: red }')
    expect(rules[0].kind).toBe('class')
    expect(rules[0].name).toBe('my-long-class-name')
  })
})

// ---------------------------------------------------------------------------
// Ambient rule — name and selector
// ---------------------------------------------------------------------------

describe('cssToStyleRules — ambient name defaults to selector', () => {
  it('h1 > span: name and selector both equal "h1 > span"', () => {
    const { rules } = cssToStyleRules('h1 > span { color: red }')
    // The CSS engine may normalise whitespace; check trimmed match
    expect(rules[0].name.trim()).toBe(rules[0].selector.trim())
    expect(rules[0].name.replace(/\s+/g, ' ').trim()).toContain('h1')
    expect(rules[0].name.replace(/\s+/g, ' ').trim()).toContain('span')
  })

  it('h1: name and selector both equal "h1"', () => {
    const { rules } = cssToStyleRules('h1 { color: red }')
    expect(rules[0].name).toBe('h1')
    expect(rules[0].selector).toBe('h1')
  })
})

// ---------------------------------------------------------------------------
// Duplicate class names
// ---------------------------------------------------------------------------

describe('cssToStyleRules — duplicate class names', () => {
  it('duplicate .foo → 1 rule with later value + 1 duplicate-class warning', () => {
    const { rules, warnings } = cssToStyleRules('.foo { color: red } .foo { color: blue }')
    expect(rules).toHaveLength(1)
    // Later rule wins: color should be 'blue'
    expect(rules[0].styles).toMatchObject({ color: 'blue' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('duplicate-class')
    expect(warnings[0].selector).toBe('.foo')
  })

  it('ambient h1 duplicates are allowed (no dedup for ambient)', () => {
    // Two h1 rules are valid CSS (cascade resolves by source order)
    const { rules, warnings } = cssToStyleRules('h1 { color: red } h1 { color: blue }')
    // Expect 2 separate ambient rules (not deduplicated)
    expect(rules).toHaveLength(2)
    expect(warnings.filter((w) => w.kind === 'duplicate-class')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Order assignment
// ---------------------------------------------------------------------------

describe('cssToStyleRules — order assignment', () => {
  it('three rules in source order → order: 0, 1, 2', () => {
    const { rules } = cssToStyleRules(
      'h1 { color: red } .foo { color: blue } body { color: green }',
    )
    expect(rules).toHaveLength(3)
    expect(rules[0].order).toBe(0)
    expect(rules[1].order).toBe(1)
    expect(rules[2].order).toBe(2)
  })

  it('order is stable — rules are emitted in source position', () => {
    const { rules } = cssToStyleRules('.a { color: red } .b { color: blue } .c { color: green }')
    const names = rules.map((r) => r.name)
    expect(names).toEqual(['a', 'b', 'c'])
    expect(rules.map((r) => r.order)).toEqual([0, 1, 2])
  })
})

// ---------------------------------------------------------------------------
// Integration: class rule round-trip
// ---------------------------------------------------------------------------

describe('cssToStyleRules — integration', () => {
  it('multiple class rules produce independent NewStyleRule objects', () => {
    const css = '.hero { background-color: #fff; padding: 20px } .title { font-size: 24px; color: #333 }'
    // Note: padding and background-color are in ALLOWED_PROPS; #fff/#333 hex values pass through
    const { rules, warnings } = cssToStyleRules(css)
    expect(rules).toHaveLength(2)
    expect(rules[0].name).toBe('hero')
    expect(rules[1].name).toBe('title')
    // Unknown-property warnings are OK; we just verify structure
    const ruleNames = new Set(rules.map((r) => r.name))
    expect(ruleNames.has('hero')).toBe(true)
    expect(ruleNames.has('title')).toBe(true)
  })

  it('rule with only unknown properties → 1 rule with empty styles + warnings', () => {
    const { rules, warnings } = cssToStyleRules('.foo { totally-made-up: 1; also-fake: 2 }')
    expect(rules).toHaveLength(1)
    expect(Object.keys(rules[0].styles)).toHaveLength(0)
    expect(warnings.filter((w) => w.kind === 'unknown-property')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// Allowlist expansion — 9 modern CSS properties
//
// Each test verifies:
//   1. No unknown-property warning for the property (it is in ALLOWED_PROPS).
//   2. The camelCase key appears in rules[0].styles (CSS engine parsed it).
//
// If the test environment's CSS engine (happy-dom) silently drops a property
// without surfacing it in CSSStyleDeclaration, assertion (2) will fail — that
// is a CSS-engine limitation, not an allowlist regression.
// ---------------------------------------------------------------------------

describe('cssToStyleRules — ALLOWED_PROPS expansion: isolation', () => {
  it('isolation: isolate → no unknown-property warning, key present in styles', () => {
    const { rules, warnings } = cssToStyleRules('.foo { isolation: isolate }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'isolation')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('isolation')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: backgroundPositionX', () => {
  it('background-position-x: 50% → no unknown-property warning, key present', () => {
    const { rules, warnings } = cssToStyleRules('.foo { background-position-x: 50% }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'backgroundPositionX')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('backgroundPositionX')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: backgroundPositionY', () => {
  it('background-position-y: 50% → no unknown-property warning, key present', () => {
    const { rules, warnings } = cssToStyleRules('.foo { background-position-y: 50% }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'backgroundPositionY')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('backgroundPositionY')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: backgroundAttachment', () => {
  it('background-attachment: fixed → no unknown-property warning, key present', () => {
    const { rules, warnings } = cssToStyleRules('.foo { background-attachment: fixed }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'backgroundAttachment')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('backgroundAttachment')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: backgroundOrigin', () => {
  it('background-origin: content-box → no unknown-property warning, key present', () => {
    const { rules, warnings } = cssToStyleRules('.foo { background-origin: content-box }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'backgroundOrigin')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('backgroundOrigin')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: backgroundClip', () => {
  it('background-clip: text → no unknown-property warning, key present', () => {
    const { rules, warnings } = cssToStyleRules('.foo { background-clip: text }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'backgroundClip')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('backgroundClip')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: content', () => {
  it('content: "" → no unknown-property warning, key present', () => {
    // content is valid on any element (CSS spec allows it, though browsers
    // may treat it as a no-op outside pseudo-elements).
    const { rules, warnings } = cssToStyleRules('.foo { content: "" }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'content')).toHaveLength(0)
    expect(rules).toHaveLength(1)
    expect(rules[0].styles).toHaveProperty('content')
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: textWrapMode', () => {
  it('text-wrap-mode: nowrap → no unknown-property warning', () => {
    // text-wrap-mode is a CSS Text Level 4 property. If the CSS engine (happy-dom)
    // does not recognise it, it will simply not appear in CSSStyleDeclaration and
    // no warning of any kind is emitted — that is a CSS-engine limitation, not an
    // allowlist regression. We at minimum verify no false unknown-property warning.
    const { warnings } = cssToStyleRules('.foo { text-wrap-mode: nowrap }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'textWrapMode')).toHaveLength(0)
  })
})

describe('cssToStyleRules — ALLOWED_PROPS expansion: textWrapStyle', () => {
  it('text-wrap-style: balance → no unknown-property warning', () => {
    // Same caveat as text-wrap-mode above.
    const { warnings } = cssToStyleRules('.foo { text-wrap-style: balance }')
    expect(warnings.filter((w) => w.kind === 'unknown-property' && w.property === 'textWrapStyle')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// @media deduplication — unmatched-media-query warning fires once per unique
// condition text, not once per @media block occurrence.
// ---------------------------------------------------------------------------

describe('cssToStyleRules — unmatched-media-query warning deduplication', () => {
  it('5 @media blocks with the same condition → exactly 1 unmatched-media-query warning', () => {
    // Tailwind v4 emits one @media block per utility class, so a single
    // breakpoint condition can appear dozens of times in the output.
    const css = [
      '@media (max-width: 860px) { .a { color: red } }',
      '@media (max-width: 860px) { .b { color: blue } }',
      '@media (max-width: 860px) { .c { font-size: 14px } }',
      '@media (max-width: 860px) { .d { margin-top: 0px } }',
      '@media (max-width: 860px) { .e { padding-top: 0px } }',
    ].join('\n')
    const { warnings } = cssToStyleRules(css, { breakpoints: [] })
    const unmatchedWarnings = warnings.filter((w) => w.kind === 'unmatched-media-query')
    expect(unmatchedWarnings).toHaveLength(1)
    expect(unmatchedWarnings[0].message).toContain('max-width')
  })

  it('two different unmatched conditions → 2 unmatched-media-query warnings', () => {
    const css = [
      '@media (max-width: 860px) { .a { color: red } }',
      '@media (max-width: 480px) { .b { color: blue } }',
    ].join('\n')
    const { warnings } = cssToStyleRules(css, { breakpoints: [] })
    const unmatchedWarnings = warnings.filter((w) => w.kind === 'unmatched-media-query')
    expect(unmatchedWarnings).toHaveLength(2)
  })

  it('deduplication does not suppress unknown-property warnings (regression)', () => {
    const { warnings } = cssToStyleRules('.foo { not-a-real-property: 1 }')
    expect(warnings.filter((w) => w.kind === 'unknown-property')).toHaveLength(1)
    expect(warnings[0].property).toContain('notA')
  })
})
