/**
 * Site-scope tool barrel — exports the toolset and the system prompt builder.
 *
 * The chat handler imports `siteTools` for `scope === 'site'` and
 * `buildSiteSystemPrompt` when assembling the prompt for a site-scope
 * conversation.
 */

import type { AiTool } from '../types'
import { siteReadTools } from './readTools'
import { siteWriteTools } from './writeTools'

export const siteTools: AiTool[] = [
  ...siteReadTools,
  ...siteWriteTools,
]

export { buildSiteSystemPrompt } from './systemPrompt'
export type { SiteSnapshot } from './snapshot'
