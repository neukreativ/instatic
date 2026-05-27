/**
 * Thin client-side API wrappers for the AI runtime HTTP surface.
 *
 * Every function POSTs/GETs the canonical wire shapes defined in
 * `server/ai/handlers/*` and parses the response with TypeBox. Errors
 * surface as thrown `AiApiError`s with the server's status + message —
 * pages render them via `role="alert"` panels.
 *
 * Constraint #272 — every untyped boundary (HTTP response) is validated
 * against a TypeBox schema before reaching React state.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { parseJsonResponse } from '@core/utils/jsonValidate'

// ---------------------------------------------------------------------------
// Wire schemas — match server projections in:
//   server/ai/credentials/types.ts → CredentialView
//   server/ai/conversations/types.ts → ConversationView
//   server/ai/defaults/store.ts → DefaultRecord
// ---------------------------------------------------------------------------

const ProviderId = Type.Union([
  Type.Literal('anthropic'),
  Type.Literal('openai'),
  Type.Literal('ollama'),
])

const AuthMode = Type.Union([
  Type.Literal('apiKey'),
  Type.Literal('baseUrl'),
])

const ToolScope = Type.Union([
  Type.Literal('site'),
  Type.Literal('content'),
  Type.Literal('data'),
  Type.Literal('plugin'),
])

export const CredentialViewSchema = Type.Object({
  id: Type.String(),
  providerId: ProviderId,
  authMode: AuthMode,
  displayLabel: Type.String(),
  baseUrl: Type.Union([Type.String(), Type.Null()]),
  keyFingerprintCurrent: Type.Boolean(),
  createdAt: Type.String(),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
})

export type CredentialView = Static<typeof CredentialViewSchema>

const CredentialListResponseSchema = Type.Object({
  credentials: Type.Array(CredentialViewSchema),
})

const CredentialItemResponseSchema = Type.Object({
  credential: CredentialViewSchema,
})

const TestResponseSchema = Type.Object({
  ok: Type.Boolean(),
  modelCount: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
})

const ModelSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  capabilities: Type.Object({
    toolCalling: Type.Boolean(),
    visionInput: Type.Boolean(),
    promptCache: Type.Boolean(),
    streaming: Type.Boolean(),
  }),
  tier: Type.Optional(Type.String()),
})
export type AiModel = Static<typeof ModelSchema>

const ModelListResponseSchema = Type.Object({
  models: Type.Array(ModelSchema),
})

const DefaultEntrySchema = Type.Object({
  credentialId: Type.String(),
  modelId: Type.String(),
})
const DefaultsResponseSchema = Type.Object({
  defaults: Type.Record(Type.String(), DefaultEntrySchema),
})
export type AiDefaults = Static<typeof DefaultsResponseSchema>['defaults']

const ConversationViewSchema = Type.Object({
  id: Type.String(),
  scope: ToolScope,
  title: Type.String(),
  credentialId: Type.Union([Type.String(), Type.Null()]),
  modelId: Type.String(),
  promptTokensTotal: Type.Number(),
  completionTokensTotal: Type.Number(),
  costUsdTotal: Type.Number(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})
export type ConversationView = Static<typeof ConversationViewSchema>

const ConversationListResponseSchema = Type.Object({
  conversations: Type.Array(ConversationViewSchema),
})

const ErrorResponseSchema = Type.Object({
  error: Type.String(),
})

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AiApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AiApiError'
    this.status = status
  }
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return
  let message = `Request failed: ${res.status}`
  try {
    const data = await res.json() as { error?: string }
    if (data?.error) message = data.error
  } catch { /* fall through */ }
  throw new AiApiError(message, res.status)
}

// ---------------------------------------------------------------------------
// Endpoints — credentials
// ---------------------------------------------------------------------------

export async function listCredentials(): Promise<CredentialView[]> {
  const res = await fetch('/admin/api/ai/credentials')
  await throwIfNotOk(res)
  const body = await parseJsonResponse(res, CredentialListResponseSchema)
  return body.credentials
}

export type CreateCredentialBody =
  | {
      providerId: 'anthropic' | 'openai' | 'ollama'
      authMode: 'apiKey'
      displayLabel: string
      apiKey: string
    }
  | {
      providerId: 'anthropic' | 'openai' | 'ollama'
      authMode: 'baseUrl'
      displayLabel: string
      baseUrl: string
      apiKey?: string
    }

export async function createCredential(body: CreateCredentialBody): Promise<CredentialView> {
  const res = await fetch('/admin/api/ai/credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await throwIfNotOk(res)
  const parsed = await parseJsonResponse(res, CredentialItemResponseSchema)
  return parsed.credential
}

export interface UpdateCredentialBody {
  displayLabel?: string
  apiKey?: string
  baseUrl?: string
}

export async function updateCredential(id: string, body: UpdateCredentialBody): Promise<CredentialView> {
  const res = await fetch(`/admin/api/ai/credentials/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await throwIfNotOk(res)
  const parsed = await parseJsonResponse(res, CredentialItemResponseSchema)
  return parsed.credential
}

export async function deleteCredential(id: string): Promise<void> {
  const res = await fetch(`/admin/api/ai/credentials/${encodeURIComponent(id)}`, { method: 'DELETE' })
  await throwIfNotOk(res)
}

export interface TestResult {
  ok: boolean
  modelCount?: number
  error?: string
}

export async function testCredential(id: string): Promise<TestResult> {
  const res = await fetch(`/admin/api/ai/credentials/${encodeURIComponent(id)}/test`, { method: 'POST' })
  // The test endpoint returns 200 even on auth failure (the body carries
  // `{ ok: false, error }`) so callers can render the error inline.
  if (res.status !== 200 && res.status !== 404) {
    await throwIfNotOk(res)
  }
  if (res.status === 404) throw new AiApiError('Credential not found.', 404)
  return parseJsonResponse(res, TestResponseSchema)
}

// ---------------------------------------------------------------------------
// Endpoints — models
// ---------------------------------------------------------------------------

export async function listModels(
  providerId: 'anthropic' | 'openai' | 'ollama',
  credentialId?: string,
): Promise<AiModel[]> {
  const q = credentialId ? `?credentialId=${encodeURIComponent(credentialId)}` : ''
  const res = await fetch(`/admin/api/ai/providers/${providerId}/models${q}`)
  await throwIfNotOk(res)
  const body = await parseJsonResponse(res, ModelListResponseSchema)
  return body.models
}

// ---------------------------------------------------------------------------
// Endpoints — defaults
// ---------------------------------------------------------------------------

export async function listDefaults(): Promise<AiDefaults> {
  const res = await fetch('/admin/api/ai/defaults')
  await throwIfNotOk(res)
  const body = await parseJsonResponse(res, DefaultsResponseSchema)
  return body.defaults
}

export async function setDefault(
  scope: 'site' | 'content' | 'data' | 'plugin',
  body: { credentialId: string; modelId: string },
): Promise<void> {
  const res = await fetch(`/admin/api/ai/defaults/${scope}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  await throwIfNotOk(res)
}

// ---------------------------------------------------------------------------
// Endpoints — conversations (Phase 3 uses these; surfaced now for testing)
// ---------------------------------------------------------------------------

export async function listConversations(scope: 'site' | 'content' | 'data' | 'plugin'): Promise<ConversationView[]> {
  const res = await fetch(`/admin/api/ai/conversations?scope=${scope}`)
  await throwIfNotOk(res)
  const body = await parseJsonResponse(res, ConversationListResponseSchema)
  return body.conversations
}

// Re-export the error response schema for callers that want to assert wire
// errors directly (e.g. integration tests).
export { ErrorResponseSchema }
