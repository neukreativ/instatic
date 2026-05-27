/**
 * POST /admin/api/ai/chat/:scope
 *
 * Opens an NDJSON stream against a chat. Body:
 *   {
 *     conversationId: string,
 *     prompt:         string,
 *     snapshot?:      unknown   // scope-specific per-request context
 *   }
 *
 * The conversation row already carries `(credentialId, modelId)` from when
 * it was created. The handler:
 *   1. Verifies `ai.use` + ownership of the conversation.
 *   2. Loads + decrypts the credential (rejects if rotated).
 *   3. Resolves the driver for the credential's provider.
 *   4. Builds an `AiStreamRequest` (system prompt + tools + history).
 *   5. Persists the user message, then runs `runChat({ ... })`.
 *   6. Streams NDJSON events back as the driver produces them.
 */

import { Type, safeParseValue, formatValueErrors } from '@core/utils/typeboxHelpers'
import { jsonResponse } from '../../http'
import { isStateChangingMethod, originAllowed } from '../../auth/security'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import {
  appendMessage,
  listMessagesForConversation,
  readConversationForUser,
} from '../conversations/store'
import {
  readCredentialForUser,
  resolveCredentialForDriver,
  touchCredentialLastUsed,
} from '../credentials/store'
import { resolveDriver } from '../drivers'
import { selectToolsForScope } from '../tools'
import {
  buildSiteSystemPrompt,
  type SiteSnapshot,
} from '../tools/site'
import {
  __setActiveToolSnapshot,
  __clearActiveToolSnapshot,
} from '../drivers/anthropic'
import {
  __setActiveOpenAiToolSnapshot,
  __clearActiveOpenAiToolSnapshot,
} from '../drivers/openai'
import {
  createBridge,
  createConversationsPersister,
  encodeStreamEvent,
  runChat,
} from '../runtime'
import type {
  AiContentBlock,
  AiMessage,
  AiStreamEvent,
  ToolScope,
} from '../runtime/types'
import type { AiStreamRequest } from '../drivers/types'
import type { MessageRecord } from '../conversations/types'

const ChatRequestBodySchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  // snapshot stays loose here — scope-specific shape; tools cast it inside
  // their handlers. The handler narrows below based on the conversation's
  // scope before passing to the system-prompt builder.
  snapshot: Type.Optional(Type.Unknown()),
})

const VALID_SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']

/**
 * Match `/admin/api/ai/chat/:scope`. Returns `null` if path doesn't match.
 */
export function tryHandleAiChat(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (!pathname.startsWith('/admin/api/ai/chat/')) return null
  const scope = pathname.slice('/admin/api/ai/chat/'.length)
  if (!VALID_SCOPES.includes(scope as ToolScope)) return null
  return handleAiChat(req, db, scope as ToolScope)
}

