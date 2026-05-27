/**
 * Model picker source — GET /admin/api/ai/providers/:id/models
 *
 * Asks the driver to list models for one provider. The optional
 * `credentialId` query parameter is forwarded to the driver in case the
 * model list depends on the credential (e.g. Ollama's local model set,
 * Anthropic's subscription tier).
 */

import { jsonResponse } from '../../http'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import { resolveDriver } from '../drivers'
import {
  readCredentialForUser,
  resolveCredentialForDriver,
} from '../credentials/store'
import type { AiProviderId } from '../runtime/types'

const VALID_PROVIDERS: AiProviderId[] = ['anthropic', 'openai', 'ollama']

export function tryHandleAiModels(
  req: Request,
  db: DbClient,
  url: URL,
  pathname: string,
): Promise<Response> | null {
  const match = pathname.match(/^\/admin\/api\/ai\/providers\/([^/]+)\/models$/)
  if (!match) return null
  return handleModels(req, db, url, match[1]!)
}

async function handleModels(
  req: Request,
  db: DbClient,
  url: URL,
  providerParam: string,
): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.use')
  if (userOrResponse instanceof Response) return userOrResponse

  if (!VALID_PROVIDERS.includes(providerParam as AiProviderId)) {
    return jsonResponse(
      { error: `Unknown provider "${providerParam}". Must be one of: ${VALID_PROVIDERS.join(', ')}` },
      { status: 400 },
    )
  }
  const providerId = providerParam as AiProviderId
  const driver = resolveDriver(providerId)

  // Optional credential — when the picker has one selected, decrypt it
  // so the driver can hit the real model-list endpoint. Without one, we
  // pass a placeholder credential and the driver returns its static
  // fallback list.
  const credentialId = url.searchParams.get('credentialId')
  let resolved
  if (credentialId) {
    const record = await readCredentialForUser(db, userOrResponse.id, credentialId)
    if (!record) {
      return jsonResponse({ error: 'Credential not found' }, { status: 404 })
    }
    try {
      resolved = await resolveCredentialForDriver(record)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Credential resolution failed.'
      return jsonResponse({ error: message }, { status: 409 })
    }
  } else {
    resolved = {
      id: '',
      providerId,
      authMode: providerId === 'ollama' ? ('baseUrl' as const) : ('apiKey' as const),
      apiKey: null,
      baseUrl: null,
    }
  }

  const models = await driver.listModels(resolved)
  return jsonResponse({ models })
}
