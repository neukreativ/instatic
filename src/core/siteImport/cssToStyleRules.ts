/**
 * cssToStyleRules — Phase 1 of the Super Import pipeline.
 *
 * Pure, headless CSS text → NewStyleRule[] parser. No UI, no zip handling,
 * no store integration. Just parse + classify + collect warnings + collect
 * asset refs.
 *
 * ## @media policy
 *
 * Matched @media (within ±mediaTolerance of a known breakpoint width):
 *   inner declarations are folded into `breakpointStyles[matchedBreakpointId]`.
 *
 * Unmatched @media (no breakpoint close enough):
 *   inner declarations are folded into the base `styles`, filling in only
 *   properties NOT already present in the base rule (base-takes-precedence
 *   semantics). One `unmatched-media-query` warning is emitted per unique
 *   condition text across all @media blocks in the file. Real-world CSS
 *   (e.g. Tailwind v4) can emit the same condition dozens of times — once per
 *   utility class — so we deduplicate to avoid warning floods.
 *
 * ## asset-reference warnings
 *
 * The parser collects `url(...)` payloads into `assetRefs` but does NOT emit
 * `asset-reference` entries in `warnings`. The `asset-reference` warning kind
 * exists for Phase 2's use; Phase 1 just records URLs for later rewriting.
 *
 * ## order assignment
 *
 * `order` is assigned ascending from 0 in source position. The caller
 * (Phase 2's `applyImport.ts`) may re-order on merge. For a rule created by
 * a matched @media block (when no base rule existed), order reflects the
 * source position of the @media block.
 *
 * ## duplicate class names
 *
 * When the same `.class-name` selector appears more than once in the file,
 * the later rule wins (later-in-source = higher cascade priority). One
 * `duplicate-class` warning is emitted per duplicated class. The rule's
 * order is kept as the FIRST occurrence.
 */

import { ALLOWED_PROPS } from '@core/publisher/classCss'
import type { StyleRuleKind } from '@core/page-tree'
import type { ImportWarning, BreakpointHint, AssetRef, NewStyleRule } from './types'

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface CssToStyleRulesOptions {
  /**
   * Site breakpoints used to match `@media (max-width: Npx)` queries.
   * Defaults to `[]` (all @media queries are treated as unmatched).
   */
  breakpoints?: BreakpointHint[]
  /**
   * Tolerance in CSS pixels for matching a media query width to a breakpoint.
   * A media query `(max-width: 768px)` matches a breakpoint of width 775px
   * if `mediaTolerance >= 7`. Defaults to 10.
   */
  mediaTolerance?: number
}

export interface CssToStyleRulesResult {
  rules: NewStyleRule[]
  warnings: ImportWarning[]
  assetRefs: AssetRef[]
}

// ---------------------------------------------------------------------------
// CSSRule type constants (CSSOM spec §6.1 — rule.type numeric values)
//
// Using rule.type instead of instanceof so the code works in both the browser
// (native CSSStyleRule global) and the happy-dom test environment (constructors
// live on window, not globalThis).
// ---------------------------------------------------------------------------

const STYLE_RULE_TYPE = 1   // CSSStyleRule
const IMPORT_RULE_TYPE = 3  // CSSImportRule
const MEDIA_RULE_TYPE = 4   // CSSMediaRule
const FONT_FACE_RULE_TYPE = 5  // CSSFontFaceRule
const PAGE_RULE_TYPE = 6    // CSSPageRule
const KEYFRAMES_RULE_TYPE = 7  // CSSKeyframesRule
const NAMESPACE_RULE_TYPE = 10 // CSSNamespaceRule
const SUPPORTS_RULE_TYPE = 12  // CSSSupportsRule

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a CSS source string for use in warning messages.
 * Appends `…` when the string is cut.
 */
function truncate(text: string, maxLen = 120): string {
  if (text.length <= maxLen) return text
  return `${text.slice(0, maxLen)}…`
}

/**
 * Convert a kebab-case CSS property name to camelCase.
 * "background-color" → "backgroundColor", "z-index" → "zIndex"
 */
