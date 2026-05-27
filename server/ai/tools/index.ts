/**
 * Tool registry root — selects the right toolset for a chat scope.
 *
 * Currently only the `site` scope has tools registered. Phase 4 will add
 * `content` + `data`; Phase 5 will add `plugin`.
 *
 * Adding a new scope:
 *   1. Create `server/ai/tools/<scope>/` with its tool files + index.ts.
 *   2. Import its barrel here.
 *   3. Add a switch arm in `selectToolsForScope`.
 *   4. The `ai-tools-typebox-only.test.ts` gate ensures every file under
 *      `server/ai/tools/**` uses TypeBox (not Zod) — covered automatically.
 */

import type { AiTool, ToolScope } from './types'
import { siteTools } from './site'

/**
 * Returns the tools available for one chat scope. The runtime hands this
 * array to the driver verbatim; drivers translate each `AiTool.inputSchema`
 * (TypeBox) into their SDK's native tool format.
 */
export function selectToolsForScope(scope: ToolScope): AiTool[] {
  switch (scope) {
    case 'site':
      return siteTools
    case 'content':
      // Phase 4
      return []
    case 'data':
      // Phase 4
      return []
    case 'plugin':
      // Phase 5
      return []
  }
}

/**
 * Look up a single tool by name within a scope. Returns undefined when no
 * matching tool is registered — handlers use this to route inbound
 * tool-result POSTs.
 */
export function getToolByName(scope: ToolScope, toolName: string): AiTool | undefined {
  return selectToolsForScope(scope).find((t) => t.name === toolName)
}

export type { AiTool, ToolScope } from './types'
