/**
 * Canonical HTML-escape, URL-validation, and CSS-sanitisation utilities.
 *
 * This is the single source of truth for all escaping/sanitisation in the
 * publisher pipeline. Both the publisher (render.ts), base modules
 * (modules/base/utils/escape.ts), and editor components
 * (ClassStyleInjector.tsx) import from here — no duplicate implementations.
 *
 * Constraint #211 contract:
 *   - escapeHtml() is called by the publisher via escapeProps() BEFORE render().
 *   - Module render() functions receive pre-escaped string props and MUST NOT
 *     call escapeHtml() on those props again (that causes double-escaping: CWE-116).
 *   - URL props (href/src/etc.) are an exception: the publisher validates safety via
 *     isSafeUrl() but does NOT HTML-escape them. Module render() functions must
 *     call safeUrl() on URL props (validation + HTML-escape in one step).
 *   - Values a module constructs INTERNALLY (not from props) may still call escapeHtml().
 *
 * Constraint #228 contract:
 *   - sanitiseCssValue() is the canonical CSS value sanitiser. Both ClassStyleInjector
 *     (editor live preview) and buildStyle() (module CSS) must use this function — no
 *     per-file reimplementations (same pattern that fixed CWE-116 for HTML escaping).
 */

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}

/**
 * HTML-escape the 5 characters that are dangerous in HTML text / attribute contexts.
 * Accepts `unknown` — non-strings are stringified first (graceful handling of
 * number props passed as unknown in typed module render signatures).
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Return true if a URL is safe to use in href/src/action attributes.
 * Blocks javascript:, vbscript:, and data: URL schemes.
 *
 * Normalisation: strips \t, \n, \r before scheme detection — the WHATWG URL parser
 * removes these characters too, so `java\tscript:` would be treated as `javascript:`
 * by browsers (CWE-79 bypass). We must mirror that normalisation.
 *
 * data: URIs are blocked because:
 * - `data:text/html,...` in href opens a new browsing context with arbitrary HTML/JS,
 *   bypassing the published page's CSP (which only governs the current document).
 * - `data:image/svg+xml,...` may embed JavaScript in SVG content.
 * For safe inline images, host apps should use CDN URLs or properly hosted assets.
 */
export function isSafeUrl(url: string): boolean {
  const normalized = url.replace(/[\t\n\r]/g, '').trim().toLowerCase()
  return (
    !normalized.startsWith('javascript:') &&
    !normalized.startsWith('vbscript:') &&
    !normalized.startsWith('data:')
  )
}

/**
 * Validate a URL and HTML-escape it for safe use in an HTML attribute.
 *
 * - Unsafe URLs (javascript:/vbscript:) are replaced with '#'.
 * - Safe URLs are HTML-escaped (e.g. `&` in query strings → `&amp;`).
 *
 * Accepts `unknown` for convenience in module render() signatures.
 * Use this for ALL URL props in module render() functions.
 */
export function safeUrl(value: unknown): string {
  const str = String(value ?? '')
  if (!isSafeUrl(str)) return '#'
  return escapeHtml(str)
}

// ---------------------------------------------------------------------------
// CSS value sanitisation
// ---------------------------------------------------------------------------

// The canonical `sanitiseCssValue` now lives in the dependency-free
// `@core/css-sanitize` leaf so the framework engine can share it without a
// framework→publisher cycle. Re-exported here so publisher-side consumers
// (classCss, base modules, editor canvas) keep importing it from
// `@core/publisher` unchanged. See `@core/css-sanitize` for the full doc.
export { sanitiseCssValue } from '@core/css-sanitize'
