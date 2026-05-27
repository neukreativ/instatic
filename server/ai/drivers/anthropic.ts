/**
 * Anthropic driver — `@anthropic-ai/claude-agent-sdk`.
 *
 * Authentication:
 *   API key only. The driver scopes `ANTHROPIC_API_KEY` to the SDK call
 *   via the `Options.env` field for that single invocation — the host
 *   process env is never mutated.
 *
 * Tool registration:
 *   The SDK's `tool()` API requires `AnyZodRawShape`. Each canonical
 *   AiTool's TypeBox input schema is converted via `typeboxToZod.ts` (the
 *   ONLY legitimate Zod use in the repo, kept inside the drivers/ tree).
 *   The MCP server is built per-request via `createSdkMcpServer` so the
 *   browser bridge + per-call context can close over the tools cleanly.
 *
 * Streaming:
 *   The SDK yields SdkMessage values; this driver normalises them into
 *   canonical AiStreamEvent. Translation lives in `./anthropicStream.ts`
 *   so this file stays small.
 *
 * Gated by `ai-driver-isolation.test.ts`: this file is the only legal
 * importer of `@anthropic-ai/claude-agent-sdk` and `zod` in the repo.
 */

import {
  createSdkMcpServer,
  query,
  tool,
  type Options,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ZodTypeAny } from 'zod'
import { parseValue } from '@core/utils/typeboxHelpers'
import type {
  AiAuthMode,
  AiMessage,
  AiProviderId,
  AiStreamEvent,
  AiTool,
  AiToolOutput,
  ToolContext,
} from '../runtime/types'
import type {
  AiProvider,
  AiProviderModel,
  AiStreamRequest,
} from './types'
import { typeboxObjectToZodRawShape } from './typeboxToZod'
import {
  createAnthropicStreamState,
  toAiStreamEvents,
} from './anthropicStream'

const SUPPORTED_AUTH_MODES: AiAuthMode[] = ['apiKey']

// Static model list — current as of May 2026. Updating this in lockstep with
// provider releases is a known maintenance cost; the alternative (hitting
// `client.models.list` on every model-picker open) is too slow. Same
// maintenance pattern as `server/ai/pricing.ts`.
//
// Sources:
//   - https://platform.claude.com/docs/en/about-claude/models/overview
//   - https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/models.md
const MODELS: AiProviderModel[] = [
  {
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    tier: 'smartest',
    capabilities: { toolCalling: true, visionInput: true, promptCache: true, streaming: true },
  },
  {
    id: 'claude-opus-4-6',
    label: 'Claude Opus 4.6',
    tier: 'smart',
    capabilities: { toolCalling: true, visionInput: true, promptCache: true, streaming: true },
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    tier: 'balanced',
    capabilities: { toolCalling: true, visionInput: true, promptCache: true, streaming: true },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    tier: 'fast',
    capabilities: { toolCalling: true, visionInput: true, promptCache: true, streaming: true },
  },
]

export const anthropicDriver: AiProvider = {
  id: 'anthropic' as AiProviderId,
  label: 'Anthropic',
  supportedAuthModes: SUPPORTED_AUTH_MODES,

  capabilities(modelId: string) {
    const model = MODELS.find((m) => m.id === modelId)
    return model?.capabilities ?? {
      toolCalling: true,
      visionInput: false,
      promptCache: true,
      streaming: true,
    }
  },

  async listModels(_creds) {
    // Static list for v1 — see the comment on MODELS above.
    return MODELS
  },

  async *stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    yield* runAnthropicStream(req)
  },
}

// ---------------------------------------------------------------------------
// Streaming implementation
// ---------------------------------------------------------------------------

