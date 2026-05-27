/**
 * Site-wide AI defaults handler.
 *
 *   GET /admin/api/ai/defaults                Returns a record of every scope's
 *                                              default { credentialId, modelId }.
 *   PUT /admin/api/ai/defaults/:scope         Body: { credentialId, modelId }
 */

import { Type, safeParseValue, formatValueErrors } from '@core/utils/typeboxHelpers'
import { jsonResponse } from '../../http'
import { isStateChangingMethod, originAllowed } from '../../auth/security'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import { listDefaults, setDefaultForScope } from '../defaults/store'
import type { ToolScope } from '../runtime/types'

const VALID_SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']

const PutBodySchema = Type.Object({
  credentialId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
})

export function tryHandleAiDefaults(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (pathname === '/admin/api/ai/defaults') {
    return handleList(req, db)
  }
  const match = pathname.match(/^\/admin\/api\/ai\/defaults\/([^/]+)$/)
  if (match) {
    return handleSet(req, db, match[1]!)
  }
  return null
}

async function handleList(req: Request, db: DbClient): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.use')
  if (userOrResponse instanceof Response) return userOrResponse

  const records = await listDefaults(db)
  // Project into a scope-keyed map; UI groups by scope.
  const defaults: Record<string, { credentialId: string; modelId: string }> = {}
  for (const rec of records) {
    defaults[rec.scope] = { credentialId: rec.credentialId, modelId: rec.modelId }
  }
  return jsonResponse({ defaults })
}

async function handleSet(req: Request, db: DbClient, scope: string): Promise<Response> {
  if (req.method !== 'PUT') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  if (!VALID_SCOPES.includes(scope as ToolScope)) {
    return jsonResponse(
      { error: `Unknown scope "${scope}". Must be one of: ${VALID_SCOPES.join(', ')}` },
      { status: 400 },
    )
  }
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = safeParseValue(PutBodySchema, rawBody)
  if (!parsed.ok) {
    return jsonResponse(
      { error: `Invalid request body: ${formatValueErrors(PutBodySchema, rawBody)}` },
      { status: 400 },
    )
  }
  const { credentialId, modelId } = parsed.value as { credentialId: string; modelId: string }

  try {
    const record = await setDefaultForScope(
      db,
      scope as ToolScope,
      credentialId,
      modelId,
      userOrResponse.id,
    )
    return jsonResponse({ default: record })
  } catch (err) {
    // FK violation when credentialId doesn't exist or belongs to a
    // different user; surface as 400.
    const message = err instanceof Error ? err.message : 'Failed to set default.'
    if (message.toLowerCase().includes('foreign key') || message.toLowerCase().includes('23503')) {
      return jsonResponse(
        { error: 'Credential not found. Pick an existing credential.' },
        { status: 400 },
      )
    }
    console.error('[ai/defaults] set failed:', err)
    return jsonResponse({ error: 'Failed to set default.' }, { status: 500 })
  }
}
