# AI Runtime Rewrite — Provider-Agnostic, Multi-Surface, BYO-Key

A plan to take the current single-provider, single-surface Claude Agent SDK integration and turn it into a **provider-agnostic AI runtime** wired into the Site editor, Content workspace, Data workspace, and the Plugin SDK, with **encrypted per-user API key storage** and a **model picker** in every chat surface.

---

## Status (as of last update)

- **Phases 1, 2, 3, 6 shipped** — runtime + drivers + credential/conversation stores; settings UI at `/admin/ai`; site editor rewired onto the new transport with model + conversation pickers + no-credential banner; cost meter + audit (price table at `server/ai/pricing.ts`, `ai.*` audit events, Audit tab with totals + by-user/by-surface/daily rollups, dashboard "AI usage" widget).
- **Phase 4 — content workspace shipped.** AgentPanel docked in `ContentSidebar` (mirrors site editor's pattern, rail button + docked panel slot). 15 content tools (7 read + 8 write) covering collections, documents, fields, media, users. Bridge handle dispatches to live workspace state via refs. Body field exchanged as markdown via the existing `@core/markdown/markdownDocument.ts` converter. **Data workspace and Plugin SDK not yet built.**
- **Phase 5 (Plugin SDK `ai.invoke`)** is the only remaining phase.

## TL;DR

- One canonical **AI runtime** (`server/ai/`) replaces the bespoke `server/handlers/agent/*` stack.
- Four **provider drivers** behind an `AiProvider` interface: `anthropic`, `openai`, `openrouter`, `ollama`. Auth modes: `apiKey` (Anthropic, OpenAI, OpenRouter) and `baseUrl` (Ollama).
  - Anthropic: direct `POST https://api.anthropic.com/v1/messages` (no SDK). The shared `server/ai/drivers/http/` layer owns SSE parsing and the multi-turn tool loop; `anthropicStream.ts` was deleted. Prompt caching applied via `cache_control` on the static system prefix.
  - OpenAI: `@openai/agents`. Driver constructs a per-call `OpenAIProvider({ apiKey })` and wires it via `Runner({ modelProvider })`.
  - OpenRouter: `@openrouter/agent`. Driver constructs a per-call `OpenRouter({ apiKey })`. Fetches a live model catalog from OpenRouter's `/api/v1/models` (400+ models). Reports native USD cost per call — no static price-table entry needed.
  - Ollama: no SDK, plain `fetch` against any OpenAI-compatible local endpoint. `baseUrl` mode (+ optional bearer key).
- One **tool registry** (`server/ai/tools/`) defined with TypeBox; drivers translate to their SDK's native shape (Anthropic + OpenRouter get a thin Zod wrapper via `typeboxToZod.ts`; OpenAI + Ollama get JSON Schema).
- **Encrypted credential store** (`ai_provider_credentials` table) — AES-256-GCM via Bun's `crypto.subtle`, master key from env var `INSTATIC_SECRET_KEY`. Multiple rows per provider allowed (different keys for different purposes). Plaintext never crosses the wire.
- **Persistent conversations**: tables `ai_conversations` + `ai_messages`, scoped per user + per surface. Soft-delete with a nightly job that hard-purges rows older than 30 days. Conversations survive reload and device-switching.
- **Four AI surfaces** with scoped toolsets and **independent message histories**: Site editor (24 tools, live), Content workspace (15 tools, live), Data workspace (Phase 4 follow-up), Plugin SDK (Phase 5).
- **Model picker** in every chat: `(credentialId, modelId)` persisted per-surface. Defaults sourced from site-wide config with per-user override.
- **New capabilities**: `ai.providers.manage` (set keys + site defaults), `ai.use` (invoke any AI surface, read own conversations), `ai.audit.read` (see all-user usage log).
- **No-credential UX**: banner inside the chat panel with a "Open AI settings" deep-link to `/admin/ai`; Send button disabled until at least one credential exists.
- **Cost tracking:** Anthropic/OpenAI/Ollama use a hard-coded price table (`server/ai/pricing.ts`). OpenRouter provides native per-call USD cost and is intentionally absent from the table. Token counts always stored; cost rolls up daily.
- **Six-phase rollout**. Phases 1-3 are live; 4-6 are the next deliverables.

---

## Why this shape

Three concerns drove the design:

1. **Provider-agnostic transport.** The runtime owns the agent loop, NDJSON wire, and bridge bookkeeping. Drivers know one SDK each and translate between the canonical event/tool types and their SDK's native shapes.
2. **BYO-key, never ambient.** Every credential carries an explicit API key. OpenAI never offered a programmatic ambient auth path for tool-calling; Anthropic offered one but is phasing it out. The simpler "every credential carries a key" model is consistent across providers and avoids the operational drift of dev-host CLI logins.
3. **Cross-surface ready.** Tools are defined once and selected per scope (`site`, `content`, `data`, `plugin`). New surfaces register a tool subset + system prompt + browser bridge; the runtime and credential layer are reused.

Pre-release rules (`CLAUDE.md` → "No backward compatibility. Ever.") apply throughout. The old `/admin/api/agent` endpoints, the `agentSlice.ts` transport, the `executor.ts` tool dispatcher, and the `no-anthropic-sdk.test.ts` gate are all replaced — not wrapped, not deprecated, not preserved.

---

## Goals and non-goals

### Goals

- One AI runtime that any admin surface (or plugin) can call.
- BYO-key for each provider, stored encrypted, set per-user via UI.
- Model picker in every chat. Defaults configurable at site + user level.
- Tools defined once, callable from any driver.
- Quotas + audit + cost meter from day one — not a Phase 7 add-on.
- Step-up auth still applies to destructive AI actions (publish, deletePage, etc.) — same gate as human actions.

### Non-goals

- A new chat protocol invented from scratch. The existing NDJSON `ServerStreamEvent` shape stays; we add a few event variants.
- Multi-agent orchestration. One thread = one model = one tool loop. (Plugin SDK calls are independent threads; they don't share state with admin surfaces.)
- A marketplace of community-supplied providers. Drivers are first-party only; pluggable drivers would expose the credentials to plugin code.
- Replacing the Cmd+K Spotlight. Spotlight stays a deterministic command palette. Putting AI into Spotlight remains a future decision (the user did not select it).
- Streaming media generation (image, audio). Out of scope for this plan.

---

## Target architecture

```text
server/ai/
├── runtime/
│   ├── runner.ts           Generic agent loop: feeds messages to driver, drains
│   │                       stream events, dispatches tool calls, posts results.
│   ├── transport.ts        NDJSON stream wrapper + bridge registry (carryover
│   │                       of activeBridges from agent/index.ts).
│   ├── types.ts            AiMessage, AiStreamEvent, AiToolCall, AiCompletion, ...
│   └── systemPrompt.ts     Helper to assemble per-surface system prompts.
│
├── drivers/
│   ├── index.ts            Driver registry + `resolveDriver(providerId)`.
│   ├── anthropic.ts        Uses @anthropic-ai/claude-agent-sdk (the only
│   │                       Anthropic SDK in the repo). Driver passes the
│   │                       user's key into the SDK's `Options.env` per call.
│   ├── anthropicStream.ts  SDK message → AiStreamEvent translation.
│   ├── openai.ts           Uses @openai/agents. Driver constructs a per-call
│   │                       OpenAIProvider({ apiKey }) wired via Runner.
│   ├── ollama.ts           Plain fetch against an OpenAI-compatible endpoint.
│   │                       authMode = 'baseUrl' (+ optional bearer key).
│   ├── typeboxToZod.ts     Thin adapter required by Claude Agent SDK's tool().
│   └── types.ts            AiProvider, AiAuthMode, AiProviderModel, AiResolvedCredential.
│
├── tools/
│   ├── index.ts            Tool registry + selectByScope() / selectByIds().
│   ├── types.ts            AiTool<TInput, TOutput> + ToolScope union.
│   ├── instatic/        22 site-editor tools (replaces handlers/agent/tools.ts).
│   ├── content/            Posts/pages CRUD + richtext-assist tools.
│   ├── data/               Tables/rows CRUD + generateRows + queryRows.
│   └── shared/             render_snapshot (browser-bridged), getSiteContext, ...
│
├── credentials/
│   ├── store.ts            Repository over ai_provider_credentials table.
│   ├── encryption.ts       AES-256-GCM via crypto.subtle; key from env.
│   ├── types.ts            CredentialRecord (server) + CredentialView (wire).
│   └── masterKey.ts        loadMasterKey(): boot-time bootstrap + fingerprint.
│
├── conversations/
│   ├── store.ts            Repository over ai_conversations + ai_messages.
│   ├── types.ts            ConversationRecord, MessageRecord, ConversationView.
│   └── purge.ts            Nightly job: hard-delete soft-deleted rows >30d old.
│                            Registered via the existing scheduler tick.
│
├── audit/
│   └── logger.ts           Wraps recordAuditEvent('ai.*') for runtime events.
│
└── handlers/
    ├── chat.ts             POST /admin/api/ai/chat/:scope — main stream entrypoint.
    ├── toolResult.ts       POST /admin/api/ai/tool-result — browser bridge POST.
    ├── credentials.ts      GET/POST/PUT/DELETE /admin/api/ai/credentials[/:id].
    ├── credentialTest.ts   POST /admin/api/ai/credentials/:id/test.
    ├── models.ts           GET /admin/api/ai/providers/:id/models?credentialId=...
    ├── defaults.ts         GET/PUT /admin/api/ai/defaults/:scope — site-wide settings.
    └── conversations.ts    GET/POST/PUT/DELETE /admin/api/ai/conversations[/:id].
                            POST /:id/messages appends; GET /:id returns full history.

src/admin/ai/                 (new — admin UI for AI runtime)
├── AiAssistantDrawer.tsx     Shared chat UI primitive (used by Site, Content, Data).
├── AiAssistantSlice.ts       Per-surface slice factory (model picker, current
│                              conversation id, abort). One slice per scope.
├── ConversationSidebar.tsx   Lists this user's conversations for the current
│                              scope; "New chat" button; per-row rename + delete.
├── AiProvidersPage.tsx       /admin/ai/providers — credential CRUD; auth mode
│                              implied by provider (apiKey for Anthropic/OpenAI,
│                              baseUrl for Ollama).
├── AiDefaultsPage.tsx        /admin/ai/defaults — per-scope site-wide defaults
│                              (providerId + credentialId + modelId).
├── AiAuditPage.tsx           /admin/ai/audit — usage / cost / errors (Phase 6).
├── ModelPicker.tsx           Drives (providerId, credentialId, modelId) selection.
├── NoCredentialBanner.tsx    Shown inside the chat panel when no credential
│                              exists; CTA deep-links to /admin/ai/providers.
└── transport.ts              fetch + NDJSON reader; emits AiStreamEvent.

src/admin/pages/site/agent/    (rewritten — no transport, no driver knowledge)
├── pageContext.ts            Snapshot builder (unchanged logic, renamed file).
├── executor.ts               Browser-side write-tool dispatcher (unchanged behaviour).
└── systemPrompt.ts           Page-builder system prompt (unchanged).
```

The Site editor's `agentSlice.ts` and `agentConfig.ts` disappear. Their state composes into the shared `AiAssistantSlice` factory; their executor stays as the browser bridge for write tools.

### Layer responsibilities

| Layer                                | Knows about           | Does NOT know about        |
|--------------------------------------|------------------------|----------------------------|
| `server/ai/runtime/`                 | AiMessage, AiStreamEvent, tool dispatch | which provider, which tools |
| `server/ai/drivers/<provider>.ts`    | one provider's SDK, model list, tool translation | site editor, page tree, audit |
| `server/ai/tools/<scope>/`           | one workspace's domain (page tree / posts / data tables) | which model called them |
| `server/ai/credentials/`             | encryption, DB, audit | provider semantics |
| `server/ai/handlers/`                | HTTP, auth, capability gating | driver internals (calls runtime) |
| `src/admin/ai/`                      | NDJSON stream events, transport | DB, credentials, driver SDKs |
| `src/admin/pages/<workspace>/`       | how to compose AiAssistantDrawer with workspace-specific tools | transport details |

The split is: **runtime is generic; drivers know one SDK; tools know one domain; handlers know HTTP**. No layer crosses two domains.

---

## Core types

```ts
// server/ai/runtime/types.ts

export type AiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: AiContentBlock[] }
  | { role: 'assistant'; content: AiContentBlock[] }
  | { role: 'tool'; toolCallId: string; output: AiToolOutput }

export type AiContentBlock =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; data: string /* base64 */ }
  | { kind: 'toolCall'; toolCallId: string; toolName: string; input: unknown }

export interface AiToolOutput {
  ok: boolean
  data?: unknown
  error?: string
}

export type AiStreamEvent =
  | { type: 'bridgeReady'; bridgeId: string }
  | { type: 'session'; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'toolCall'; toolCallId: string; toolName: string; input: unknown; status: 'pending' }
  | { type: 'toolResult'; toolCallId: string; ok: boolean; error?: string }
  | { type: 'toolRequest'; requestId: string; toolName: string; input: unknown }
  | { type: 'usage'; promptTokens: number; completionTokens: number; costUsd?: number }
  | { type: 'error'; message: string }
  | { type: 'done' }
```

The wire shape is a strict superset of today's `ServerStreamEvent` so the front-end migration is mechanical: rename `name → toolName`, add `toolResult` and `usage` handling, keep everything else.

```ts
// server/ai/drivers/types.ts

export type AiProviderId = 'anthropic' | 'openai' | 'ollama'
export type AiAuthMode = 'apiKey' | 'baseUrl'

export interface AiProvider {
  readonly id: AiProviderId
  readonly label: string
  readonly supportedAuthModes: readonly AiAuthMode[]   // anthropic: ['apiKey']
                                                        // openai:    ['apiKey']
                                                        // ollama:    ['baseUrl']
  capabilities(modelId: string): AiProviderCapabilities

  listModels(creds: AiResolvedCredential): Promise<AiProviderModel[]>

  stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent>
  // The driver owns the entire tool-loop with its SDK; it yields canonical
  // AiStreamEvents. When a tool needs the browser (a write tool), it yields
  // { type: 'toolRequest', ... } and awaits resolution from the transport
  // layer via a bridge promise.
}

export interface AiResolvedCredential {
  id: string                                       // ai_provider_credentials.id
  providerId: AiProviderId
  authMode: AiAuthMode
  apiKey: string | null                            // null when authMode='baseUrl' & no bearer
  baseUrl: string | null                           // set when authMode='baseUrl'
}

export interface AiProviderCapabilities {
  toolCalling: boolean       // false for early Ollama models
  visionInput: boolean       // can accept image blocks
  promptCache: boolean       // supports Anthropic-style cache_control
  streaming: boolean         // always true for now
}

export interface AiStreamRequest {
  systemPrompt: string[]                          // [prefix, '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', suffix] for cache
  messages: AiMessage[]
  tools: AiTool[]
  modelId: string
  credentials: AiResolvedCredential                // never null — handler rejects if no credential
  signal: AbortSignal
  bridge: AiBrowserBridge                          // for write tools
}
```

```ts
// server/ai/tools/types.ts

export interface AiTool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  scope: ToolScope                                 // 'site' | 'content' | 'data' | 'plugin' | 'shared'
  inputSchema: TSchema                             // TypeBox — one source of truth
  execution: 'server' | 'browser'                  // server-resolved vs bridged
  // For 'server' tools, the runtime calls handler() directly.
  handler?: (input: TInput, ctx: ToolContext) => Promise<TOutput>
  // For 'browser' tools, the runtime emits `toolRequest` and waits.
}
```

```ts
// server/ai/credentials/types.ts

export interface CredentialRecord {
  id: string
  userId: string
  providerId: AiProviderId
  displayLabel: string
  ciphertext: Uint8Array
  iv: Uint8Array
  keyFingerprint: string
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
}

export interface CredentialView {
  id: string
  providerId: AiProviderId
  displayLabel: string
  keyFingerprint: string                           // matches current master key?
  createdAt: string
  lastUsedAt: string | null
}
// CredentialView is the only shape that crosses the wire. Plaintext + iv +
// ciphertext NEVER leave the server.
```

---

## Database schema

Three new tables. Sequential migration IDs added to both `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` with identical IDs — gated by `migration-parity.test.ts`.

### `ai_provider_credentials` — encrypted API keys + connection settings

```sql
-- PG dialect
create table ai_provider_credentials (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  provider_id text not null,
  auth_mode text not null,
  display_label text not null,
  ciphertext bytea,                -- set when auth_mode='apiKey'
  iv bytea,                        -- set when auth_mode='apiKey'
  base_url text,                   -- set when auth_mode='baseUrl'
  key_fingerprint text,            -- set when ciphertext is set
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint ai_creds_provider_check
    check (provider_id in ('anthropic', 'openai', 'ollama')),
  constraint ai_creds_authmode_check
    check (auth_mode in ('apiKey', 'baseUrl')),
  constraint ai_creds_apikey_shape_check
    check (
      (auth_mode = 'apiKey'   and ciphertext is not null and iv is not null and base_url is null) or
      (auth_mode = 'baseUrl' and base_url is not null)
    )
);

create unique index ai_creds_user_label_idx
  on ai_provider_credentials (user_id, provider_id, display_label);
```

Notes:
- **Multiple credentials per provider** are allowed and expected — e.g. one user may have "Anthropic (production)" + "Anthropic (personal)" simultaneously and pick one per chat.
- The constraint check enforces auth-mode-shape consistency at the DB layer.
- SQLite dialect mirrors with `text`/`blob` etc per `docs/reference/database-dialects.md`.
- `key_fingerprint` is `sha256(masterKey).slice(0, 16)`. On read, if the current master-key fingerprint mismatches the row's fingerprint, the credential is **flagged as needing re-entry** in the UI. `baseUrl` rows without a bearer token store no fingerprint.

### `ai_defaults` — per-scope site-wide default credential + model

```sql
create table ai_defaults (
  scope text primary key,                    -- 'site' | 'content' | 'data' | 'plugin'
  credential_id text not null references ai_provider_credentials(id) on delete restrict,
  model_id text not null,
  updated_at timestamptz not null default now(),
  updated_by text references users(id) on delete set null,
  constraint ai_defaults_scope_check
    check (scope in ('site', 'content', 'data', 'plugin'))
);
```

`credential_id` points at a specific credential row (not just a provider) so the site-wide default carries auth mode, key, and label together. The `on delete restrict` prevents deleting a credential that is currently the default for any scope — UI nudges to reassign first.

### `ai_conversations` + `ai_messages` — persistent chat history

```sql
create table ai_conversations (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  scope text not null,                       -- 'site' | 'content' | 'data' | 'plugin'
  title text not null,
  credential_id text references ai_provider_credentials(id) on delete set null,
  model_id text not null,
  session_id text,                            -- provider-specific resume id, if any
  context_json text,                          -- per-scope context: { pageId, postId, tableId, ... }
  prompt_tokens_total bigint not null default 0,
  completion_tokens_total bigint not null default 0,
  cost_usd_total numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,                     -- soft-delete; nightly job hard-purges >30d
  constraint ai_conv_scope_check
    check (scope in ('site', 'content', 'data', 'plugin'))
);

create index ai_conv_user_scope_idx
  on ai_conversations (user_id, scope, updated_at desc)
  where deleted_at is null;

create table ai_messages (
  id text primary key,
  conversation_id text not null references ai_conversations(id) on delete cascade,
  position integer not null,                  -- monotonic order within conversation
  role text not null,                          -- 'user' | 'assistant' | 'tool'
  content_json text not null,                  -- AiContentBlock[] serialized
  tool_call_id text,                           -- non-null when role='tool'
  tool_name text,                              -- non-null when content contains toolCall
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now(),
  constraint ai_msg_role_check
    check (role in ('user', 'assistant', 'tool'))
);

create unique index ai_msg_conv_position_idx
  on ai_messages (conversation_id, position);
```

Notes:
- **Per-user, per-scope** queries: `WHERE user_id = ? AND scope = ? AND deleted_at IS NULL ORDER BY updated_at DESC` is the canonical "my recent chats" query, served by `ai_conv_user_scope_idx`.
- **`context_json`** is what the snapshot/page-context payload was when the conversation started — lets us recover "the user was editing page X" if they reopen the chat after switching pages.
- **Soft-delete** sets `deleted_at`. A nightly job (registered via the existing scheduler tick) hard-deletes rows where `deleted_at < now() - interval '30 days'`. Cascading FK takes the messages with it.
- **Token + cost accounting** lives at both row levels: per message (granular) and per conversation (sum, denormalised for the list view).

---

## Encryption

Use **Bun's native `crypto.subtle`** (already used in `server/plugins/host/handlers/crypto.ts:26` for HMAC/digest). AES-256-GCM, 96-bit random IV per record, no additional auth data.

```ts
// server/ai/credentials/encryption.ts (sketch)

const ALG = { name: 'AES-GCM' } as const

export async function encryptSecret(masterKey: CryptoKey, plaintext: string): Promise<{
  ciphertext: Uint8Array
  iv: Uint8Array
}> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const buf = await crypto.subtle.encrypt({ ...ALG, iv }, masterKey, new TextEncoder().encode(plaintext))
  return { ciphertext: new Uint8Array(buf), iv }
}

export async function decryptSecret(masterKey: CryptoKey, ciphertext: Uint8Array, iv: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.decrypt({ ...ALG, iv }, masterKey, ciphertext)
  return new TextDecoder().decode(buf)
}
```

### Master key bootstrap

```ts
// server/ai/credentials/masterKey.ts

export async function loadMasterKey(): Promise<CryptoKey> {
  const raw = process.env.INSTATIC_SECRET_KEY
  if (raw) return importMasterKeyFromBase64(raw)

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[ai/credentials] INSTATIC_SECRET_KEY is required in production. ' +
      'Generate one with: bun run scripts/generate-secret-key.ts',
    )
  }

  // Dev: persist a generated key to .tmp/secret.key so it survives restarts.
  return loadOrCreateDevKey('.tmp/secret.key')
}
```

A `bun run scripts/generate-secret-key.ts` helper prints a fresh base64 32-byte key. Deployment docs (`docs/deployment/`) get a new section on setting this.

### Key rotation

Out of scope for the first cut: rotation requires re-entry of every key (the UI surfaces "Re-enter your key — master key rotated" per row using the fingerprint mismatch). A future plan can add proper rotation with a `previous_key_fingerprint` column.

---

## Drivers

Each driver is a single file under `server/ai/drivers/<id>.ts`. Drivers are the **only** place provider SDKs are imported. The `ai-driver-isolation.test.ts` gate enforces this.

### `anthropic.ts`

- Supported auth modes: `apiKey`.
- No SDK. Direct `POST https://api.anthropic.com/v1/messages` with `x-api-key` header.
- Tool format: `{ name, description, input_schema: <TypeBox schema> }` — TypeBox IS JSON Schema; no Zod bridge required.
- Tool loop + SSE parsing: shared `server/ai/drivers/http/` layer (`toolLoop.ts` + `sse.ts`). The `AnthropicTurnTranslator` handles streaming text, `input_json_delta` accumulation, usage, and stop-reason detection.
- History mapping: `mapHistory(messages: AiMessage[])` coalesces consecutive `assistant` rows and pairs `role:'tool'` rows into Anthropic `tool_result` user turns. Full conversation log replayed every turn — no server-side session.
- Prompt caching (GA): static prefix gets `cache_control: { type: 'ephemeral' }` as a two-block `system` array; the dynamic suffix is a second uncached block.
- `anthropicStream.ts` deleted — its logic now lives in `AnthropicTurnTranslator` inside `anthropic.ts`.

### `openai.ts`

- Supported auth modes: `apiKey`.
- SDK: `@openai/agents` (high-level Agents SDK).
- Auth: driver constructs a per-call `OpenAIProvider({ apiKey })` and wires it via a per-call `Runner({ modelProvider })`.
- Tool format: the Agents SDK accepts JSON Schema via `parameters` with `strict: false`. Driver converts each `AiTool.inputSchema` (TypeBox) to JSON Schema by stripping symbol metadata via `JSON.parse(JSON.stringify(schema))` and forcing `additionalProperties: true`. No Zod required.
- Tool calling: Agents SDK runs the tool loop internally. The driver wraps each `AiTool` with a handler that either resolves server-side (read tools) or yields a `toolRequest` and awaits the browser bridge (write tools).
- Vision: image content blocks supported.

### `openrouter.ts` ✅ added

- Supported auth modes: `apiKey`.
- SDK: `@openrouter/agent`.
- Auth: driver constructs a per-call `new OpenRouter({ apiKey })` — host process env is never mutated; concurrent chats with different keys don't race.
- Tool format: SDK's `tool()` requires Zod; driver reuses `typeboxObjectToZodRawShape` from `typeboxToZod.ts`. One of two legitimate Zod uses in the repo.
- Model catalog: `listModels()` fetches the live `/api/v1/models` catalog from OpenRouter (400+ models). Per-model `supported_parameters` + `architecture.input_modalities` map to our capability flags. Auth header is sent so per-key BYOK-only models appear when a credential is provided.
- Cost: OpenRouter reports native USD cost on `usage.cost`. The driver emits it as `usage.costUsd` — the persister honours it directly via `usage.costUsd ?? calculateCostUsd(...)`, so OpenRouter models never need an entry in the static price table.
- Cross-turn history: only the latest user message is sent as the `input` string (same limitation as the OpenAI driver). Full history replay is a follow-up.

### `ollama.ts`

- Supported auth modes: `baseUrl`.
- No SDK: plain `fetch` against `<creds.baseUrl>/v1/chat/completions`. Optional bearer key in `apiKey` field (used when the operator put Ollama behind a reverse proxy with auth).
- Tool format: OpenAI-compatible JSON Schema.
- Capability flags: `toolCalling: <model-dependent>`, `visionInput: <model-dependent>` — driver checks at `listModels()` time and tags each `AiProviderModel`. Older Ollama models lack tool-calling; UI greys them out in the picker when the active scope requires tools.

### Why one SDK per provider

The user-facing concept is **one provider per backend** (Anthropic, OpenAI, OpenRouter, Ollama). Each driver file imports exactly one SDK. Bypassed paths (e.g. OpenAI's `@openai/codex-sdk` which supports ChatGPT-subscription auth but only for hard-coded codex tools) don't fit the custom-tool requirement of this runtime and are intentionally not used.

### Driver isolation gate

`src/__tests__/architecture/ai-driver-isolation.test.ts`:

- `@anthropic-ai/claude-agent-sdk` may only be imported from `server/ai/drivers/anthropic.ts`.
- `@openai/agents` may only be imported from `server/ai/drivers/openai.ts`.
- `@openrouter/agent` may only be imported from `server/ai/drivers/openrouter.ts`.
- `zod` may only be imported from `server/ai/drivers/anthropic.ts`, `server/ai/drivers/openrouter.ts`, or `server/ai/drivers/typeboxToZod.ts`.
- The plain `@anthropic-ai/sdk` package stays **completely banned everywhere**.
- The runtime, handlers, tools, and UI may import none of the above.

---

## Tool registry

Every tool defined once, in TypeBox, with explicit scope and execution mode.

```ts
// server/ai/tools/instatic/insertNode.ts (example)

import { Type, type Static } from '@core/utils/typeboxHelpers'
import type { AiTool } from '../types'

const InsertNodeInput = Type.Object({
  moduleId: Type.String({ minLength: 1 }),
  parentId: Type.String({ minLength: 1 }),
  index: Type.Optional(Type.Integer({ minimum: 0 })),
  props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  classIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

export const insertNodeTool: AiTool<Static<typeof InsertNodeInput>> = {
  name: 'insertNode',
  scope: 'site',
  execution: 'browser',                            // runs in editor store via bridge
  description: '...same text as today...',
  inputSchema: InsertNodeInput,
}
```

Read tools have `execution: 'server'` and a `handler(input, ctx)`. The `ctx` carries the current scope's snapshot (e.g. page context for site, posts list for content) — built once per request by the handler before invoking the runtime.

### Scoped selection

```ts
// server/ai/tools/index.ts

export function selectToolsForScope(scope: ToolScope): AiTool[] {
  // returns scope tools + 'shared' tools (e.g. getSiteContext)
}
```

The handler picks the scope from the URL (`/admin/api/ai/chat/site`, `/admin/api/ai/chat/content`, etc.) and passes the resulting `AiTool[]` to the driver.

---

## Handlers

| Method + Path                                            | Capability gate                                        | Purpose                                              |
|----------------------------------------------------------|--------------------------------------------------------|------------------------------------------------------|
| `POST /admin/api/ai/chat/:scope`                         | `ai.use` + scope-specific (e.g. `pages.edit` for site) | Open NDJSON stream. Body carries `conversationId` (new or existing) and the user's prompt. |
| `POST /admin/api/ai/tool-result`                         | `ai.use`                                               | Browser bridge POST (renamed; same semantics)        |
| `GET  /admin/api/ai/credentials`                         | `ai.providers.manage`                                  | List CredentialView[] for current user (all auth modes) |
| `POST /admin/api/ai/credentials`                         | `ai.providers.manage`                                  | Create — body `{ providerId, authMode, displayLabel, apiKey?, baseUrl? }` |
| `PUT  /admin/api/ai/credentials/:id`                     | `ai.providers.manage`                                  | Replace secret or rename. Auth mode is immutable; user creates a new row to switch modes. |
| `DELETE /admin/api/ai/credentials/:id`                   | `ai.providers.manage`                                  | Hard-delete. Rejected if the row is referenced by any `ai_defaults`. |
| `POST /admin/api/ai/credentials/:id/test`                | `ai.providers.manage`                                  | Calls `driver.listModels(creds)`; returns `{ ok, modelCount, error }` |
| `GET  /admin/api/ai/providers/:id/models?credentialId=`  | `ai.use`                                               | Returns AiProviderModel[]; cached per-credential, 1h server-side |
| `GET  /admin/api/ai/defaults`                            | `ai.use`                                               | Returns `Record<ToolScope, { credentialId, modelId }>` |
| `PUT  /admin/api/ai/defaults/:scope`                     | `ai.providers.manage`                                  | Updates one scope's site-wide default                |
| `GET  /admin/api/ai/conversations?scope=`                | `ai.use`                                               | List current user's non-deleted conversations for a scope (newest first) |
| `POST /admin/api/ai/conversations`                       | `ai.use`                                               | Create a new conversation row — body `{ scope, title?, credentialId, modelId, contextJson? }` |
| `GET  /admin/api/ai/conversations/:id`                   | `ai.use` + ownership check                             | Full conversation + all messages                     |
| `PUT  /admin/api/ai/conversations/:id`                   | `ai.use` + ownership check                             | Rename, change model, soft-delete (`deletedAt`)      |
| `DELETE /admin/api/ai/conversations/:id`                 | `ai.use` + ownership check                             | Soft-delete. Nightly job hard-purges after 30 days.  |

All state-changing methods CSRF-checked via `originAllowed()` (same gate as today).
All write tools subject to step-up auth when the underlying mutation (publish, deletePage, …) requires it — unchanged from today's behaviour.
Ownership check: every `/conversations/:id` handler verifies `row.user_id === currentUser.id` before reading or mutating.

The old `/admin/api/agent` and `/admin/api/agent/tool-result` are **deleted**, not aliased. Pre-release rules apply.

### How a chat request flows

1. UI selects (or creates) a conversation row via `POST /admin/api/ai/conversations`.
2. UI calls `POST /admin/api/ai/chat/:scope` with `{ conversationId, prompt, pageContext? }`.
3. Handler:
   - Loads the conversation row, verifies ownership, loads message history.
   - Loads the credential row (`credentialId` from the conversation), decrypts.
   - Resolves the driver from `provider_id` and asks for `stream(req)`.
4. Stream events are forwarded NDJSON-encoded to the browser AND persisted to `ai_messages` as they materialise (text streams build a single assistant row that grows; tool calls land as `role='assistant'` + `role='tool'` pairs).
5. On `done`: update conversation totals (tokens, cost), `updated_at`, and emit `ai.chat.completed` audit event.

---

## Capabilities

Three new capabilities added to `src/core/auth/capabilityCatalog.ts` (or wherever the catalog lives) and assigned to the Owner/Admin built-in roles.

| Permission                | Risk     | Granted to (by default)   | What it allows                                  |
|---------------------------|----------|---------------------------|-------------------------------------------------|
| `ai.use`                  | medium   | Owner, Admin              | Open chats, invoke read/write tools, see models |
| `ai.providers.manage`     | high     | Owner, Admin              | Create/update/delete credentials; set defaults  |
| `ai.audit.read`           | medium   | Owner, Admin              | Read AI usage audit log                         |

Client role does NOT get `ai.use` by default — opt-in per deployment.
Member role never gets any of these.

---

## Plugin SDK capability

A single new permission: `ai.invoke`. Catalog entry under `src/core/plugin-sdk/capabilities.ts`:

```ts
{
  permission: 'ai.invoke',
  label: 'Call the configured AI model',
  description:
    'Allows the plugin server entrypoint to call the host AI runtime via ' +
    'api.ai.complete() and api.ai.stream(). The plugin sees model output but ' +
    'never the API key. Subject to per-plugin rate limits and the operator-' +
    'configured monthly token budget.',
  risk: 'high',
  surfaces: ['server'],
},
```

### Sandbox API

Inside the QuickJS sandbox the plugin sees:

```ts
api.ai.complete({
  messages: AiMessage[],
  modelHint?: string,        // 'fast' | 'smart' | 'cheap' — translated by host to a concrete model
  tools?: PluginAiTool[],     // optional plugin-defined tools (handler runs in sandbox)
}): Promise<{ text: string; toolCalls?: ... }>

api.ai.stream({ ... }): AsyncIterable<AiStreamEvent>
```

- The host picks the `(providerId, modelId)` from `ai_defaults.scope='plugin'`.
- Each call is logged in the AI audit log with the plugin id.
- Per-plugin quota enforced by `server/ai/audit/quota.ts` — caps daily and monthly token spend per plugin.
- Plugin tools execute **inside the sandbox** via the existing api-call protocol — no new sandbox break-out.

Bridge handler: `server/plugins/host/handlers/ai.ts` translating `ai.complete` and `ai.stream` api-calls to the runtime.

---

## Per-surface integration

Every surface follows the same shape:

1. Mount `<AiAssistantDrawer scope="...">` somewhere in the workspace.
2. Drawer hosts a `<ConversationSidebar>` (newest non-deleted conversations for this user + scope), a `<ModelPicker>` in the header, a message list, and an input.
3. Workspace registers a **browser bridge** that handles write tools for its scope (write tools mutate the workspace's live store, not the DB directly).
4. Workspace registers a **context builder** that produces the per-request snapshot the server attaches to the system prompt.

Independent message histories: each scope has its own slice instance keyed by `scope`. Selecting a different scope shows a different list of conversations; nothing crosses over.

### Site editor

- `src/admin/pages/site/agent/agentSlice.ts` is **deleted**. The Site editor mounts `<AiAssistantDrawer scope="site" />`.
- `src/admin/pages/site/agent/executor.ts` keeps its role: the **browser bridge dispatcher** for site write tools. Renamed to `siteBridge.ts` and registered with the drawer for `scope: 'site'`.
- `renderEvidence.ts` and `pageContext.ts` (renamed from `agentSlice.ts`'s `buildPageContext`) build the page snapshot, attached to the chat request and stored as `context_json` on the conversation row.
- System prompt unchanged, moved to `server/ai/tools/instatic/systemPrompt.ts`.
- Conversation sidebar shows the user's recent site-editor chats; opening one re-attaches the snapshot it was created with (so the agent can still reason about that page even if the user navigated elsewhere).

### Content workspace ✅ shipped

- `ContentSidebar` gains an "AI assistant" rail button (third button alongside Content + Media; lilac accent, `AiSettingsSolidIcon` — matches the site editor's rail). Clicking it docks the AgentPanel into the same sidebar slot the content + media panels share.
- Toolset (15 tools, all under `server/ai/tools/content/`):
  - Read: `list_collections`, `get_collection_schema`, `list_documents`, `get_document`, `search_documents`, `list_users`, `list_media`
  - Write (browser-bridged): `create_document`, `delete_document`, `set_document_status`, `set_document_field`, `set_document_fields`, `set_document_author`, `set_active_document`, `set_active_collection`
- **Auto-mutate, not Accept/Reject.** Decision shift from the original spec: the agent mutates the live draft state directly via the existing `useContentEntryDraft` setters. User sees changes immediately in the editor; undo lives in the workspace's normal save/publish flow rather than in a per-tool confirmation. The original "rewrite / summarise / translate" assist tools collapse into prompt-driven editing via `get_document` + `set_document_field` — no separate assist surface.
- Body field is exchanged as **markdown** in both directions. The existing `@core/markdown/markdownDocument.ts` round-trips between markdown strings and TipTap JSON; the agent never sees ProseMirror node trees.
- Snapshot includes the active document's id + tableId + status + every field value + the collection's field schema (with select options, media kind, relation targets), plus a light list of every postType/page collection (id, slug, label, kind, docCount).
- Honest limits documented in the bridge: custom fields not yet writable (only built-ins flow through the draft); scheduled publishing rejected; field writes require the doc to be active.

### Data workspace

- Same drawer pattern.
- Toolset:
  - read: `list_tables`, `get_table_schema`, `query_rows`
  - write (structural): `createTable`, `renameTable`, `addColumn`, `dropColumn`, `dropTable`
  - write (rows): `insertRow`, `updateRow`, `deleteRow`
  - generate: `generateRows` — pass a table id + count + style hints; the model invents N rows respecting the schema and inserts them.
- Destructive ops (`dropTable`, `dropColumn`) gated by step-up auth.

### Plugin SDK

- Plugin authors call `api.ai.complete()` / `api.ai.stream()`.
- The plugin's tools are sandboxed inside QuickJS; the host runtime never sees plugin tool handlers — it just sees the tool envelopes and proxies back via the existing protocol bridge.
- A plugin author can ship its own AI-powered features (auto-tag content, generate alt text, draft posts) without ever touching API keys.

---

## Wire protocol (delta from today)

The existing `ServerStreamEvent` becomes `AiStreamEvent`. Three new variants:

- `usage` — emitted on stream close with token counts (drivers report; runtime forwards).
- `toolResult` — for server-resolved tools, so the UI can show success/failure inline without inferring from `toolStatus`.
- The discriminated `toolStatus` variant is removed — replaced by paired `toolCall` (status: pending) + `toolResult` (ok/err). Cleaner; symmetric for read and write tools.

The browser-bridged `toolRequest`/`tool-result` POST cycle is unchanged in shape.

---

## System prompts

Each scope has its own system prompt under `server/ai/tools/<scope>/systemPrompt.ts`. The current site-editor prompt at `src/admin/pages/site/agent/systemPrompt.ts:34` moves into `server/ai/tools/instatic/systemPrompt.ts` unchanged.

The runtime takes a `systemPrompt: string[]` (with `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` separator) and the Anthropic driver applies `cache_control` to the prefix. Other drivers concatenate.

---

## No-credential UX

When the user opens a chat surface and `GET /admin/api/ai/credentials` returns an empty list, the drawer renders:

- `<NoCredentialBanner>` at the top of the message area with copy: "No AI provider configured. Set one up to start chatting."
- A button **"Go to AI settings"** that routes to `/admin/ai/providers`.
- The model picker is disabled and shows "No provider".
- The input is enabled but the **Send button is disabled** with a tooltip "Configure an AI provider first".

If credentials exist but the current `(scope)` default points at a credential whose `keyFingerprint` mismatches the live master key, the banner becomes "Your credential needs to be re-entered after a master-key rotation. Open settings". Selecting any other valid credential from the picker dismisses the banner.

Once a credential is configured, the banner disappears for that surface immediately (no reload).

## Pricing and cost tracking

A hard-coded table at `server/ai/pricing.ts`:

```ts
export interface ModelPricing {
  providerId: AiProviderId
  modelId: string
  inputPer1MUsd: number
  outputPer1MUsd: number
  cacheReadPer1MUsd?: number   // Anthropic cache read pricing
  cacheWritePer1MUsd?: number  // Anthropic cache write pricing
}

export const MODEL_PRICING: ModelPricing[] = [
  { providerId: 'anthropic', modelId: 'claude-sonnet-4-7', inputPer1MUsd: 3.00, outputPer1MUsd: 15.00, cacheReadPer1MUsd: 0.30, cacheWritePer1MUsd: 3.75 },
  // ... ~10-15 entries
]

export function calculateCost(usage: AiUsage, providerId: AiProviderId, modelId: string): number { /* ... */ }
```

- Updated by hand when providers change pricing. Wrong prices are an annoyance, not a correctness bug — the source of truth is the provider invoice.
- Unknown `(providerId, modelId)` returns `0` cost. Token counts are still stored on the message + conversation row.
- The driver emits `{ type: 'usage', promptTokens, completionTokens }`; the handler computes cost via `calculateCost()` and persists on the message row.
- Daily rollup view computed at query time from `ai_messages` — no separate rollup table in v1.

## Audit and cost tracking

A new `audit_events` event type family `ai.*`:

| event                       | recorded when                                              |
|-----------------------------|------------------------------------------------------------|
| `ai.credential.created`     | POST /admin/api/ai/credentials succeeds                    |
| `ai.credential.updated`     | PUT /admin/api/ai/credentials/:id succeeds                 |
| `ai.credential.deleted`     | DELETE /admin/api/ai/credentials/:id succeeds              |
| `ai.credential.tested`      | POST /admin/api/ai/credentials/:id/test                    |
| `ai.chat.started`           | First `bridgeReady` event of a chat                        |
| `ai.chat.completed`         | Stream `done` — payload includes tokens + costUsd          |
| `ai.tool.called`            | Every tool call (read + write) — payload has tool name     |
| `ai.plugin.invoked`         | api.ai.complete / api.ai.stream from a plugin              |
| `ai.quota.exceeded`         | Per-plugin or per-user quota hit                            |

The Audit page `/admin/ai/audit` reads these and renders three views: by user, by surface, by plugin. Costs aggregate by day.

Token-cost calculation: hard-coded per-model price table (`server/ai/pricing.ts`) updated by hand. Wrong prices are an annoyance, not a correctness bug — the source of truth is the provider invoice.

---

## Architecture gate tests

New gates added under `src/__tests__/architecture/`:

| Test                                        | Enforces                                                                |
|---------------------------------------------|-------------------------------------------------------------------------|
| `ai-driver-isolation.test.ts`               | Provider SDKs imported only from their respective `drivers/<id>.ts`     |
| `ai-credentials-never-leak.test.ts`         | No handler returns `ciphertext`/`iv`/plaintext over HTTP — only `CredentialView` |
| `ai-tools-typebox-only.test.ts`             | Every file under `server/ai/tools/**` defines schemas with TypeBox (no Zod) |
| `ai-runtime-no-sdk-imports.test.ts`         | `server/ai/runtime/**` imports no provider SDK                          |
| `ai-handlers-capability-gated.test.ts`      | Every `server/ai/handlers/**` handler calls `requireCapability(...)`    |
| `ai-no-direct-agent-imports.test.ts`        | No code outside `src/admin/ai/` imports the old `agentSlice`/`agentConfig` (catches drift during migration) |

The deleted `no-anthropic-sdk.test.ts` is replaced by `ai-driver-isolation.test.ts`.

Existing relevant gates (`task381-agent-panel-tab.test.ts`, `task390-agent-config.test.ts`, `agent-endpoint-auth.test.ts`, `agent-sdk-integration.test.ts`) are updated or replaced to point at the new module paths.

---

## Phased rollout

Each phase is independently shippable and leaves the app in a runnable state.

### Phase 1 — Runtime + drivers + credential + conversation stores (no UI) ✅ shipped

- Implemented `server/ai/runtime/`, `server/ai/drivers/` (anthropic apiKey-only, openai apiKey-only, openrouter apiKey-only, ollama baseUrl), `server/ai/credentials/`, `server/ai/conversations/`, `server/ai/tools/site/` (24 tools).
- Migration `007_ai_runtime` (4 tables) added to both `migrations-pg.ts` and `migrations-sqlite.ts` with identical IDs. Provider constraint updated in-place to include `'openrouter'`.
- `loadMasterKey` + env var (`INSTATIC_SECRET_KEY`) + dev-mode `.tmp/secret.key` fallback.
- Conversation purge job registered with the scheduler tick: hard-deletes `deleted_at < now() - 30d` nightly.
- Architecture gates: `ai-driver-isolation.test.ts`, `ai-credentials-never-leak.test.ts`, `ai-tools-typebox-only.test.ts`, `ai-handlers-capability-gated.test.ts`.

### Phase 2 — Settings UI + capability + credentials handlers ✅ shipped

- Capabilities `ai.use`, `ai.providers.manage`, `ai.audit.read` added to the catalog and granted to Owner/Admin built-in roles.
- Top-level admin route `/admin/ai` with three tabs: **Providers** (credential CRUD, two-column dialog), **Defaults** (per-scope `(credentialId, modelId)`), **Audit** (placeholder until Phase 6).
- Credential handlers: list, create, update, delete, test.
- Auth-mode is derived from `providerId` — UI does not expose a separate picker (Anthropic/OpenAI/OpenRouter = `apiKey`; Ollama = `baseUrl`).
- `AdminEntry` sidebar gains the AI nav entry (gated by `ai.providers.manage`).

### Phase 3 — Rewire site editor to the new stack + conversation history ✅ shipped

- `src/admin/pages/site/agent/agentSlice.ts` rewritten to POST `/admin/api/ai/chat/site` against the new transport; old `/admin/api/agent[/tool-result]` deleted.
- Per-conversation persistence wired end-to-end: site editor messages survive reload, can be renamed/deleted from `<ConversationHistory>`.
- `<ModelPicker>` and `<ConversationHistory>` built on the shared `ContextMenu` primitive (same dropdown chrome as the rest of the admin).
- `<NoCredentialBanner>` shown inside the panel when the user has zero credentials.
- Replaced architecture gates: `no-anthropic-sdk.test.ts`, `agent-sdk-integration.test.ts`, `task381-agent-panel-tab.test.ts`, `task390-agent-config.test.ts` → `ai-driver-isolation.test.ts` + the new credential/tool/handler gates listed above.

### Phase 4 — Content + Data workspaces

#### Content workspace ✅ shipped

- `server/ai/tools/content/` — 15 tools (7 read + 8 write):
  - **Read**: `list_collections`, `get_collection_schema`, `list_documents`, `get_document`, `search_documents`, `list_users`, `list_media`. All server-resolved against the existing `data` repositories with compact agent-friendly projections.
  - **Write** (browser-bridged): `create_document`, `delete_document`, `set_document_status`, `set_document_field`, `set_document_fields`, `set_document_author`, `set_active_document`, `set_active_collection`. Body field exchanged as markdown — TipTap conversion via the existing `@core/markdown/markdownDocument.ts` round-trips on read/write.
- `server/ai/tools/content/snapshot.ts` + `systemPrompt.ts` — `ContentSnapshot` shape (collections, active doc with fields + schema, current user) + scope system prompt.
- Browser bridge: `src/admin/pages/content/agent/contentBridgeHandle.ts` (module-level imperative handle registry) + `contentBridge.ts` (TypeBox-validated dispatcher mapping the 8 write tool names to handle methods).
- Per-mount Zustand store (`contentAgentStore.ts`) composing the same `createAgentSlice(config)` factory as the site editor with `scope: 'content'` + `dispatchTool: executeContentTool`. The slice's site-editor return type is cast into the slice-only store shape (runtime-safe because the slice only touches AgentSlice keys).
- `ContentAgentMount` registers the bridge handle with refs (so methods always see live workspace + draft state without re-registration each render) and renders `<AgentPanel variant="docked">` wrapped in `<AgentStoreProvider>`.
- `ContentSidebar` gains a third rail button ("AI assistant", lilac, `AiSettingsSolidIcon`) + an `agentPanel: ReactNode` slot mounted alongside the existing content + media panels. Same docked variant the site editor uses.
- An `isVisible` prop on `ContentAgentMount` syncs the sidebar's `activePanel === 'agent'` into the store's `isAgentOpen` flag so the panel actually renders when the rail tab is active.
- **Honest limits** surfaced as bridge errors (the agent retries on errors per the system prompt):
  - Custom (non-built-in) fields aren't writable yet — only `title`, `slug`, `body`, `featuredMedia`, `seoTitle`, `seoDescription` flow through the draft state. Custom-field setters in `useContentEntryDraft` are a follow-up.
  - Scheduled publishing rejected with a "use the schedule dialog" message.
  - Field writes require the doc to be active — agent calls `set_active_document` first per the prompt; otherwise the bridge throws a clear error.

#### Data workspace — not yet built

- Define `server/ai/tools/data/` toolset (table/row CRUD + `generateRows`).
- Mount the docked AgentPanel in the Data workspace sidebar following the same pattern.

Decision parked in earlier session: the canonical "assist" tools the original plan listed (`rewrite` / `summarise` / `translate`) are intentionally **not** part of Phase 4 — they collapse into prompt-driven editing via the basic `get_document` + `set_document_field` pair, removing tool sprawl.

### Phase 5 — Plugin SDK `ai.invoke`

- New capability + builder method.
- Sandbox bridge handler at `server/plugins/host/handlers/ai.ts`.
- Per-plugin quota enforcement.
- Example plugin at `examples/plugins/ai-assist-tagging/`.

Deliverable: a plugin can call the host AI model.

### Phase 6 — Cost meter + audit visibility ✅ shipped

- `server/ai/pricing.ts` — hard-coded `(providerId, modelId)` → per-million-token rates. Anthropic + OpenAI tiers covered; Ollama omitted (self-hosted, no per-call cost). The persister falls back to `calculateCostUsd()` whenever the driver omits `costUsd` (OpenAI today; Ollama once it ships).
- `ai.*` audit events: `ai.credential.{created,updated,deleted,tested}`, `ai.default.updated`, `ai.chat.{started,completed,failed}`. Per-chat metadata carries scope + provider + model + token + cost deltas.
- `server/ai/audit/store.ts` — read-only repository over `ai_messages` + `ai_conversations` returning four rollups: `getUsageTotals`, `getUsageByUser`, `getUsageByScope`, `getUsageByDay`.
- `GET /admin/api/ai/audit?since=ISO` — capability-gated by `ai.audit.read`; returns `{ since, totals, byUser, byScope, byDay }`.
- `/admin/ai` Audit tab — Today / 7d / 30d / All range picker; totals strip (spend, chats, input tokens, output tokens); top-users + by-surface tables; daily-spend bar list.
- Dashboard widget `ai-usage` — "AI usage this month" headline + chats + top scope + daily-cost Sparkline. Gracefully no-ops on missing `ai.audit.read` capability.

---

## Migration of existing data

Pre-rewrite there was no AI-related persistent state to migrate (no DB rows, no localStorage beyond ephemeral chat messages that didn't survive reload). What actually shipped:

- **DB**: clean adds via migration `007_ai_runtime`. Migration `008_ai_drop_ambient_credentials` removes any stray ambient rows from early dev iterations.
- **localStorage**: ephemeral message state replaced by DB persistence. Any leftover localStorage chat data is silently dropped on first load of the new UI.
- **Constraint #385** (ambient-only auth) is removed from `docs/features/agent.md` and from `CLAUDE.md`. The "ban `@anthropic-ai/sdk`" rule is rewritten as "the SDK is imported only inside `server/ai/drivers/anthropic.ts` and `server/ai/drivers/anthropicStream.ts`".

---

## Security model

| Concern                                     | Mitigation                                                                |
|---------------------------------------------|---------------------------------------------------------------------------|
| Plaintext API keys leaked to browser        | API never serialises `ciphertext`/`iv`/plaintext; gated by `ai-credentials-never-leak.test.ts` |
| Plaintext API keys leaked to logs           | Encryption boundary in `credentials/store.ts` — plaintext lives only inside the driver call frame |
| Master key lost                             | Documented in deployment docs; rotation = re-enter every key (Phase 1 simplicity)            |
| CSRF on chat endpoint                       | `originAllowed()` gate + capability requirement (same as today's `/admin/api/agent`)         |
| Cross-user credential access                | All credential queries filter by `user_id = currentUser.id`                                  |
| Destructive AI actions bypass step-up       | Same `requireStepUp` gates apply — tools call the same store actions humans do               |
| Prompt injection causing unintended tools   | Tool schemas validate input at the boundary; write tools that mutate require user-explicit prompts (no surprise tools fire on a "summarise" request because their scope isn't exposed) |
| Plugin abusing AI quota                     | Per-plugin daily/monthly token cap enforced in `server/ai/audit/quota.ts`                    |
| Side-channel via render_snapshot            | Same as today — bridged to browser, capability-gated                                         |

---

## Locked decisions

1. **Per-user keys.** Each admin sets their own. `ai_provider_credentials.user_id` is mandatory; spend bills to the user who initiated the call. A future "shared pool" option can be layered on top without schema breaks.
2. **Top-level `/admin/ai` workspace.** Sibling of Plugins/Users. Three tabs: Providers, Defaults, Audit.
3. **One driver, one auth mode per provider.** Anthropic = `apiKey` only, direct `POST https://api.anthropic.com/v1/messages` (no SDK — `@anthropic-ai/claude-agent-sdk` removed; `anthropicStream.ts` deleted; shared `server/ai/drivers/http/` layer owns SSE and the tool loop). OpenAI = `apiKey` only via `@openai/agents`. OpenRouter = `apiKey` only via `@openrouter/agent` (live model catalog; native USD cost per call). Ollama = `baseUrl` (+ optional bearer) via plain `fetch`. The plain `@anthropic-ai/sdk` stays banned repo-wide.
4. **Multiple credentials per provider.** Each row is one `(provider, label)` pair. A user can hold "Anthropic (prod key)" + "Anthropic (personal key)" simultaneously and choose at chat time. Auth mode is implied by provider, not a separate axis.
5. **Persistent conversations.** `ai_conversations` + `ai_messages` tables, per user + per scope. Each scope has its own independent message history; nothing crosses over.
6. **Soft-delete retention.** Conversations stay until user-deletion. A nightly job hard-purges rows where `deleted_at` is older than 30 days. No per-site retention setting.
7. **No-credentials UX.** Banner inside the chat panel with a "Go to AI settings" button; Send disabled until at least one credential exists.
8. **OpenAI Agents SDK.** Use `@openai/agents` (higher-level). Driver wraps `AiTool` definitions with handlers that route through our browser bridge for write tools.
9. **Hard-coded price table.** `server/ai/pricing.ts` updated by hand. Token counts always stored; cost is best-effort. Exception: the OpenRouter driver emits native USD cost from the provider, so OpenRouter calls never fall back to the table.
10. **Shared dropdown primitive for in-panel pickers.** `<ModelPicker>` and `<ConversationHistory>` are built on `ContextMenu` (auto-flip, click-outside, focus management) — no bespoke popovers.

---

## Files that disappeared (Phases 1–3)

- `server/handlers/agent/*` (entire directory) → `server/ai/handlers/{chat,toolResult,credentials,conversations,defaults,models}.ts`
- Old `server/handlers/agent/tools.ts` → tool definitions are now under `server/ai/tools/site/` (TypeBox); Zod adapter logic isolated in `server/ai/drivers/typeboxToZod.ts`.
- Old client transport (`agentConfig.ts`, hand-rolled NDJSON) → `src/admin/ai/api.ts` + the rewritten `src/admin/pages/site/agent/agentSlice.ts`.
- Architecture tests deleted: `no-anthropic-sdk.test.ts`, `agent-sdk-integration.test.ts`, `task381-agent-panel-tab.test.ts`, `task390-agent-config.test.ts`, plus the older agent-endpoint-auth gate. Replaced by `ai-driver-isolation.test.ts`, `ai-credentials-never-leak.test.ts`, `ai-tools-typebox-only.test.ts`, `ai-handlers-capability-gated.test.ts`.
- Docs: `docs/features/agent.md` updated to describe the runtime; Constraint #385 removed; `CLAUDE.md`'s ban on `@anthropic-ai/sdk` covers the whole repo. `server/ai/drivers/anthropicStream.ts` was later deleted in the direct-HTTP rewrite (commit 59b0ebdfb655) — its SSE translation logic now lives in `AnthropicTurnTranslator` inside `anthropic.ts`.

---

## What this plan does NOT solve

- Streaming media generation (image/audio). A future plan.
- A "Claude Skills" mechanism in our app (orthogonal — skills are a Claude Code CLI feature today, not a generic LLM concept).
- A way for non-admins to use AI. Member role gets no `ai.use` capability; a future plan can introduce a `pages.suggest` or similar limited-scope permission for editorial workflows.
- Federated identity (SSO) for the providers themselves (e.g. "log in to Anthropic with OAuth"). Out of scope; BYO-key only.
- A general-purpose Cmd+K AI mode. The user did not select Spotlight; revisit after Phase 4 if usage patterns suggest it.

---

## Related

- `docs/features/agent.md` — current AI agent (to be rewritten in Phase 3)
- `docs/features/plugin-system.md` — plugin SDK surface (Phase 5 adds the `ai.invoke` permission)
- `docs/features/auth-and-access.md` — capability gating; step-up; CSRF
- `docs/features/audit-log.md` — audit events catalog (Phase 6 adds `ai.*` family)
- `docs/reference/database-dialects.md` — dialect parity rules for migrations
- `docs/reference/typebox-patterns.md` — boundary validation patterns
- `docs/reference/capabilities.md` — capability matrix (Phase 2 adds three entries)
- Source-of-truth files (post-rewrite):
  - `server/ai/handlers/chat.ts` — `/admin/api/ai/chat/:scope` entrypoint
  - `server/ai/tools/site/` — site-editor tool registry (TypeBox)
  - `server/ai/drivers/{anthropic,openai,openrouter,ollama}.ts` — provider drivers
  - `server/ai/credentials/{store,encryption,masterKey}.ts` — credential persistence
  - `src/admin/pages/ai/` — admin AI workspace (Providers / Defaults / Audit)
  - `src/admin/pages/site/agent/agentSlice.ts` — site editor client slice
  - `src/admin/pages/site/panels/AgentPanel/` — chat panel + ModelPicker + ConversationHistory
  - `src/core/plugin-sdk/capabilities.ts` — capability catalog
  - `server/db/migrations-{pg,sqlite}.ts` — migrations 007 (initial) + 008 (drop ambient)
