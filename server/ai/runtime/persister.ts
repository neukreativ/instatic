/**
 * Persistence sink the runner uses to commit assistant text, tool calls,
 * tool results, and usage totals to the conversation as a chat unfolds.
 *
 * Wraps `server/ai/conversations/store.ts` with the per-conversation
 * context (db client + conversation id) so the runner doesn't need to
 * thread those through every call.
 */

import type { DbClient } from '../../db/client'
import { appendMessage } from '../conversations/store'
import type { AiContentBlock } from './types'

export interface ConversationsPersister {
  appendAssistantText(text: string): Promise<void>
  appendToolCall(args: {
    toolCallId: string
    toolName: string
    input: unknown
  }): Promise<void>
  appendToolResult(args: {
    toolCallId: string
    toolName: string
    ok: boolean
    error?: string
  }): Promise<void>
  recordUsage(usage: {
    promptTokens: number
    completionTokens: number
    costUsd?: number
  }): Promise<void>
}

export function createConversationsPersister(
  db: DbClient,
  conversationId: string,
): ConversationsPersister {
  // Token + cost totals are kept in memory and flushed onto the LAST
  // assistant message we write per turn. Drivers report usage as a
  // single aggregate at the end; we attribute it to the assistant's
  // message row (which always exists by then — either a text reply or
  // the assistant's tool_use block that surfaced via appendToolCall).
  let lastAssistantMessageId: string | null = null

  return {
    async appendAssistantText(text) {
      const blocks: AiContentBlock[] = [{ kind: 'text', text }]
      const row = await appendMessage(db, conversationId, {
        role: 'assistant',
        content: blocks,
      })
      lastAssistantMessageId = row.id
    },

    async appendToolCall({ toolCallId, toolName, input }) {
      const blocks: AiContentBlock[] = [{
        kind: 'toolCall',
        toolCallId,
        toolName,
        input,
      }]
      const row = await appendMessage(db, conversationId, {
        role: 'assistant',
        content: blocks,
        toolCallId,
        toolName,
      })
      lastAssistantMessageId = row.id
    },

    async appendToolResult({ toolCallId, toolName, ok, error }) {
      // role='tool' messages mirror the OpenAI shape; the Anthropic driver
      // translates these to `{ role: 'user', content: [tool_result block] }`
      // when feeding history back to the SDK.
      const blocks: AiContentBlock[] = [{
        kind: 'text',
        text: ok ? '' : (error ?? 'Tool call failed.'),
      }]
      await appendMessage(db, conversationId, {
        role: 'tool',
        content: blocks,
        toolCallId,
        toolName,
      })
    },

    async recordUsage(usage) {
      // Persist usage as a denormalised update on the LAST assistant
      // message so a per-message cost view is possible later. If no
      // assistant message exists yet, the conversation totals will pick
      // up the increment anyway (appendMessage bumps them per row), so we
      // simply skip — the totals are still correct, only the per-message
      // attribution is lost in that edge case.
      if (!lastAssistantMessageId) return
      // Lightweight UPDATE — bypasses the repository because there's no
      // public-facing API for "patch the latest message". Single-table
      // write, no FK touch.
      await updateMessageUsage(
        db,
        lastAssistantMessageId,
        usage.promptTokens,
        usage.completionTokens,
        usage.costUsd ?? 0,
      )
    },
  }
}

async function updateMessageUsage(
  db: DbClient,
  messageId: string,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
): Promise<void> {
  // Move the increment off the message row (which started at zero in
  // appendMessage) AND propagate the delta onto the parent conversation
  // totals so the list view stays consistent.
  await db.transaction(async (tx) => {
    const { rows } = await tx<{ conversation_id: string }>`
      select conversation_id
      from ai_messages
      where id = ${messageId}
      limit 1
    `
    const conversationId = rows[0]?.conversation_id
    if (!conversationId) return

    await tx`
      update ai_messages
      set prompt_tokens = ${promptTokens},
          completion_tokens = ${completionTokens},
          cost_usd = ${costUsd}
      where id = ${messageId}
    `

    await tx`
      update ai_conversations
      set prompt_tokens_total = prompt_tokens_total + ${promptTokens},
          completion_tokens_total = completion_tokens_total + ${completionTokens},
          cost_usd_total = cost_usd_total + ${costUsd},
          updated_at = current_timestamp
      where id = ${conversationId}
    `
  })
}
