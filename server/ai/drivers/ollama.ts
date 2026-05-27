/**
 * Ollama driver — Phase 1 SKELETON.
 *
 * Plain `fetch` against any OpenAI-compatible local endpoint. The
 * architecture is in place (driver registered, credential UI accepts a
 * baseUrl), but `stream()` is not implemented yet — invoking it yields a
 * clear error event.
 *
 * Filling this in is the immediate Phase 1 follow-up:
 *   1. POST to `${creds.baseUrl}/v1/chat/completions` with `stream: true`
 *      and the AiTool[] transformed to OpenAI-compatible JSON Schema.
 *   2. Parse the SSE response (`data: ...\n\n` lines) into AiStreamEvents.
 *   3. Browser-bridge each tool call via `req.bridge.callBrowser(...)`.
 *
 * No SDK import — pure fetch.
 */

import type {
  AiAuthMode,
  AiProviderId,
  AiStreamEvent,
} from '../runtime/types'
import type {
  AiProvider,
  AiProviderModel,
  AiResolvedCredential,
  AiStreamRequest,
} from './types'

const SUPPORTED_AUTH_MODES: AiAuthMode[] = ['baseUrl']

// Ollama models vary per-install. Defaults are common picks as of May 2026;
// the chat handler can call listModels() against the credential's baseUrl
// for the real list once the driver is live.
const FALLBACK_MODELS: AiProviderModel[] = [
  {
    id: 'llama4',
    label: 'Llama 4',
    tier: 'smart',
    capabilities: { toolCalling: true, visionInput: true, promptCache: false, streaming: true },
  },
  {
    id: 'llama3.3',
    label: 'Llama 3.3',
    tier: 'balanced',
    capabilities: { toolCalling: true, visionInput: false, promptCache: false, streaming: true },
  },
  {
    id: 'qwen3',
    label: 'Qwen 3',
    tier: 'balanced',
    capabilities: { toolCalling: true, visionInput: false, promptCache: false, streaming: true },
  },
]

export const ollamaDriver: AiProvider = {
  id: 'ollama' as AiProviderId,
  label: 'Ollama (local)',
  supportedAuthModes: SUPPORTED_AUTH_MODES,

  capabilities(modelId: string) {
    const model = FALLBACK_MODELS.find((m) => m.id === modelId)
    return model?.capabilities ?? {
      toolCalling: true,
      visionInput: false,
      promptCache: false,
      streaming: true,
    }
  },

  async listModels(creds: AiResolvedCredential) {
    // When wired up: GET `${creds.baseUrl}/api/tags` and map the response.
    // For now: fall back to the static list so the picker UI works.
    if (!creds.baseUrl) return FALLBACK_MODELS
    return FALLBACK_MODELS
  },

  async *stream(_req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    yield {
      type: 'error',
      message:
        'Ollama provider is not yet active. ' +
        'Phase 1 ships Anthropic only — use an Anthropic credential or wait for the Ollama driver to land in a follow-up.',
    }
  },
}