function kebabToCamel(prop: string): string {
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * A single `.class-name` selector with no compound selectors, no combinators,
 * and no pseudo-classes/elements.
 *
 * Matches: `.foo`, `.btn-primary`, `.my_class`
 * Doesn't match: `.foo.bar`, `.foo .bar`, `h1`, `a:hover`, `[data-x]`, `.foo::after`
 */
const SINGLE_CLASS_RE = /^\.[a-zA-Z_][\w-]*$/

function classifySelector(selector: string): { kind: StyleRuleKind; name: string } {
  if (SINGLE_CLASS_RE.test(selector)) {
    // kind:'class' — selector is `.<name>`, name is the part after the dot
    return { kind: 'class', name: selector.slice(1) }
  }
  // kind:'ambient' — the selector text IS the display name
  return { kind: 'ambient', name: selector }
}

/**
 * Get the CSSStyleSheet constructor, falling back to the happy-dom window
 * object in test environments where the constructor is not on globalThis.
 */
function getSheetConstructor(): typeof CSSStyleSheet | null {
  if (typeof CSSStyleSheet !== 'undefined') return CSSStyleSheet
  // happy-dom test env: available on globalThis.window
  const w =
    typeof window !== 'undefined'
      ? (window as unknown as Record<string, unknown>)
      : null
  if (w?.CSSStyleSheet) return w.CSSStyleSheet as typeof CSSStyleSheet
  return null
}

/**
 * Extract the first `max-width: Npx` value from a CSS condition text.
 * Returns null if the condition doesn't match the expected form.
 */
function extractMaxWidthPx(conditionText: string): number | null {
  const m = conditionText.match(/\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)\s*px\s*\)/i)
  if (!m) return null
  return parseFloat(m[1])
}

/**
 * Match a media query condition text to a breakpoint within tolerance.
 * Currently handles `(max-width: Npx)` only.
 */
function matchBreakpoint(
  conditionText: string,
  breakpoints: BreakpointHint[],
  tolerance: number,
): BreakpointHint | null {
  const width = extractMaxWidthPx(conditionText)
  if (width === null) return null
  for (const bp of breakpoints) {
    if (Math.abs(bp.width - width) <= tolerance) return bp
  }
  return null
}

/**
 * Read all `url(...)` payloads from a CSS declaration value.
 * Handles single-quoted, double-quoted, and unquoted forms.
 * Handles multiple urls per value (e.g. `background: url(a) url(b)`).
 */
