/**
 * htmlPagePlan — turn a single HTML file into a PagePlan.
 *
 * Steps:
 *   1. Parse the full HTML with DOMParser (browser/happy-dom) to extract
 *      `<title>` text and `<link rel="stylesheet">` hrefs from `<head>`.
 *      In environments without DOMParser, falls back to a minimal regex
 *      scanner so the module stays headless.
 *   2. Resolve each stylesheet href relative to the HTML file's path, then
 *      look it up in the FileMap.  Missing hrefs → `missing-stylesheet` warning.
 *   3. Derive title (prefer `<title>` tag; fall back to prettified filename).
 *   4. Derive URL-safe slug from the filename.
 *   5. Call `importHtml(source)` to produce the body node fragment.
 */

import { importHtml } from '@core/htmlImport'
import type { ImportFragment } from '@core/htmlImport'
import type { FileMap, ImportWarning, PagePlan } from './types'

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

export interface HtmlPagePlanResult {
  pagePlan: PagePlan
  warnings: ImportWarning[]
}

/**
 * Build a PagePlan for one HTML file.
 *
 * @param htmlPath   — FileMap key of the HTML file (e.g. `"pages/about.html"`).
 * @param htmlSource — Raw HTML string (decoded from FileMap bytes).
 * @param fileMap    — The full FileMap, used to resolve stylesheet hrefs.
 */
export function makeHtmlPagePlan(
  htmlPath: string,
  htmlSource: string,
  fileMap: FileMap,
): HtmlPagePlanResult {
  const warnings: ImportWarning[] = []

  // --- Step 1: extract <title> and stylesheet links ---
  const { title: extractedTitle, linkHrefs } = extractHeadMeta(htmlSource)

  // --- Step 2: resolve stylesheet hrefs to FileMap keys ---
  const linkedCssPaths: string[] = []
  for (const href of linkHrefs) {
    const resolved = resolveHref(href, htmlPath)
    if (resolved && fileMap.files[resolved]) {
      linkedCssPaths.push(resolved)
    } else if (resolved) {
      warnings.push({
        kind: 'missing-stylesheet',
        message: `Stylesheet "${href}" linked by "${htmlPath}" was not found in the import`,
        source: htmlPath,
        path: href,
      })
    }
    // href that couldn't be resolved (external, absolute, etc.) is silently ignored
  }

  // --- Step 3: derive title ---
  const title = extractedTitle && extractedTitle.length > 0
    ? extractedTitle
    : prettifyTitle(htmlPath)

  // --- Step 4: derive slug ---
  const slug = deriveSlug(htmlPath)

  // --- Step 5: parse body nodes ---
  const { nodes, rootIds } = importHtml(htmlSource)
  const nodeFragment: ImportFragment = { nodes, rootIds }

  const pagePlan: PagePlan = {
    source: htmlPath,
    title,
    slug,
    linkedCssPaths,
    nodeFragment,
  }

  return { pagePlan, warnings }
}

// ---------------------------------------------------------------------------
// Head metadata extraction
// ---------------------------------------------------------------------------

interface HeadMeta {
  title: string | null
  linkHrefs: string[]
}

/**
 * Extract `<title>` text and `<link rel="stylesheet">` hrefs from HTML.
 *
 * Uses DOMParser when available (browser + happy-dom test environment).
 * Falls back to regex for server-side or other environments without a DOM.
 */
function extractHeadMeta(htmlSource: string): HeadMeta {
  // Try DOMParser (browser, happy-dom)
  if (typeof DOMParser !== 'undefined') {
    return extractHeadMetaFromDom(htmlSource)
  }
  // Fallback: lightweight regex extraction
  return extractHeadMetaFromRegex(htmlSource)
}