async function handleAiChat(
  req: Request,
  db: DbClient,
  scope: ToolScope,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  if (isStateChangingMethod(req.method) && !originAllowed(req)) {
    return jsonResponse({ error: 'Forbidden: invalid origin' }, { status: 403 })
  }

  const userOrResponse = await requireCapability(req, db, 'ai.use')
  if (userOrResponse instanceof Response) return userOrResponse
  const user = userOrResponse

  let rawBody: unknown
  try {
    rawBody = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = safeParseValue(ChatRequestBodySchema, rawBody)
  if (!parsed.ok) {
    return jsonResponse(
      { error: `Invalid request body: ${formatValueErrors(ChatRequestBodySchema, rawBody)}` },
      { status: 400 },
    )
  }
  const { conversationId, prompt, snapshot } = parsed.value as {
    conversationId: string
    prompt: string
    snapshot?: unknown
  }

  const conversation = await readConversationForUser(db, user.id, conversationId)
  if (!conversation) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 })
  }
  if (conversation.scope !== scope) {
    return jsonResponse(
      { error: `Conversation scope is "${conversation.scope}", not "${scope}".` },
      { status: 400 },
    )
  }
  if (!conversation.credentialId) {
    return jsonResponse(
      { error: 'Conversation has no credential set. Open AI settings to configure a provider.' },
      { status: 400 },
    )
  }

  const credential = await readCredentialForUser(db, user.id, conversation.credentialId)
  if (!credential) {
    return jsonResponse(
      { error: 'Credential not found or no longer accessible.' },
      { status: 404 },
    )
  }
  let resolvedCredential
  try {
    resolvedCredential = await resolveCredentialForDriver(credential)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credential resolution failed.'
    return jsonResponse({ error: message }, { status: 409 })
  }

  const driver = resolveDriver(credential.providerId)
  const tools = selectToolsForScope(scope)

  // Append the user's message BEFORE streaming so it's persisted even if
  // the stream aborts mid-response.
  await appendMessage(db, conversation.id, {
    role: 'user',
    content: [{ kind: 'text', text: prompt }],
  })

  const existingMessages = await listMessagesForConversation(db, conversation.id)
  const messages = buildMessageHistory(existingMessages)

  const systemPrompt = buildSystemPromptForScope(scope, snapshot)

  // Snapshot binding for server-resolved tools. Both Anthropic and OpenAI
  // drivers consult the same per-process binding via their respective
  // __setActiveToolSnapshot helpers. See the comment in
  // server/ai/drivers/anthropic.ts on the per-process binding caveat
  // (AsyncLocalStorage replacement is a Phase 3 follow-up).
  if (scope === 'site' && snapshot !== undefined) {
    __setActiveToolSnapshot(snapshot)
    __setActiveOpenAiToolSnapshot(snapshot)
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false
      let destroyBridge: (() => void) | null = null

      const closeStream = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch { /* already closed */ }
      }
      const emit = (event: AiStreamEvent): void => {
        if (streamClosed) return
        try {
          controller.enqueue(encodeStreamEvent(event))
        } catch {
          streamClosed = true
        }
      }

      try {
        const { bridgeId, bridge, destroy } = createBridge(emit)
        destroyBridge = destroy
        emit({ type: 'bridgeReady', bridgeId })

        const request: AiStreamRequest = {
          systemPrompt,
          messages,
          tools,
          modelId: conversation.modelId,
          credentials: resolvedCredential,
          signal: req.signal,
          bridge,
        }

        const persister = createConversationsPersister(db, conversation.id)
        await runChat({ driver, request, persister, emit })

        // Best-effort: record that this credential was used.
        await touchCredentialLastUsed(db, credential.id).catch(() => { /* noop */ })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error'
        console.error('[ai/chat] stream failed:', detail)
        emit({ type: 'error', message: 'AI chat failed. Please try again.' })
      } finally {
        if (destroyBridge) destroyBridge()
        if (scope === 'site' && snapshot !== undefined) {
          __clearActiveToolSnapshot()
          __clearActiveOpenAiToolSnapshot()
        }
        closeStream()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemPromptForScope(
  scope: ToolScope,
  snapshot: unknown,
): string[] {
  if (scope === 'site') {
    // Snapshot type validation lives at the boundary that produced it
    // (the editor's renderEvidence + Phase 3 will add schema validation).
    return buildSiteSystemPrompt((snapshot ?? emptySiteSnapshot()) as SiteSnapshot)
  }
  // Other scopes don't have system prompts yet (Phase 4+). The driver
  // gets a minimal prompt so the conversation isn't completely contextless.
  return [
    `You are an AI assistant embedded in the "${scope}" workspace of a CMS. ` +
    `No scope-specific tools are wired up yet — respond conversationally only.`,
  ]
}

function emptySiteSnapshot(): SiteSnapshot {
  return {
    pageId: '',
    pageTitle: 'Untitled',
    rootNodeId: '',
    pages: [],
    activeBreakpointId: '',
    breakpoints: [],
    nodes: [],
    availableModules: [],
    selectedNodeId: null,
    classes: [],
  }
}

/**
 * Reconstruct AiMessage history from the persisted MessageRecord rows.
 * Strips the assistant's leading toolCall blocks (they're driver state,
 * not visible history) — keeps text + tool_result-shaped tool messages.
 */
function buildMessageHistory(records: MessageRecord[]): AiMessage[] {
  const out: AiMessage[] = []
  for (const rec of records) {
    if (rec.role === 'user') {
      out.push({ role: 'user', content: rec.content as AiContentBlock[] })
    } else if (rec.role === 'assistant') {
      out.push({ role: 'assistant', content: rec.content as AiContentBlock[] })
    } else if (rec.role === 'tool' && rec.toolCallId) {
      const textBlock = rec.content.find((b) => b.kind === 'text')
      const text = textBlock?.kind === 'text' ? textBlock.text : ''
      out.push({
        role: 'tool',
        toolCallId: rec.toolCallId,
        output: { ok: text === '', data: undefined, error: text || undefined },
      })
    }
  }
  return out
}