function extractUrlPayloads(value: string): string[] {
  const result: string[] = []
  // Captures: group 1 = optional quote char, group 2 = url content (excl. quotes/parens)
  const re = /url\(\s*(['"]?)([^'")\n]*)\1\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    const rawUrl = m[2].trim()
    if (rawUrl) result.push(rawUrl)
  }
  return result
}

/**
 * Parse all declarations from a CSSStyleDeclaration into a camelCase
 * Record, filtering to ALLOWED_PROPS. Returns both the allowed declarations
 * and one 'unknown-property' warning per dropped property.
 *
 * The brief specifies using `.length` + index access (not `for...of`) since
 * CSSStyleDeclaration doesn't enumerate properties via Symbol.iterator.
 */
function parseDeclarations(
  style: CSSStyleDeclaration,
  selectorForWarning: string,
  warnings: ImportWarning[],
): Record<string, unknown> {
  const decls: Record<string, unknown> = {}
  for (let i = 0; i < style.length; i++) {
    const kebab = style[i]
    const value = style.getPropertyValue(kebab).trim()
    if (!value) continue

    const camel = kebabToCamel(kebab)
    if (!ALLOWED_PROPS.has(camel)) {
      warnings.push({
        kind: 'unknown-property',
        message: `Property "${camel}" (${kebab}) is not in the allowed property set and was dropped`,
        selector: selectorForWarning,
        property: camel,
      })
      continue
    }

    decls[camel] = value
  }
  return decls
}

/**
 * Scan a declarations map for `url(...)` values and append AssetRef entries.
 */
function collectAssetRefsFromDecls(
  decls: Record<string, unknown>,
  ruleIndex: number,
  breakpointId: string | undefined,
  assetRefs: AssetRef[],
): void {
  for (const [property, value] of Object.entries(decls)) {
    if (typeof value !== 'string') continue
    for (const rawUrl of extractUrlPayloads(value)) {
      assetRefs.push({ ruleIndex, breakpointId, property, rawUrl })
    }
  }
}

/**
 * Human-readable @-rule name from the CSSOM `rule.type` integer.
 */
function atRuleName(type: number): string {
  switch (type) {
    case IMPORT_RULE_TYPE:   return '@import'
    case FONT_FACE_RULE_TYPE: return '@font-face'
    case PAGE_RULE_TYPE:     return '@page'
    case KEYFRAMES_RULE_TYPE: return '@keyframes'
    case NAMESPACE_RULE_TYPE: return '@namespace'
    case SUPPORTS_RULE_TYPE: return '@supports'
    default:                 return `CSS at-rule (type ${type})`
  }
}

// ---------------------------------------------------------------------------
// Main implementation
// ---------------------------------------------------------------------------

/**
 * Parse a CSS text string into an array of `NewStyleRule` objects.
 *
 * Uses the browser-native `CSSStyleSheet.replaceSync()` API (available in
 * modern browsers and happy-dom). If that throws (sheet-level parse error),
 * returns a single `invalid-rule` warning and no rules.
 *
 * @param cssText - Raw CSS source text.
 * @param options - Optional breakpoints + tolerance for @media matching.
 * @returns Parsed rules, warnings, and URL asset references.
 */
export function cssToStyleRules(
  cssText: string,
  options?: CssToStyleRulesOptions,
): CssToStyleRulesResult {
  const breakpoints = options?.breakpoints ?? []
  const mediaTolerance = options?.mediaTolerance ?? 10

  const rules: NewStyleRule[] = []
  const warnings: ImportWarning[] = []
  const assetRefs: AssetRef[] = []

  // ── Acquire the CSS engine ──────────────────────────────────────────────
  const SheetCtor = getSheetConstructor()
  if (!SheetCtor) {
    warnings.push({
      kind: 'invalid-rule',
      message: 'CSSStyleSheet is not available in this environment',
      source: truncate(cssText),
    })
    return { rules, warnings, assetRefs }
  }

  // ── Sheet-level parse ───────────────────────────────────────────────────
  let sheet: CSSStyleSheet
  try {
    sheet = new SheetCtor()
    sheet.replaceSync(cssText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    warnings.push({
      kind: 'invalid-rule',
      message: `CSS parse error: ${message}`,
      source: truncate(cssText),
    })
    return { rules, warnings, assetRefs }
  }

  // ── Rule-processing state ───────────────────────────────────────────────
  //
  // selectorToLastIndex: tracks the most-recently-created rule index for each
  //   selector. Used when @media inner rules need to look up or create a rule.
  //
  // seenClassSelectors: tracks class selectors seen in base rules so we can
  //   emit a duplicate-class warning on the second occurrence.
  //
  // warnedMediaConditions: tracks @media condition texts that have already had
  //   an `unmatched-media-query` warning emitted. Real-world CSS (e.g. Tailwind
  //   v4) can emit dozens of separate @media blocks for the same breakpoint
  //   condition (one per utility class). We collapse all those into a single
  //   warning per unique condition text.
  const selectorToLastIndex = new Map<string, number>()
  const seenClassSelectors = new Set<string>()
  const warnedMediaConditions = new Set<string>()

  // ── Process each top-level rule ─────────────────────────────────────────
  for (let i = 0; i < sheet.cssRules.length; i++) {
    const rule = sheet.cssRules[i]
    try {
      processTopLevelRule(
        rule,
        rules,
        warnings,
        assetRefs,
        breakpoints,
        mediaTolerance,
        selectorToLastIndex,
        seenClassSelectors,
        warnedMediaConditions,
      )
    } catch (_err) {
      // Per-rule resilience: if a rule throws unexpectedly, warn and continue.
      warnings.push({
        kind: 'invalid-rule',
        message: `Unexpected error processing rule: ${_err instanceof Error ? _err.message : String(_err)}`,
        source: truncate(rule.cssText),
      })
    }
  }

  return { rules, warnings, assetRefs }
}

// ---------------------------------------------------------------------------
// Top-level rule processing
// ---------------------------------------------------------------------------

function processTopLevelRule(
  rule: CSSRule,
  rules: NewStyleRule[],
  warnings: ImportWarning[],
  assetRefs: AssetRef[],
  breakpoints: BreakpointHint[],
  mediaTolerance: number,
  selectorToLastIndex: Map<string, number>,
  seenClassSelectors: Set<string>,
  warnedMediaConditions: Set<string>,
): void {
  switch (rule.type) {
    case STYLE_RULE_TYPE:
      processBaseStyleRule(
        rule as CSSStyleRule,
        rules,
        warnings,
        assetRefs,
        selectorToLastIndex,
        seenClassSelectors,
      )
      return

    case MEDIA_RULE_TYPE:
      processMediaRule(
        rule as CSSMediaRule,
        rules,
        warnings,
        assetRefs,
        breakpoints,
        mediaTolerance,
        selectorToLastIndex,
        seenClassSelectors,
        warnedMediaConditions,
      )
      return

    default:
      // Dropped at-rules: @keyframes, @font-face, @import, @supports, @page,
      // @namespace, @layer, @container, and anything else.
      //
      // NOTE: @import rules are silently ignored by CSSStyleSheet.replaceSync()
      // in most environments (cssRules will be empty for them), so this branch
      // handles the uncommon case where the engine does surface them.
      warnings.push({
        kind: 'dropped-at-rule',
        message: `${atRuleName(rule.type)} rule is not supported by the import engine`,
        source: truncate(rule.cssText),
      })
      return
  }
}

// ---------------------------------------------------------------------------
// Base CSSStyleRule processing
// ---------------------------------------------------------------------------

function processBaseStyleRule(
  rule: CSSStyleRule,
  rules: NewStyleRule[],
  warnings: ImportWarning[],
  assetRefs: AssetRef[],
  selectorToLastIndex: Map<string, number>,
  seenClassSelectors: Set<string>,
): void {
  const selector = rule.selectorText.trim()
  const classified = classifySelector(selector)
  const decls = parseDeclarations(rule.style, selector, warnings)

  if (classified.kind === 'class') {
    if (seenClassSelectors.has(selector)) {
      // Duplicate class: later-in-source wins. Update existing rule's styles.
      warnings.push({
        kind: 'duplicate-class',
        message: `Class "${classified.name}" (${selector}) appears more than once; later declaration wins`,
        selector,
      })
      const existingIdx = selectorToLastIndex.get(selector)!
      // Overwrite base styles with the new declarations (last-write-wins)
      Object.assign(rules[existingIdx].styles, decls)
      // Collect any new asset refs from the updated declarations
      collectAssetRefsFromDecls(decls, existingIdx, undefined, assetRefs)
      return
    }
    seenClassSelectors.add(selector)
  }

  const idx = rules.length
  rules.push({
    name: classified.name,
    kind: classified.kind,
    selector,
    order: idx,
    styles: decls,
    breakpointStyles: {},
  })
  selectorToLastIndex.set(selector, idx)
  collectAssetRefsFromDecls(decls, idx, undefined, assetRefs)
}

// ---------------------------------------------------------------------------
// @media rule processing
// ---------------------------------------------------------------------------

function processMediaRule(
  mediaRule: CSSMediaRule,
  rules: NewStyleRule[],
  warnings: ImportWarning[],
  assetRefs: AssetRef[],
  breakpoints: BreakpointHint[],
  mediaTolerance: number,
  selectorToLastIndex: Map<string, number>,
  seenClassSelectors: Set<string>,
  warnedMediaConditions: Set<string>,
): void {
  // conditionText is on CSSConditionRule (parent of CSSMediaRule) per CSSOM spec.
  // Fallback to mediaText for environments that don't expose conditionText.
  const conditionText =
    (mediaRule as CSSMediaRule & { conditionText?: string }).conditionText
    ?? mediaRule.media.mediaText

  const matched = matchBreakpoint(conditionText, breakpoints, mediaTolerance)

  if (matched !== null) {
    // Matched breakpoint: fold inner rules into breakpointStyles[matched.id]
    processMediaRuleInner(
      mediaRule,
      rules,
      warnings,
      assetRefs,
      selectorToLastIndex,
      seenClassSelectors,
      matched.id,
      /* unfold */ false,
    )
  } else {
    // Unmatched @media: fold inner declarations into base styles
    // (base-takes-precedence: only add properties NOT already in base styles).
    // Emit at most one warning per unique condition text — real-world CSS
    // (e.g. Tailwind v4) may repeat the same @media condition many times,
    // once per selector, producing a warning flood.
    if (!warnedMediaConditions.has(conditionText)) {
      warnedMediaConditions.add(conditionText)
      const matchedAgainst =
        breakpoints.length > 0
          ? ` (checked against ${breakpoints.map((b) => `${b.id}=${b.width}px`).join(', ')})`
          : ''
      warnings.push({
        kind: 'unmatched-media-query',
        message: `@media ${conditionText} could not be matched to any defined breakpoint${matchedAgainst}; inner declarations folded into base styles`,
        source: truncate(mediaRule.cssText),
      })
    }
    processMediaRuleInner(
      mediaRule,
      rules,
      warnings,
      assetRefs,
      selectorToLastIndex,
      seenClassSelectors,
      null,
      /* unfold */ true,
    )
  }
}

/**
 * Process the inner CSSStyleRules of a @media block.
 *
 * @param breakpointId - The matched breakpoint's id, or `null` when folding.
 * @param unfold       - When true, fold declarations into base styles
 *                       (base-takes-precedence merge). When false, write to
 *                       `breakpointStyles[breakpointId]`.
 */
function processMediaRuleInner(
  mediaRule: CSSMediaRule,
  rules: NewStyleRule[],
  warnings: ImportWarning[],
  assetRefs: AssetRef[],
  selectorToLastIndex: Map<string, number>,
  seenClassSelectors: Set<string>,
  breakpointId: string | null,
  unfold: boolean,
): void {
  for (let i = 0; i < mediaRule.cssRules.length; i++) {
    const inner = mediaRule.cssRules[i]
    // Only process style rules inside @media (skip nested @-rules)
    if (inner.type !== STYLE_RULE_TYPE) continue

    const innerStyle = inner as CSSStyleRule
    const selector = innerStyle.selectorText.trim()
    const decls = parseDeclarations(innerStyle.style, selector, warnings)

    // Find or create the rule for this selector
    let idx: number
    if (selectorToLastIndex.has(selector)) {
      idx = selectorToLastIndex.get(selector)!
    } else {
      // No base rule exists — create one with empty base styles
      const classified = classifySelector(selector)
      idx = rules.length
      rules.push({
        name: classified.name,
        kind: classified.kind,
        selector,
        order: idx,
        styles: {},
        breakpointStyles: {},
      })
      selectorToLastIndex.set(selector, idx)
      if (classified.kind === 'class') seenClassSelectors.add(selector)
    }

    if (unfold) {
      // Unmatched @media: fold into base styles, base-takes-precedence.
      // Only add declarations for properties not already set in base styles.
      const baseStyles = rules[idx].styles as Record<string, unknown>
      for (const [k, v] of Object.entries(decls)) {
        if (!(k in baseStyles)) {
          baseStyles[k] = v
        }
      }
      collectAssetRefsFromDecls(decls, idx, undefined, assetRefs)
    } else {
      // Matched @media: merge into breakpointStyles[breakpointId]
      const bpId = breakpointId as string
      const existing = (rules[idx].breakpointStyles[bpId] ?? {}) as Record<string, unknown>
      rules[idx].breakpointStyles[bpId] = { ...existing, ...decls }
      collectAssetRefsFromDecls(decls, idx, bpId, assetRefs)
    }
  }
}
