/**
 * Conversations + messages repository — CRUD over `ai_conversations` and
 * `ai_messages`.
 *
 * Per-user, per-scope. Every query carries `user_id` as a cross-user guard
 * (defence in depth on top of handler-level capability gating).
 *
 * Soft-delete via `deleted_at`; the nightly purge job (`purge.ts`)
 * hard-deletes rows older than 30 days.
 */

import { nanoid } from 'nanoid'
import { Type, safeParseValue } from '@core/utils/typeboxHelpers'
import type { DbClient } from '../../db/client'
import type { AiContentBlock, ToolScope } from '../runtime/types'
import type {
  AppendMessageInput,
  ConversationDetailView,
  ConversationRecord,
  ConversationView,
  CreateConversationInput,
  MessageRecord,
  MessageRole,
  MessageView,
  UpdateConversationInput,
} from './types'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ConversationError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'ConversationError'
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Row shapes ↔ records
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string
  user_id: string
  scope: string
  title: string
  credential_id: string | null
  model_id: string
  session_id: string | null
  context_json: string | null
  prompt_tokens_total: number | string
  completion_tokens_total: number | string
  cost_usd_total: number | string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
}

interface MessageRow {
  id: string
  conversation_id: string
  position: number
  role: string
  // Both dialects auto-hydrate `_json` columns to JS values (SQLite via the
  // adapter's parseJsonColumns; PG via jsonb). The row arrives already-parsed.
  content_json: unknown
  tool_call_id: string | null
  tool_name: string | null
  prompt_tokens: number
  completion_tokens: number
  cost_usd: number | string
  created_at: Date | string
}

function dateString(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return new Date(value).toISOString()
}

function toNumber(value: number | string): number {
  return typeof value === 'number' ? value : Number(value)
}

function conversationRowToRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    scope: row.scope as ToolScope,
    title: row.title,
    credentialId: row.credential_id,
    modelId: row.model_id,
    sessionId: row.session_id,
    contextJson: row.context_json,
    promptTokensTotal: toNumber(row.prompt_tokens_total),
    completionTokensTotal: toNumber(row.completion_tokens_total),
    costUsdTotal: toNumber(row.cost_usd_total),
    createdAt: dateString(row.created_at)!,
    updatedAt: dateString(row.updated_at)!,
    deletedAt: dateString(row.deleted_at),
  }
}

const ContentBlocksSchema = Type.Array(Type.Unknown())

function parseContentBlocks(raw: unknown): AiContentBlock[] {
  // SQLite adapter + PG jsonb both deliver this column pre-parsed.
  // safeParseValue guards against a row that's somehow not an array.
  const parsed = safeParseValue(ContentBlocksSchema, raw)
  if (!parsed.ok) {
    // Defensive: don't crash an entire history fetch over one bad row.
    console.error('[ai/conversations] Malformed content_json row, returning empty blocks.')
    return []
  }
  // Inner block validation lives at the boundary that produced the row
  // (the runner persists known-good AiContentBlocks). Returning the parsed
  // array as-is is consistent with how user_preferences.value_json works.
  return parsed.value as AiContentBlock[]
}

function messageRowToRecord(row: MessageRow): MessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    position: row.position,
    role: row.role as MessageRole,
    content: parseContentBlocks(row.content_json),
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    costUsd: toNumber(row.cost_usd),
    createdAt: dateString(row.created_at)!,
  }
}

// ---------------------------------------------------------------------------
// Wire projections
// ---------------------------------------------------------------------------