async function* runAnthropicStream(req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
  if (req.credentials.authMode !== 'apiKey' || !req.credentials.apiKey) {
    // Defensive: a non-apiKey credential reaching the driver implies a
    // mismatched DB row or a bypassed UI. Fail cleanly instead of
    // delegating to the SDK and getting a generic 401.
    yield {
      type: 'error',
      message:
        'Anthropic requires an API key. Add an API-key credential in /admin/ai/providers and pick it for the site default.',
    }
    return
  }

  const mcpServer = buildMcpServerForTools(req.tools, req.bridge, req.signal)
  const options = buildQueryOptions(req, mcpServer)
  const prompt = serialiseMessagesAsPrompt(req.messages)
  const streamState = createAnthropicStreamState()

  for await (const message of query({ prompt, options })) {
    for (const event of toAiStreamEvents(message, streamState)) {
      yield event
    }

    if (message.type === 'assistant') {
      const sdkMsg = message as { type: 'assistant'; message?: unknown; error?: unknown }
      if (!sdkMsg.message) {
        // Auth/billing failure surfaces here as an absent message body.
        // Log internally + emit a generic error (CWE-209 — never leak raw
        // SDK details to the browser).
        console.error('[ai/anthropic] assistant message unavailable (auth/billing):', sdkMsg.error)
        yield { type: 'error', message: 'Anthropic auth or billing error. Check your credentials in /admin/ai/providers.' }
        return
      }
    } else if (message.type === 'result') {
      const result = message as { type: 'result'; is_error?: boolean; subtype?: string; errors?: string[] }
      if (result.is_error) {
        console.error('[ai/anthropic] SDK result error:', result.subtype, result.errors)
        yield { type: 'error', message: 'Anthropic session ended with an error. Please try again.' }
        return
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SDK query options
// ---------------------------------------------------------------------------

// The in-app panel edits the live site only. Filesystem + shell tools have
// no use case here and would be a managed-mode risk; deny them at the SDK
// level so the model can't request them.
const DISALLOWED_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit']

function buildQueryOptions(
  req: AiStreamRequest,
  mcpServer: ReturnType<typeof createSdkMcpServer>,
): Options {
  const options: Options = {
    systemPrompt: req.systemPrompt,
    model: req.modelId,
    cwd: process.cwd(),
    mcpServers: { ai_tools: mcpServer },
    includePartialMessages: true,
    skills: [],
    disallowedTools: DISALLOWED_TOOLS,
    // Anything past the deny-rule check is auto-approved — the in-app panel
    // has no user-facing tool-approval prompt; the user reviews via Cmd+Z.
    canUseTool: async (_name, input) => ({ behavior: 'allow', updatedInput: input }),
  }

  // Scope `ANTHROPIC_API_KEY` to this single SDK call via Options.env so
  // the host process env stays clean and concurrent chats with different
  // keys don't race.
  options.env = {
    ...process.env,
    ANTHROPIC_API_KEY: req.credentials.apiKey!,
  } as Record<string, string>

  return options
}

// ---------------------------------------------------------------------------
// MCP server — adapts canonical AiTool[] into the SDK's tool() shape
// ---------------------------------------------------------------------------

function buildMcpServerForTools(
  tools: AiTool[],
  bridge: AiStreamRequest['bridge'],
  signal: AbortSignal,
) {
  const sdkTools = tools.map((t) => toolToSdkDefinition(t, bridge, signal))
  return createSdkMcpServer({
    name: 'ai_tools',
    version: '1.0.0',
    alwaysLoad: true,
    tools: sdkTools,
  })
}

function toolToSdkDefinition(
  aiTool: AiTool,
  bridge: AiStreamRequest['bridge'],
  signal: AbortSignal,
): SdkMcpToolDefinition<Record<string, ZodTypeAny>> {
  const rawShape = typeboxObjectToZodRawShape(aiTool.inputSchema)
  return tool(
    aiTool.name,
    aiTool.description,
    rawShape,
    async (input) => callTool(aiTool, input, bridge, signal),
    { alwaysLoad: true },
  )
}

async function callTool(
  aiTool: AiTool,
  rawInput: unknown,
  bridge: AiStreamRequest['bridge'],
  signal: AbortSignal,
): Promise<CallToolResult> {
  // Defence in depth: re-validate against the TypeBox schema before either
  // calling the handler OR forwarding to the browser. The SDK already
  // validated against Zod, but the TypeBox schema is the canonical source
  // of truth and may carry stricter constraints in edge cases.
  let validated: unknown
  try {
    validated = parseValue(aiTool.inputSchema, rawInput)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid tool input.'
    return errorResult(message)
  }

  if (aiTool.execution === 'server') {
    if (!aiTool.handler) {
      return errorResult(`Tool ${aiTool.name} declares execution='server' but has no handler.`)
    }
    try {
      const ctx: ToolContext = {
        // The runner currently doesn't thread userId/scope/conversationId
        // through tool calls because read tools only need the snapshot.
        // Plumbing this through is a Phase 1 chore — handlers can extend
        // the context object before invoking the runner.
        userId: '',
        scope: 'site',
        conversationId: '',
        snapshot: __toolSnapshotForTesting,
        signal,
      }
      const result = await aiTool.handler(validated, ctx)
      return successResult(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : `Tool ${aiTool.name} failed.`
      return errorResult(message)
    }
  }

  // Browser-execution: forward to the bridge and wait.
  try {
    const result: AiToolOutput = await bridge.callBrowser(aiTool.name, validated)
    if (!result.ok) return errorResult(result.error ?? `Tool ${aiTool.name} failed.`)
    return successResult(result.data ?? { ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : `Tool ${aiTool.name} failed.`
    return errorResult(message)
  }
}

function successResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: typeof data === 'object' && data !== null
      ? (data as Record<string, unknown>)
      : { value: data },
  }
}

function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
    structuredContent: { ok: false, error: message },
  }
}

// ---------------------------------------------------------------------------
// Snapshot wiring — temporary
// ---------------------------------------------------------------------------
//
// The Claude Agent SDK's `tool()` callback API is fire-and-forget per call:
// the SDK doesn't pass per-conversation context through to the handler.
// Server-resolved read tools (list_modules, inspect_node, ...) need the
// snapshot the chat handler attached to the request.
//
// Phase 1 wires this through a module-level binding the handler sets before
// kicking off the stream and clears in the finally block. NOT re-entrant —
// only one chat per process at a time would be a regression; in practice
// node-style request isolation via async-local-storage is a Phase-3 followup.
// For now the chat handler is the only call-site and is single-stream per
// request, so this is safe.

let __toolSnapshotForTesting: unknown = undefined

export function __setActiveToolSnapshot(snapshot: unknown): void {
  __toolSnapshotForTesting = snapshot
}

export function __clearActiveToolSnapshot(): void {
  __toolSnapshotForTesting = undefined
}

// ---------------------------------------------------------------------------
// Messages → prompt string
// ---------------------------------------------------------------------------

/**
 * The Claude Agent SDK takes `prompt` as a single string (a one-shot
 * "user said this" representation). The runner threads `messages` through
 * for history; we serialise it back into a single string.
 *
 * For a brand-new conversation the array contains one user message and we
 * emit just its text. For resumed conversations the SDK's `Options.resume`
 * via `session_id` is the canonical history mechanism — Phase 3 will wire
 * the session id end-to-end.
 *
 * This intentionally only handles the simplest case for v1. Multi-turn
 * threading through the SDK happens via `resume`, not via a recomposed
 * prompt string.
 */
function serialiseMessagesAsPrompt(messages: AiMessage[]): string {
  const last = messages.at(-1)
  if (!last || last.role !== 'user') {
    return messages
      .filter((m): m is Extract<AiMessage, { role: 'user' }> => m.role === 'user')
      .map((m) => contentBlocksToText(m.content))
      .join('\n')
  }
  return contentBlocksToText(last.content)
}

function contentBlocksToText(content: Extract<AiMessage, { role: 'user' }>['content']): string {
  return content
    .map((block) => {
      if (block.kind === 'text') return block.text
      if (block.kind === 'image') return '[image attached]'
      if (block.kind === 'toolCall') return `[tool: ${block.toolName}]`
      return ''
    })
    .join(' ')
}
