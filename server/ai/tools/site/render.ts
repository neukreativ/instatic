/**
 * Server-side render of the agent's posted tree into the HTML read surface.
 *
 * `renderAgentPage` produces exactly the artifacts the token benchmark proved
 * cheaper than the JSON snapshot: the annotated `<body>` (each element tagged
 * `uid="<nodeId>"`) plus the page's `<style>` bundle (framework tokens +
 * utilities + module CSS, class rules with `@media` breakpoint blocks, and
 * page-scoped user stylesheets). Reset CSS is omitted — it is page-independent
 * browser-normalisation boilerplate the agent never reasons about.
 *
 * Same `publishPage` + `buildSiteCssBundle` path that
 * `server/publish/publicRenderer.ts` runs in-process; here we ask for
 * `annotateNodeIds` and slice the body out of the full document.
 */

import { registry } from '@core/module-engine'
import { publishPage } from '@core/publisher'
import type { SiteAgentSnapshot } from '@site/agent/siteAgentSnapshot'
import { buildSiteCssBundle } from '../../../publish/siteCssBundle'

export interface AgentPageRender {
  /** Annotated inner <body> HTML (uid="<nodeId>" on each element). */
  html: string
  /** The page's CSS wrapped in a <style> block; '' when the page has no CSS. */
  css: string
}

/** Extract the inner `<body>` HTML from a full published document. */
function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/)
  return m ? m[1] : html
}

export function renderAgentPage(snap: SiteAgentSnapshot): AgentPageRender {
  const { page, site } = snap
  const { html: fullDocument } = publishPage(page, site, registry, {
    annotateNodeIds: true,
  })
  const html = extractBody(fullDocument)

  const bundle = buildSiteCssBundle(site, registry, page)
  const cssBody = [bundle.framework.content, bundle.style.content, bundle.userStyles.content]
    .filter(Boolean)
    .join('\n\n')
  const css = cssBody ? `<style>\n${cssBody}\n</style>` : ''

  return { html, css }
}
