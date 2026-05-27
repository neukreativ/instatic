/**
 * Credentials handler — GET/POST/PUT/DELETE /admin/api/ai/credentials[/:id]
 *                  + POST /admin/api/ai/credentials/:id/test
 *
 * Every response is the wire-safe `CredentialView` projection. Plaintext +
 * ciphertext + iv NEVER cross the HTTP boundary — gated by
 * `ai-credentials-never-leak.test.ts`.
 */

import { Type, safeParseValue, formatValueErrors, type Static } from '@core/utils/typeboxHelpers'
import { jsonResponse } from '../../http'
import { isStateChangingMethod, originAllowed } from '../../auth/security'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import {
  CredentialError,
  createCredentialForUser,
  deleteCredentialForUser,
  listCredentialsForUser,
  readCredentialForUser,
  resolveCredentialForDriver,
  toCredentialView,
  updateCredentialForUser,
} from '../credentials/store'
import { resolveDriver } from '../drivers'

const ProviderId = Type.Union([
  Type.Literal('anthropic'),
  Type.Literal('openai'),
  Type.Literal('ollama'),
])

const CreateBodySchema = Type.Union([
  Type.Object({
    providerId: ProviderId,
    authMode: Type.Literal('apiKey'),
    displayLabel: Type.String({ minLength: 1 }),
    apiKey: Type.String({ minLength: 1 }),
  }),
  Type.Object({
    providerId: ProviderId,
    authMode: Type.Literal('baseUrl'),
    displayLabel: Type.String({ minLength: 1 }),
    baseUrl: Type.String({ minLength: 1 }),
    apiKey: Type.Optional(Type.String()),
  }),
])

const UpdateBodySchema = Type.Object({
  displayLabel: Type.Optional(Type.String({ minLength: 1 })),
  apiKey: Type.Optional(Type.String()),
  baseUrl: Type.Optional(Type.String()),
})

// ---------------------------------------------------------------------------
// Router entry
// ---------------------------------------------------------------------------

export function tryHandleAiCredentials(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (pathname === '/admin/api/ai/credentials') {
    return dispatchCollection(req, db)
  }
  const idMatch = pathname.match(/^\/admin\/api\/ai\/credentials\/([^/]+)$/)
  if (idMatch) {
    return dispatchItem(req, db, idMatch[1]!)
  }
  const testMatch = pathname.match(/^\/admin\/api\/ai\/credentials\/([^/]+)\/test$/)
  if (testMatch) {
    return dispatchTest(req, db, testMatch[1]!)
  }
  return null
}

// ---------------------------------------------------------------------------
// Collection: GET (list) + POST (create)
// ---------------------------------------------------------------------------

async function dispatchCollection(req: Request, db: DbClient): Promise<Response> {
  if (req.method === 'GET') return handleList(req, db)
  if (req.method === 'POST') return handleCreate(req, db)
  return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
}

async function handleList(req: Request, db: DbClient): Promise<Response> {
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse
  const records = await listCredentialsForUser(db, userOrResponse.id)
  const views = await Promise.all(records.map(toCredentialView))
  return jsonResponse({ credentials: views })
}

async function handleCreate(req: Request, db: DbClient): Promise<Response> {
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = safeParseValue(CreateBodySchema, rawBody)
  if (!parsed.ok) {
    return jsonResponse(
      { error: `Invalid request body: ${formatValueErrors(CreateBodySchema, rawBody)}` },
      { status: 400 },
    )
  }
  try {
    const record = await createCredentialForUser(
      db,
      userOrResponse.id,
      parsed.value as Static<typeof CreateBodySchema>,
    )
    return jsonResponse({ credential: await toCredentialView(record) }, { status: 201 })
  } catch (err) {
    if (err instanceof CredentialError) {
      return jsonResponse({ error: err.message }, { status: err.status })
    }
    console.error('[ai/credentials] create failed:', err)
    return jsonResponse({ error: 'Failed to create credential.' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Item: PUT (update) + DELETE
// ---------------------------------------------------------------------------

async function dispatchItem(req: Request, db: DbClient, id: string): Promise<Response> {
  if (req.method === 'PUT') return handleUpdate(req, db, id)
  if (req.method === 'DELETE') return handleDelete(req, db, id)
  return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
}

async function handleUpdate(req: Request, db: DbClient, id: string): Promise<Response> {
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse

  let rawBody: unknown
  try { rawBody = await req.json() } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = safeParseValue(UpdateBodySchema, rawBody)
  if (!parsed.ok) {
    return jsonResponse(
      { error: `Invalid request body: ${formatValueErrors(UpdateBodySchema, rawBody)}` },
      { status: 400 },
    )
  }
  try {
    const record = await updateCredentialForUser(
      db,
      userOrResponse.id,
      id,
      parsed.value as Static<typeof UpdateBodySchema>,
    )
    if (!record) return jsonResponse({ error: 'Credential not found' }, { status: 404 })
    return jsonResponse({ credential: await toCredentialView(record) })
  } catch (err) {
    if (err instanceof CredentialError) {
      return jsonResponse({ error: err.message }, { status: err.status })
    }
    console.error('[ai/credentials] update failed:', err)
    return jsonResponse({ error: 'Failed to update credential.' }, { status: 500 })
  }
}

async function handleDelete(req: Request, db: DbClient, id: string): Promise<Response> {
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse

  try {
    const deleted = await deleteCredentialForUser(db, userOrResponse.id, id)
    if (!deleted) return jsonResponse({ error: 'Credential not found' }, { status: 404 })
    return jsonResponse({ ok: true })
  } catch (err) {
    if (err instanceof CredentialError) {
      return jsonResponse({ error: err.message }, { status: err.status })
    }
    console.error('[ai/credentials] delete failed:', err)
    return jsonResponse({ error: 'Failed to delete credential.' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Test: POST /admin/api/ai/credentials/:id/test
// ---------------------------------------------------------------------------

async function dispatchTest(req: Request, db: DbClient, id: string): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.providers.manage')
  if (userOrResponse instanceof Response) return userOrResponse

  const record = await readCredentialForUser(db, userOrResponse.id, id)
  if (!record) return jsonResponse({ error: 'Credential not found' }, { status: 404 })

  try {
    const resolved = await resolveCredentialForDriver(record)
    const driver = resolveDriver(record.providerId)
    const models = await driver.listModels(resolved)
    return jsonResponse({ ok: true, modelCount: models.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Test failed.'
    return jsonResponse({ ok: false, error: message }, { status: 200 })
  }
}
