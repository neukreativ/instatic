/**
 * Conversation + message record shapes for the persistent chat history.
 *
 * Conversations are per (user, scope). Messages belong to one conversation
 * and have a monotonic `position` within it.
 *
 * Wire shapes are separate from records:
 *   - `ConversationView` is what /admin/api/ai/conversations returns —
 *     summary fields only; full message history fetched on open.
 *   - `MessageView` is the per-message wire shape, AiContentBlock[] inline.
 */

import type { AiContentBlock, ToolScope } from '../runtime/types'

// ---------------------------------------------------------------------------
// Server-side records (DB row shape, normalised)
// ---------------------------------------------------------------------------

export interface ConversationRecord {
  readonly id: string
  readonly userId: string
  readonly scope: ToolScope
  readonly title: string
  readonly credentialId: string | null
  readonly modelId: string
  readonly sessionId: string | null
  readonly contextJson: string | null
  readonly promptTokensTotal: number
  readonly completionTokensTotal: number
  readonly costUsdTotal: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly deletedAt: string | null
}

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface MessageRecord {
  readonly id: string
  readonly conversationId: string
  readonly position: number
  readonly role: MessageRole
  readonly content: AiContentBlock[]
  readonly toolCallId: string | null
  readonly toolName: string | null
  readonly promptTokens: number
  readonly completionTokens: number
  readonly costUsd: number
  readonly createdAt: string
}

// ---------------------------------------------------------------------------
// Wire-safe views
// ---------------------------------------------------------------------------

export interface ConversationView {
  readonly id: string
  readonly scope: ToolScope
  readonly title: string
  readonly credentialId: string | null
  readonly modelId: string
  readonly promptTokensTotal: number
  readonly completionTokensTotal: number
  readonly costUsdTotal: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MessageView {
  readonly id: string
  readonly position: number
  readonly role: MessageRole
  readonly content: AiContentBlock[]
  readonly toolCallId: string | null
  readonly toolName: string | null
  readonly createdAt: string
}

export interface ConversationDetailView extends ConversationView {
  readonly contextJson: string | null
  readonly messages: MessageView[]
}

// ---------------------------------------------------------------------------
// Create + update inputs
// ---------------------------------------------------------------------------

export interface CreateConversationInput {
  readonly scope: ToolScope
  readonly title?: string
  readonly credentialId: string
  readonly modelId: string
  readonly contextJson?: string
}

export interface UpdateConversationInput {
  readonly title?: string
  readonly credentialId?: string
  readonly modelId?: string
  readonly sessionId?: string | null
}

export interface AppendMessageInput {
  readonly role: MessageRole
  readonly content: AiContentBlock[]
  readonly toolCallId?: string
  readonly toolName?: string
  readonly promptTokens?: number
  readonly completionTokens?: number
  readonly costUsd?: number
}
