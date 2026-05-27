/**
 * POST /admin/api/ai/tool-result
 *
 * Browser-side bridge POST. After applying a write tool against the
 * editor store, the browser sends `{ bridgeId, requestId, result }`. The
 * server matches the bridgeId+requestId to a pending driver waiter via
 * `resolveBridgeToolResult` and resolves it so the driver loop continues.
 */

import { Type, safeParseValue, formatValueErrors } from '@core/utils/typeboxHelpers'
import { jsonResponse } from '../../http'
import { isStateChangingMethod, originAllowed } from '../../auth/security'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import { resolveBridgeToolResult } from '../runtime'

const ToolResultBodySchema = Type.Object({
  bridgeId: Type.String({ minLength: 1 }),
  requestId: Type.String({ minLength: 1 }),
  result: Type.Object({
    ok: Type.Boolean(),
    data: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.String()),
  }),
})

export function tryHandleAiToolResult(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (pathname !== '/admin/api/ai/tool-result') return null
  return handleAiToolResult(req, db)
}

async function handleAiToolResult(req: Request, db: DbClient): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.use')
  if (userOrResponse instanceof Response) return userOrResponse

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = safeParseValue(ToolResultBodySchema, rawBody)
  if (!parsed.ok) {
    return jsonResponse(
      { error: `Invalid request body: ${formatValueErrors(ToolResultBodySchema, rawBody)}` },
      { status: 400 },
    )
  }
  const { bridgeId, requestId, result } = parsed.value as {
    bridgeId: string
    requestId: string
    result: { ok: boolean; data?: unknown; error?: string }
  }

  const matched = resolveBridgeToolResult(bridgeId, requestId, result)
  if (!matched) {
    // Bridge gone or unknown requestId — likely the stream was aborted
    // before the browser's POST arrived. Not a fatal client error.
    return jsonResponse({ ok: false }, { status: 404 })
  }
  return jsonResponse({ ok: true })
}