export function toConversationView(record: ConversationRecord): ConversationView {
  return {
    id: record.id,
    scope: record.scope,
    title: record.title,
    credentialId: record.credentialId,
    modelId: record.modelId,
    promptTokensTotal: record.promptTokensTotal,
    completionTokensTotal: record.completionTokensTotal,
    costUsdTotal: record.costUsdTotal,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function toMessageView(record: MessageRecord): MessageView {
  return {
    id: record.id,
    position: record.position,
    role: record.role,
    content: record.content,
    toolCallId: record.toolCallId,
    toolName: record.toolName,
    createdAt: record.createdAt,
  }
}

export function toConversationDetailView(
  conversation: ConversationRecord,
  messages: MessageRecord[],
): ConversationDetailView {
  return {
    ...toConversationView(conversation),
    contextJson: conversation.contextJson,
    messages: messages.map(toMessageView),
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * List non-deleted conversations for one user + scope, newest activity
 * first. Served by the `ai_conv_user_scope_idx` partial index.
 */
export async function listConversationsForUserScope(
  db: DbClient,
  userId: string,
  scope: ToolScope,
): Promise<ConversationRecord[]> {
  const { rows } = await db<ConversationRow>`
    select id, user_id, scope, title, credential_id, model_id, session_id,
           context_json, prompt_tokens_total, completion_tokens_total,
           cost_usd_total, created_at, updated_at, deleted_at
    from ai_conversations
    where user_id = ${userId}
      and scope = ${scope}
      and deleted_at is null
    order by updated_at desc
  `
  return rows.map(conversationRowToRecord)
}

/**
 * Read a single conversation with cross-user guard. Returns null for not
 * found / not yours / soft-deleted.
 */
export async function readConversationForUser(
  db: DbClient,
  userId: string,
  conversationId: string,
): Promise<ConversationRecord | null> {
  const { rows } = await db<ConversationRow>`
    select id, user_id, scope, title, credential_id, model_id, session_id,
           context_json, prompt_tokens_total, completion_tokens_total,
           cost_usd_total, created_at, updated_at, deleted_at
    from ai_conversations
    where id = ${conversationId}
      and user_id = ${userId}
      and deleted_at is null
    limit 1
  `
  return rows[0] ? conversationRowToRecord(rows[0]) : null
}

/**
 * Read every message of a conversation in position order. Caller must have
 * already verified ownership via `readConversationForUser`.
 */
export async function listMessagesForConversation(
  db: DbClient,
  conversationId: string,
): Promise<MessageRecord[]> {
  const { rows } = await db<MessageRow>`
    select id, conversation_id, position, role, content_json,
           tool_call_id, tool_name,
           prompt_tokens, completion_tokens, cost_usd, created_at
    from ai_messages
    where conversation_id = ${conversationId}
    order by position asc
  `
  return rows.map(messageRowToRecord)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create a new conversation row. `title` defaults to "New conversation" —
 * the runner can rename it after the first user message lands (or the UI
 * can offer "Rename this chat").
 */
export async function createConversationForUser(
  db: DbClient,
  userId: string,
  input: CreateConversationInput,
): Promise<ConversationRecord> {
  const id = nanoid()
  const title = (input.title ?? '').trim() || 'New conversation'
  const { rows } = await db<ConversationRow>`
    insert into ai_conversations (
      id, user_id, scope, title, credential_id, model_id, context_json
    )
    values (
      ${id}, ${userId}, ${input.scope}, ${title},
      ${input.credentialId}, ${input.modelId}, ${input.contextJson ?? null}
    )
    returning id, user_id, scope, title, credential_id, model_id, session_id,
              context_json, prompt_tokens_total, completion_tokens_total,
              cost_usd_total, created_at, updated_at, deleted_at
  `
  return conversationRowToRecord(rows[0]!)
}

/**
 * Patch a conversation. Pass only fields to update. `sessionId: null`
 * explicitly clears the provider session.
 */
export async function updateConversationForUser(
  db: DbClient,
  userId: string,
  conversationId: string,
  patch: UpdateConversationInput,
): Promise<ConversationRecord | null> {
  const existing = await readConversationForUser(db, userId, conversationId)
  if (!existing) return null

  const nextTitle = patch.title?.trim() || existing.title
  const nextCredentialId =
    patch.credentialId !== undefined ? patch.credentialId : existing.credentialId
  const nextModelId =
    patch.modelId !== undefined ? patch.modelId : existing.modelId
  const nextSessionId =
    patch.sessionId !== undefined ? patch.sessionId : existing.sessionId

  const { rows } = await db<ConversationRow>`
    update ai_conversations
    set title = ${nextTitle},
        credential_id = ${nextCredentialId},
        model_id = ${nextModelId},
        session_id = ${nextSessionId},
        updated_at = current_timestamp
    where id = ${conversationId} and user_id = ${userId}
    returning id, user_id, scope, title, credential_id, model_id, session_id,
              context_json, prompt_tokens_total, completion_tokens_total,
              cost_usd_total, created_at, updated_at, deleted_at
  `
  return rows[0] ? conversationRowToRecord(rows[0]) : null
}

/**
 * Soft-delete by setting `deleted_at`. Idempotent — calling on an
 * already-deleted row sets deleted_at to the current time again.
 * Returns true when a row was matched.
 */
export async function softDeleteConversationForUser(
  db: DbClient,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  const result = await db`
    update ai_conversations
    set deleted_at = current_timestamp,
        updated_at = current_timestamp
    where id = ${conversationId} and user_id = ${userId}
  `
  return result.rowCount > 0
}

/**
 * Append a message to an existing conversation. Computes the next
 * `position` from a SELECT MAX(position) — small race in the (rare) case
 * of two writers, but conversations are single-writer (one stream per
 * conversation at a time, enforced by the handler).
 *
 * Also bumps the parent conversation's `updated_at` + token + cost totals
 * so list queries pick up activity immediately.
 */
export async function appendMessage(
  db: DbClient,
  conversationId: string,
  input: AppendMessageInput,
): Promise<MessageRecord> {
  return db.transaction(async (tx) => {
    const { rows: posRows } = await tx<{ next_pos: number }>`
      select coalesce(max(position), -1) + 1 as next_pos
      from ai_messages
      where conversation_id = ${conversationId}
    `
    const position = posRows[0]?.next_pos ?? 0
    const id = nanoid()
    const promptTokens = input.promptTokens ?? 0
    const completionTokens = input.completionTokens ?? 0
    const costUsd = input.costUsd ?? 0

    // Pass content as a plain array; both dialect adapters handle the JSON
    // encoding (SQLite auto-stringify on bind for objects; PG jsonb native).
    const { rows: msgRows } = await tx<MessageRow>`
      insert into ai_messages (
        id, conversation_id, position, role, content_json,
        tool_call_id, tool_name,
        prompt_tokens, completion_tokens, cost_usd
      )
      values (
        ${id}, ${conversationId}, ${position}, ${input.role}, ${input.content},
        ${input.toolCallId ?? null}, ${input.toolName ?? null},
        ${promptTokens}, ${completionTokens}, ${costUsd}
      )
      returning id, conversation_id, position, role, content_json,
                tool_call_id, tool_name,
                prompt_tokens, completion_tokens, cost_usd, created_at
    `

    // Denormalised totals on the parent — kept in sync per-append so list
    // queries don't need to aggregate.
    await tx`
      update ai_conversations
      set prompt_tokens_total = prompt_tokens_total + ${promptTokens},
          completion_tokens_total = completion_tokens_total + ${completionTokens},
          cost_usd_total = cost_usd_total + ${costUsd},
          updated_at = current_timestamp
      where id = ${conversationId}
    `

    return messageRowToRecord(msgRows[0]!)
  })
}

// ---------------------------------------------------------------------------
// Purge — used by the nightly tick job (purge.ts).
// ---------------------------------------------------------------------------

/**
 * Hard-delete soft-deleted conversations older than `cutoffIsoString`.
 * Cascading FK takes the messages with them.
 *
 * Returns the number of CONVERSATIONS purged (counted before delete) — not
 * the raw `rowCount`, which on SQLite includes cascaded message deletions
 * and would mislead the caller.
 */
export async function purgeSoftDeletedOlderThan(
  db: DbClient,
  cutoffIsoString: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const { rows } = await tx<{ c: number | string }>`
      select count(*) as c
      from ai_conversations
      where deleted_at is not null
        and deleted_at < ${cutoffIsoString}
    `
    const count = toNumber(rows[0]?.c ?? 0)
    if (count > 0) {
      await tx`
        delete from ai_conversations
        where deleted_at is not null
          and deleted_at < ${cutoffIsoString}
      `
    }
    return count
  })
}
