/**
 * Driver-facing types — the contract every provider driver implements.
 *
 * The runtime owns the agent loop and the bridge; drivers own one SDK each
 * and one or more `AiAuthMode`s.
 *
 * @see docs/plans/2026-05-26-ai-runtime-rewrite.md → "Drivers"
 */

import type {
  AiAuthMode,
  AiBrowserBridge,
  AiMessage,
  AiProviderId,
  AiStreamEvent,
  AiTool,
} from '../runtime/types'

// ---------------------------------------------------------------------------
// Resolved credential — what a driver receives at call time.
// ---------------------------------------------------------------------------

/**
 * Per-call credential, decrypted and assembled by `server/ai/credentials/store.ts`.
 *
 * Shape varies by auth mode:
 *   - 'apiKey'   → apiKey set, baseUrl === null
 *   - 'baseUrl'  → baseUrl set, apiKey may be set (optional bearer)
 *
 * The shape constraints mirror the `ai_creds_apikey_shape_check` DB-level
 * check, so by the time a CredentialRecord reaches this stage, the runtime
 * trusts the union.
 */
export interface AiResolvedCredential {
  readonly id: string
  readonly providerId: AiProviderId
  readonly authMode: AiAuthMode
  readonly apiKey: string | null
  readonly baseUrl: string | null
}

// ---------------------------------------------------------------------------
// Provider capabilities — drivers report what they support.
// ---------------------------------------------------------------------------

export interface AiProviderCapabilities {
  /** Model supports tool/function calling. False for some Ollama models. */
  readonly toolCalling: boolean
  /** Model accepts image content blocks. */
  readonly visionInput: boolean
  /** Provider supports Anthropic-style cache_control on the static prefix. */
  readonly promptCache: boolean
  /** Provider streams tokens. Currently always true; future non-streaming drivers may set false. */
  readonly streaming: boolean
}

// ---------------------------------------------------------------------------
// Model descriptor — returned by listModels(), shown in the picker UI.
// ---------------------------------------------------------------------------

export interface AiProviderModel {
  readonly id: string
  readonly label: string
  readonly capabilities: AiProviderCapabilities
  /**
   * Hint shown next to the label in the picker (e.g. "fast", "smart",
   * "long-context"). Drivers may omit; UI falls back to model id.
   */
  readonly tier?: string
}

// ---------------------------------------------------------------------------
// Stream request — runner builds this once per turn and hands to driver.stream()
// ---------------------------------------------------------------------------

export interface AiStreamRequest {
  /**
   * System prompt as a 1- or 3-element array. Single string = no caching.
   * Three elements [prefix, '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', suffix]
   * = drivers that support prompt cache (Anthropic) apply `cache_control`
   * to the prefix; others concatenate.
   */
  readonly systemPrompt: string[]
  readonly messages: AiMessage[]
  readonly tools: AiTool[]
  readonly modelId: string
  readonly credentials: AiResolvedCredential
  readonly signal: AbortSignal
  readonly bridge: AiBrowserBridge
}

// ---------------------------------------------------------------------------
// Provider interface — every driver implements this.
// ---------------------------------------------------------------------------

export interface AiProvider {
  readonly id: AiProviderId
  readonly label: string
  /**
   * Which auth modes this provider supports. The credential UI uses this
   * to gate the auth-mode picker per provider.
   *
   *   anthropic → ['apiKey']
   *   openai    → ['apiKey']
   *   ollama    → ['baseUrl']
   */
  readonly supportedAuthModes: readonly AiAuthMode[]

  capabilities(modelId: string): AiProviderCapabilities

  listModels(credentials: AiResolvedCredential): Promise<AiProviderModel[]>

  /**
   * Run one agent turn. Yields canonical AiStreamEvents as the model
   * produces them. When a write tool is required, yields a `toolRequest`
   * and awaits the bridge promise — same mechanic the current
   * implementation uses at `server/handlers/agent/index.ts`.
   *
   * Driver MUST honour `signal`: aborting it stops the underlying SDK
   * stream and rejects any in-flight tool-bridge promises.
   */
  stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent>
}