function extractHeadMetaFromDom(htmlSource: string): HeadMeta {
  try {
    const doc = new DOMParser().parseFromString(htmlSource, 'text/html')
    const titleEl = doc.querySelector('title')
    const title = titleEl?.textContent?.trim() ?? null

    const linkHrefs: string[] = []
    const links = doc.querySelectorAll('link[rel="stylesheet"]')
    for (const link of Array.from(links)) {
      const href = link.getAttribute('href')
      if (href && href.trim().length > 0) linkHrefs.push(href.trim())
    }

    return { title, linkHrefs }
  } catch {
    // DOM parse failed — fall through to regex
    return extractHeadMetaFromRegex(htmlSource)
  }
}

/** Minimal regex fallback for environments without DOMParser. */
function extractHeadMetaFromRegex(htmlSource: string): HeadMeta {
  // Extract <title>
  const titleMatch = htmlSource.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null

  // Extract <link rel="stylesheet" href="...">
  // Handles both attr orders and single/double quotes
  const linkHrefs: string[] = []
  const linkRe = /<link\s[^>]*>/gi
  let linkMatch: RegExpExecArray | null
  while ((linkMatch = linkRe.exec(htmlSource)) !== null) {
    const tag = linkMatch[0]
    const hasStylesheet = /rel=["']stylesheet["']/i.test(tag)
    if (hasStylesheet) {
      const hrefMatch = tag.match(/href=["']([^"']+)["']/i)
      if (hrefMatch) linkHrefs.push(hrefMatch[1].trim())
    }
  }

  return { title, linkHrefs }
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a stylesheet href relative to the HTML file's path in the FileMap.
 *
 * Returns a normalized FileMap key, or null when the href is external,
 * a fragment, a data URL, or cannot be resolved to a safe relative path.
 */
export function resolveHref(href: string, htmlFilePath: string): string | null {
  // Skip external, protocol-relative, data, fragment, mailto, tel
  if (/^https?:\/\/|^\/\/|^data:|^mailto:|^tel:|^#/.test(href)) return null

  const normalized = href.startsWith('/')
    ? href.slice(1) // root-relative: strip leading /
    : joinPaths(dirname(htmlFilePath), href)

  // Must not escape to a parent-of-root path
  if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) return null

  return normalized
}

/** Return the directory part of a path (everything before the last `/`). */
function dirname(filePath: string): string {
  const slash = filePath.lastIndexOf('/')
  return slash >= 0 ? filePath.slice(0, slash) : ''
}

/**
 * Join a base directory path with a relative path, resolving `.` and `..`.
 * Returns a normalized relative path with no leading `./`.
 */
function joinPaths(dir: string, relative: string): string {
  const base = dir ? dir.split('/') : []
  const parts = [...base, ...relative.split('/')]
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.' || part === '') continue
    if (part === '..') {
      if (resolved.length > 0) resolved.pop()
      // Ignore `..` that would escape to a parent of root
    } else {
      resolved.push(part)
    }
  }

  return resolved.join('/')
}

// ---------------------------------------------------------------------------
// Slug and title derivation
// ---------------------------------------------------------------------------

/**
 * Derive a URL-safe slug from an HTML file path.
 *
 * Rules:
 *   - Take the filename without extension.
 *   - Lowercase.
 *   - Replace any run of non-`[a-z0-9]` characters with a single `-`.
 *   - Strip leading and trailing `-`.
 *   - If the result is empty, fall back to `'page'`.
 */
export function deriveSlug(htmlPath: string): string {
  const basename = htmlPath.split('/').pop() ?? htmlPath
  const name = basename.replace(/\.[^.]+$/, '') // strip extension
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'page'
}

/**
 * Prettify a filename into a display title.
 *
 * E.g. `"pages/hero-lab.html"` → `"Hero Lab"`,
 *      `"about_us.html"` → `"About Us"`.
 */
export function prettifyTitle(htmlPath: string): string {
  const basename = htmlPath.split('/').pop() ?? htmlPath
  const name = basename.replace(/\.[^.]+$/, '')
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || 'Untitled'
}
