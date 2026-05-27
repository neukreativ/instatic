/**
 * Translates Anthropic Claude Agent SDK messages into canonical
 * `AiStreamEvent`s.
 *
 * Wire shape: the SDK emits four message types we care about:
 *   - `stream_event`   — fine-grained partials (text deltas, tool input
 *                        accumulation). Each text delta becomes a
 *                        `{ type: 'text', text }` event; tool_use blocks
 *                        become paired `toolCall` (pending) events.
 *   - `assistant`      — complete assistant turn; ignored when we've
 *                        already seen its content via `stream_event`.
 *   - `user`           — carries `tool_result` blocks → emit `toolResult`.
 *   - `result`         — terminal usage report → emit `usage`.
 */

import type { AiStreamEvent } from '../runtime/types'

interface StreamingToolState {
  id: string
  name: string
  inputJson: string
}

export interface AnthropicStreamState {
  sessionId: string | null
  sawPartialAssistantMessage: boolean
  toolsByIndex: Map<number, StreamingToolState>
  toolNamesById: Map<string, string>
}

export function createAnthropicStreamState(): AnthropicStreamState {
  return {
    sessionId: null,
    sawPartialAssistantMessage: false,
    toolsByIndex: new Map(),
    toolNamesById: new Map(),
  }
}

/**
 * Convert one SDK message into zero or more AiStreamEvents.
 *
 * The SDK emits four message types we care about:
 *   - `stream_event`     — fine-grained partial content (text deltas, tool
 *                          input accumulation)
 *   - `assistant`        — complete assistant turn; we ignore the body if
 *                          we already saw it via stream_event
 *   - `user`             — contains `tool_result` blocks → emit toolResult
 *   - `result`           — terminal usage report → emit usage event
 */
export function toAiStreamEvents(
  message: unknown,
  state: AnthropicStreamState,
): AiStreamEvent[] {
  const events: AiStreamEvent[] = []
  const sdkMessage = message as { type?: string }

  // Session id appears on every message; emit once on first sight.
  const sessionEvent = getSessionEvent(message, state)
  if (sessionEvent) events.push(sessionEvent)

  if (sdkMessage.type === 'stream_event') {
    state.sawPartialAssistantMessage = true
    events.push(...fromPartial(message, state))
    return events
  }

  if (sdkMessage.type === 'assistant') {
    if (!state.sawPartialAssistantMessage) {
      events.push(...fromCompleteAssistant(message, state))
    }
    return events
  }

  if (sdkMessage.type === 'user') {
    events.push(...fromUserToolResult(message, state))
    return events
  }

  if (sdkMessage.type === 'result') {
    const usageEvent = fromResultUsage(message)
    if (usageEvent) events.push(usageEvent)
    return events
  }

  return events
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function getSessionEvent(
  message: unknown,
  state: AnthropicStreamState,
): AiStreamEvent | null {
  const sessionId = (message as { session_id?: unknown }).session_id
  if (typeof sessionId !== 'string' || !sessionId.trim()) return null
  const trimmed = sessionId.trim()
  if (trimmed === state.sessionId) return null
  state.sessionId = trimmed
  return { type: 'session', sessionId: trimmed }
}

// ---------------------------------------------------------------------------
// stream_event (fine-grained partials)
// ---------------------------------------------------------------------------

function fromPartial(
  message: unknown,
  state: AnthropicStreamState,
): AiStreamEvent[] {
  const event = (message as { event?: Record<string, unknown> }).event
  if (!event) return []

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return [{ type: 'text', text: delta.text }]
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const tool = state.toolsByIndex.get(Number(event.index))
      if (tool) tool.inputJson += delta.partial_json
    }
    return []
  }

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined
    if (block?.type !== 'tool_use') return []
    const index = Number(event.index)
    const id = typeof block.id === 'string' ? block.id : `tool-${index}`
    const name = typeof block.name === 'string' ? block.name : 'tool'
    const input = block.input
    state.toolsByIndex.set(index, {
      id,
      name,
      inputJson: typeof input === 'string' ? input : '',
    })
    state.toolNamesById.set(id, name)
    // Emit a tentative toolCall with whatever input we know so far. A
    // second toolCall with the same toolCallId will land at content_block_stop
    // once the input JSON has fully streamed in. The browser/UI overwrites
    // the prior block by toolCallId.
    return [{
      type: 'toolCall',
      toolCallId: id,
      toolName: name,
      input: input ?? {},
      status: 'pending',
    }]
  }

  if (event.type === 'content_block_stop') {
    const index = Number(event.index)
    const tool = state.toolsByIndex.get(index)
    if (!tool) return []
    state.toolsByIndex.delete(index)
    const input = parseMaybeJson(tool.inputJson)
    return [{
      type: 'toolCall',
      toolCallId: tool.id,
      toolName: tool.name,
      input: input ?? {},
      status: 'pending',
    }]
  }

  return []
}

// ---------------------------------------------------------------------------
// Complete assistant message (non-streamed fallback)
// ---------------------------------------------------------------------------

function fromCompleteAssistant(
  message: unknown,
  state: AnthropicStreamState,
): AiStreamEvent[] {
  const events: AiStreamEvent[] = []
  const blocks = getMessageContentBlocks(message)
  let text = ''

  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
      continue
    }
    if (block.type === 'tool_use') {
      const id = typeof block.id === 'string' ? block.id : `tool-${state.toolNamesById.size + 1}`
      const name = typeof block.name === 'string' ? block.name : 'tool'
      state.toolNamesById.set(id, name)
      events.push({
        type: 'toolCall',
        toolCallId: id,
        toolName: name,
        input: block.input ?? {},
        status: 'pending',
      })
    }
  }

  if (text) events.unshift({ type: 'text', text })
  return events
}

// ---------------------------------------------------------------------------
// user → tool_result blocks
// ---------------------------------------------------------------------------

function fromUserToolResult(
  message: unknown,
  state: AnthropicStreamState,
): AiStreamEvent[] {
  return getMessageContentBlocks(message)
    .filter((block) => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
    .map<AiStreamEvent>((block) => {
      const toolCallId = String(block.tool_use_id)
      const name = state.toolNamesById.get(toolCallId) ?? 'tool'
      return {
        type: 'toolResult',
        toolCallId,
        toolName: name,
        ok: !block.is_error,
        error: block.is_error ? extractToolErrorMessage(block) : undefined,
      }
    })
}

// ---------------------------------------------------------------------------
// result → usage event
// ---------------------------------------------------------------------------

function fromResultUsage(message: unknown): AiStreamEvent | null {
  const result = message as {
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_creation_input_tokens?: number
      cache_read_input_tokens?: number
    }
    total_cost_usd?: number
  }
  const usage = result.usage
  if (!usage) return null
  return {
    type: 'usage',
    promptTokens: usage.input_tokens ?? 0,
    completionTokens: usage.output_tokens ?? 0,
    costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToolErrorMessage(block: Record<string, unknown>): string {
  const content = block.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => (typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n')
    if (text) return text
  }
  return 'Tool call failed.'
}

function getMessageContentBlocks(message: unknown): Array<Record<string, unknown>> {
  const content = (message as { message?: { content?: unknown } }).message?.content
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object')
    : []
}

function parseMaybeJson(value: string): unknown {
  if (!value.trim()) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}
