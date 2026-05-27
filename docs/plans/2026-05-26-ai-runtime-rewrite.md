# AI Runtime Rewrite — Provider-Agnostic, Multi-Surface, BYO-Key

A plan to take the current single-provider, single-surface Claude Agent SDK integration and turn it into a **provider-agnostic AI runtime** wired into the Site editor, Content workspace, Data workspace, and the Plugin SDK, with **encrypted per-user API key storage** and a **model picker** in every chat surface.

---

## TL;DR

- One canonical **AI runtime** (`server/ai/`) replaces the bespoke `server/handlers/agent/*` stack.
- Three **provider drivers** behind an `AiProvider` interface: `anthropic`, `openai`, `ollama`. Each driver supports multiple **auth modes** (`ambient` / `apiKey` / `baseUrl`) — picked per credential row at setup time. **Each provider uses exactly one SDK** regardless of auth mode; the auth mode only changes whether the driver passes a key per call or lets the SDK pick up ambient credentials.
  - Anthropic: `@anthropic-ai/claude-agent-sdk`. Ambient = SDK uses Claude Code OAuth from `claude auth login` (Pro/Max/Team subscription billing). apiKey = driver injects the user's `ANTHROPIC_API_KEY` per call.
  - OpenAI: `@openai/agents`. Ambient = SDK reads `OPENAI_API_KEY` env var. apiKey = driver constructs a client with the user's key per call.
  - Ollama: no SDK, plain `fetch` against any OpenAI-compatible local endpoint. `baseUrl` mode (+ optional bearer key).
- One **tool registry** (`server/ai/tools/`) defined with TypeBox; drivers translate to their SDK's native shape (Anthropic gets a thin Zod wrapper required by the Claude Agent SDK's `tool()` API; OpenAI gets JSON Schema; Ollama gets the same JSON Schema).
- **Encrypted credential store** (`ai_provider_credentials` table) — AES-256-GCM via Bun's `crypto.subtle`, master key from env var `PAGE_BUILDER_SECRET_KEY`. Multiple rows per provider allowed (different keys for different purposes). Plaintext never crosses the wire.
- **Persistent conversations**: new tables `ai_conversations` + `ai_messages`, scoped per user + per surface. Soft-delete with a nightly job that hard-purges rows older than 30 days. Conversations survive reload and device-switching.
- **Four AI surfaces** with scoped toolsets and **independent message histories**: Site editor (existing 22 tools, rewired), Content (post/page CRUD + rewrite/summarise/translate), Data (table/row CRUD + schema generation + synthetic rows), Plugin SDK (`api.ai.complete` / `api.ai.stream` behind an `ai.invoke` permission).
- **Model picker** in every chat: `(providerId, credentialId, modelId)` persisted per-surface. Defaults sourced from site-wide config with per-user override.
- **New capabilities**: `ai.providers.manage` (set keys + site defaults), `ai.use` (invoke any AI surface, read own conversations), `ai.audit.read` (see all-user usage log).
- **No-credential UX**: banner inside the chat panel with a "Set up a provider" deep-link to `/admin/ai/providers`; Send button disabled until at least one credential exists.
- **Cost tracking via hard-coded price table** (`server/ai/pricing.ts`) updated by hand when providers change pricing. Token counts always stored; cost rolls up daily.
- **Six-phase rollout**. The first phase delivers the runtime + drivers + credential + conversation stores without touching any UI; the last phase delivers cost rollups + audit visibility.

---

## Why now / why this shape

The current implementation is rigid in three ways that block production:

1. **Single provider, single transport.** `server/handlers/agent/index.ts:24` imports `@anthropic-ai/claude-agent-sdk` directly. Switching providers means rewriting the handler. There is no abstraction.
2. **Ambient auth only.** Constraint #385 (`docs/features/agent.md:18`) bans API-key config and relies on `claude auth login` on the host. That's fine for dev; it's a non-starter for hosted/self-hosted users who don't run a Claude Code CLI on the server.
3. **One surface, hardcoded.** The agent is wired into `src/admin/pages/site/agent/` only. Content writers, data editors, and plugin authors can't reach it.

This plan addresses all three at once because they share the same blocking dependency: **the lack of a stable AI runtime layer**. Doing them separately would mean writing the runtime three times.

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

## Current state (one-screen summary)

```text
server/handlers/agent/
├── index.ts              POST /admin/api/agent + /tool-result, NDJSON stream
└── tools.ts              MCP server via createSdkMcpServer; 22 tools, Zod schemas

src/admin/pages/site/agent/
├── agentSlice.ts         Zustand slice; fetches /admin/api/agent; processes events
├── agentConfig.ts        AGENT_API_PATH constants
├── executor.ts           Bridges write tools → editor store mutations; TypeBox validated
├── renderEvidence.ts     Page snapshot + render_snapshot screenshot capture
├── systemPrompt.ts       Static prefix + dynamic suffix, cache-friendly
└── types.ts              AgentMessage, ServerStreamEvent, PageContext, ...

src/admin/pages/site/panels/AgentPanel/
├── AgentPanel.tsx        Chat UI (single surface, no model picker, no provider notion)
```

Auth: ambient Claude Code via SDK. No env vars, no DB rows, no UI.
Tools: 22 page-builder tools (8 read, 14 write). Defined via SDK's `tool()` + Zod.
Streaming: NDJSON over `ReadableStream`. Each line is a `ServerStreamEvent`.

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
│   │                       Anthropic SDK in the repo). 'ambient' = SDK reads
│   │                       Claude Code OAuth from the host (subscription
│   │                       billing); 'apiKey' = driver passes the user's key
│   │                       into the SDK options/env per call.
│   ├── openai.ts           Uses @openai/agents. 'ambient' = SDK reads
│   │                       OPENAI_API_KEY from process env; 'apiKey' = driver
│   │                       constructs a per-call client with the decrypted key.
│   ├── ollama.ts           Plain fetch against an OpenAI-compatible endpoint.
│   │                       authMode = 'baseUrl' (+ optional bearer key).
│   └── types.ts            AiProvider, AiAuthMode, AiProviderModel, AiResolvedCredential.
│
├── tools/
│   ├── index.ts            Tool registry + selectByScope() / selectByIds().
│   ├── types.ts            AiTool<TInput, TOutput> + ToolScope union.
│   ├── pageBuilder/        22 site-editor tools (replaces handlers/agent/tools.ts).
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
├── AiProvidersPage.tsx       /admin/ai/providers — credential CRUD; per-row
│                              auth-mode picker (ambient/apiKey/baseUrl).
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
export type AiAuthMode = 'ambient' | 'apiKey' | 'baseUrl'

export interface AiProvider {
  readonly id: AiProviderId
  readonly label: string
  readonly supportedAuthModes: AiAuthMode[]       // anthropic: [ambient, apiKey]
                                                   // openai:    [ambient, apiKey]
                                                   // ollama:    [baseUrl]
  capabilities(authMode: AiAuthMode): AiProviderCapabilities

  listModels(creds: AiResolvedCredential): Promise<AiProviderModel[]>

  stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent>
  // The driver owns the entire tool-loop with its SDK; it yields canonical
  // AiStreamEvents. When a tool needs the browser (a write tool), it yields
  // { type: 'toolRequest', ... } and awaits resolution from the transport
  // layer via a bridge promise — same mechanic as today's bridgeId/requestId.
  //
  // Inside Anthropic's stream(): switches on creds.authMode. 'ambient' goes
  // through @anthropic-ai/claude-agent-sdk (no key); 'apiKey' goes through
  // @anthropic-ai/sdk with the decrypted key.
}

export interface AiResolvedCredential {
  id: string                                       // ai_provider_credentials.id
  providerId: AiProviderId
  authMode: AiAuthMode
  apiKey: string | null                            // null when authMode='ambient'
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
  ciphertext bytea,                -- null when auth_mode='ambient'
  iv bytea,                        -- null when auth_mode='ambient'
  base_url text,                   -- set when auth_mode='baseUrl'
  key_fingerprint text,            -- null when auth_mode='ambient'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint ai_creds_provider_check
    check (provider_id in ('anthropic', 'openai', 'ollama')),
  constraint ai_creds_authmode_check
    check (auth_mode in ('ambient', 'apiKey', 'baseUrl')),
  constraint ai_creds_apikey_shape_check
    check (
      (auth_mode = 'ambient'  and ciphertext is null    and iv is null    and base_url is null) or
      (auth_mode = 'apiKey'   and ciphertext is not null and iv is not null and base_url is null) or
      (auth_mode = 'baseUrl'  and base_url is not null)
    )
);

create unique index ai_creds_user_label_idx
  on ai_provider_credentials (user_id, provider_id, display_label);
```

Notes:
- **Multiple credentials per provider** are allowed and expected — e.g. one user may have "Anthropic (ambient)", "Anthropic (production key)", and "Anthropic (personal key)" all at once, and pick one per chat.
- The constraint check enforces auth-mode-shape consistency at the DB layer.
- SQLite dialect mirrors with `text`/`blob` etc per `docs/reference/database-dialects.md`.
- `key_fingerprint` is `sha256(masterKey).slice(0, 16)`. On read, if the current master-key fingerprint mismatches the row's fingerprint, the credential is **flagged as needing re-entry** in the UI. Ambient rows have null fingerprint and are unaffected by rotation.

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
  const raw = process.env.PAGE_BUILDER_SECRET_KEY
  if (raw) return importMasterKeyFromBase64(raw)

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[ai/credentials] PAGE_BUILDER_SECRET_KEY is required in production. ' +
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

Each driver is a single file under `server/ai/drivers/<id>.ts`. Drivers are the **only** place provider SDKs are imported. An architecture gate test enforces this.

Each driver uses **one SDK** regardless of auth mode. Auth mode controls whether the driver provides credentials per-call or lets the SDK find them ambiently — not which SDK to use.

### `anthropic.ts` — one SDK, two auth modes

- Supported auth modes: `ambient`, `apiKey`.
- SDK: `@anthropic-ai/claude-agent-sdk` (same SDK as today's `server/handlers/agent/index.ts:24`).
- How auth mode flows through:
  - **`ambient`** → driver passes options unchanged; SDK reads Claude Code OAuth tokens from the host (subscription billing via `sk-ant-oat01-` tokens from `claude auth login`). This is the current behaviour, unchanged.
  - **`apiKey`** → driver passes `env: { ...process.env, ANTHROPIC_API_KEY: creds.apiKey }` in the SDK's `Options` for that single call. The SDK reads the env var and uses it as the `X-Api-Key` header. The user's key never leaks into the host's process env — only into the per-call scope the SDK manages.
- Tool format: registered via `createSdkMcpServer` + `tool()` from the SDK. This requires Zod (the SDK's `tool()` API takes `AnyZodRawShape`); the driver wraps each `AiTool.inputSchema` (TypeBox) with a thin TypeBox→Zod adapter. **The only legitimate Zod use in the repo**, kept inside this one driver file.
- Streaming: `query()` from the SDK yields `SdkMessage`s; driver normalises to canonical `AiStreamEvent` (port the existing logic from `server/handlers/agent/index.ts:193` `getServerStreamEventsFromSdkMessage`).
- Prompt cache: the SDK accepts `systemPrompt: string[]` with the `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` separator and applies `cache_control` to the prefix automatically — same mechanism as today.
- Vision: pass image blocks through.
- `listModels(creds)` calls the SDK to discover available models; behaves the same in both auth modes — the set may differ depending on what the active credential is entitled to.

### `openai.ts` — one SDK, two auth modes

- Supported auth modes: `ambient`, `apiKey`.
- SDK: `@openai/agents` (high-level Agents SDK).
- How auth mode flows through:
  - **`ambient`** → SDK reads `OPENAI_API_KEY` from `process.env` (the SDK's documented default). Returns a clear error if the env var is not set.
  - **`apiKey`** → driver constructs a per-call `AsyncOpenAI` client with the decrypted key and registers it via `setDefaultOpenAIClient()` for that call, or passes it directly into the `Runner` constructor (depending on which API surface the SDK ends up exposing in TS — exact call shape pinned during Phase 1 spike).
- Tool format: the Agents SDK accepts tool definitions with JSON Schema; driver converts each `AiTool.inputSchema` (TypeBox) to JSON Schema using TypeBox's built-in.
- Tool calling: Agents SDK runs the tool loop internally. The driver wraps each `AiTool` with a handler that either resolves server-side (read tools) or yields a `toolRequest` and awaits the browser bridge (write tools).
- Vision: image content blocks supported.

### `ollama.ts` — local OpenAI-compatible endpoint

- Supported auth modes: `baseUrl`.
- No SDK: plain `fetch` against `<creds.baseUrl>/v1/chat/completions`. Optional bearer key in `apiKey` field (used when the operator put Ollama behind a reverse proxy with auth).
- Tool format: OpenAI-compatible JSON Schema.
- Capability flags: `toolCalling: <model-dependent>`, `visionInput: <model-dependent>` — driver checks at `listModels()` time and tags each `AiProviderModel`. Older Ollama models lack tool-calling; UI greys them out in the picker when the active scope requires tools.

### Why no separate `claude-code` driver

The user-facing concept is **one provider per backend** (Anthropic, OpenAI, Ollama). Auth mode is a property of the credential, not of the provider. The Claude Agent SDK itself supports both subscription OAuth and API-key auth, so one driver file using one SDK covers both:

- Users see one "Anthropic" entry in the credential UI, with an auth-mode picker.
- The driver branches only on **what to put in the SDK call options** — not on which SDK to import.
- The migration story for current users: their existing ambient setup becomes an `ai_provider_credentials` row with `provider_id='anthropic'`, `auth_mode='ambient'`. On Phase 1 boot, if the row is missing, the system auto-creates it (one-time bootstrap) so the editor keeps working without manual setup.

### Driver isolation gate

A new architecture test `src/__tests__/architecture/ai-driver-isolation.test.ts`:

- `@anthropic-ai/claude-agent-sdk` may only be imported from `server/ai/drivers/anthropic.ts`.
- `@openai/agents` may only be imported from `server/ai/drivers/openai.ts`.
- `zod` may only be imported from `server/ai/drivers/anthropic.ts` (required by the SDK's `tool()` API). Replaces today's `server/handlers/agent/tools.ts` exemption.
- The plain `@anthropic-ai/sdk` package stays **completely banned everywhere** — the Agent SDK covers all our needs.
- The plain `openai` package stays banned everywhere outside the OpenAI driver — Agents SDK is the only entry point.
- The runtime, handlers, tools, and UI may import none of the above.

The existing `no-anthropic-sdk.test.ts` is folded into `ai-driver-isolation.test.ts`.

---

## Tool registry

Every tool defined once, in TypeBox, with explicit scope and execution mode.

```ts
// server/ai/tools/pageBuilder/insertNode.ts (example)

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
- System prompt unchanged, moved to `server/ai/tools/pageBuilder/systemPrompt.ts`.
- Conversation sidebar shows the user's recent site-editor chats; opening one re-attaches the snapshot it was created with (so the agent can still reason about that page even if the user navigated elsewhere).

### Content workspace

- Workspace gains a chat drawer toggle in the header (mirrors the site editor's Agent toggle).
- Toolset:
  - read: `list_posts`, `get_post`, `list_pages`, `get_page` (note: content "pages" are the post-typed pages, not visual-editor pages)
  - write: `createPost`, `updatePost`, `deletePost`, `setPostStatus`
  - assist (server-resolved, no DB mutation): `rewrite`, `summarise`, `translate` — these take a richtext blob + instruction and return the new text, which the workspace's editor inserts on user confirmation.
- The assist tools intentionally **don't auto-mutate** — they return text and the workspace UI shows a diff with Accept/Reject. This is the right pattern for editorial flow.

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

Each scope has its own system prompt under `server/ai/tools/<scope>/systemPrompt.ts`. The current site-editor prompt at `src/admin/pages/site/agent/systemPrompt.ts:34` moves into `server/ai/tools/pageBuilder/systemPrompt.ts` unchanged.

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

### Phase 1 — Runtime + drivers + credential + conversation stores (no UI)

- Implement `server/ai/runtime/`, `server/ai/drivers/` (anthropic with both branches, openai, ollama), `server/ai/credentials/`, `server/ai/conversations/`, `server/ai/tools/` (port the 22 existing site tools).
- Migrations: `ai_provider_credentials`, `ai_defaults`, `ai_conversations`, `ai_messages` — same IDs in both PG and SQLite dialect files.
- `loadMasterKey` + env var bootstrap + dev-mode key generation script.
- New handler: `POST /admin/api/ai/chat/site` (mirrors current `/admin/api/agent`) — internally creates an `ai_conversations` row + persists messages as the stream runs.
- Conversation purge job registered with the scheduler tick: hard-deletes `deleted_at < now() - 30d` nightly.
- One-time boot bootstrap: if the current host is an upgrade from the old ambient-only setup and the owner has zero credential rows, auto-create an `anthropic` + `ambient` row so the editor keeps working without manual setup.
- Architecture gates land.
- Site editor still uses the old endpoint — no change to UI yet.

Deliverable: a `bun test` suite that exercises the runtime + each driver branch against a fake provider + the encrypted store + the conversation persistence + the purge job.

### Phase 2 — Settings UI + capability + credentials handlers

- New capabilities: `ai.use`, `ai.providers.manage`, `ai.audit.read`.
- New top-level admin route: `/admin/ai` workspace with three tabs:
  - **Providers** — credential CRUD; per-row auth-mode picker; test button.
  - **Defaults** — per-scope `(credentialId, modelId)` selection.
  - **Audit** — placeholder until Phase 6.
- Credentials handlers (5) + audit entries.
- Owner / Admin built-in roles get the three new permissions by default.
- `AdminEntry` sidebar gains the AI nav entry (gated by `ai.providers.manage`).

Deliverable: an operator can add an Anthropic key + an OpenAI key, see "test successful" on both, and set the site defaults per scope.

### Phase 3 — Rewire site editor to the new stack + conversation history

- Site editor's `agentSlice.ts` deleted. Replaced with `<AiAssistantDrawer scope="site" />` + `<ConversationSidebar scope="site" />`.
- Old `/admin/api/agent[/tool-result]` deleted. Frontend POSTs `/admin/api/ai/chat/site` and `/admin/api/ai/tool-result`.
- Conversation handlers (5) + sidebar UI.
- Model picker (and credential picker) in panel header — defaults to `ai_defaults['site']`.
- `<NoCredentialBanner>` integration.
- Delete `no-anthropic-sdk.test.ts`, `agent-sdk-integration.test.ts`, `task381-agent-panel-tab.test.ts`, `task390-agent-config.test.ts`; replaced by `ai-driver-isolation.test.ts` + `ai-no-direct-agent-imports.test.ts`.

Deliverable: site editor behaves identically, plus: chats survive reload, can be renamed/deleted, and are listed in a sidebar.

### Phase 4 — Content + Data workspaces

- Define `server/ai/tools/content/` and `server/ai/tools/data/` toolsets.
- Mount `<AiAssistantDrawer>` in Content and Data workspaces.
- Implement `rewrite` / `summarise` / `translate` server-side tools.
- Implement `generateRows` server-side tool.

Deliverable: AI assistant in three workspaces.

### Phase 5 — Plugin SDK `ai.invoke`

- New capability + builder method.
- Sandbox bridge handler at `server/plugins/host/handlers/ai.ts`.
- Per-plugin quota enforcement.
- Example plugin at `examples/plugins/ai-assist-tagging/`.

Deliverable: a plugin can call the host AI model.

### Phase 6 — Cost meter + audit visibility

- `ai.*` audit events landing throughout.
- `/admin/ai/audit` page with three views (by user, by surface, by plugin).
- Daily/monthly cost rollups.
- Dashboard widget: "AI usage this month".

Deliverable: operators can see spend and per-user activity.

---

## Migration of existing data

There is no AI-related persistent state today (no DB rows, no localStorage beyond ephemeral chat messages that don't survive reload). So:

- **DB**: clean adds, no migration of old rows. The Phase 1 boot bootstrap adds a single ambient `anthropic` credential row for the owner so existing dev setups keep working without a manual UI step.
- **localStorage**: ephemeral message state is replaced by DB persistence. Any leftover localStorage chat data is silently dropped on first load of the new UI.
- **Constraint #385** (ambient-only auth) is removed from `docs/features/agent.md` and from `CLAUDE.md` (the explicit "ban `@anthropic-ai/sdk`" rule moves to "only inside `server/ai/drivers/anthropic.ts`").

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

These were the open questions resolved before Phase 1 begins:

1. **Per-user keys.** Each admin sets their own. `ai_provider_credentials.user_id` is mandatory; spend bills to the user who initiated the call. A future "shared pool" option can be layered on top without schema breaks.
2. **Top-level `/admin/ai` workspace.** Sibling of Plugins/Users. Three tabs: Providers, Defaults, Audit.
3. **One Anthropic driver, one SDK, two auth modes.** No separate `claude-code` driver, no second SDK. The driver uses `@anthropic-ai/claude-agent-sdk` for both modes; the auth-mode picker only controls whether the driver injects `ANTHROPIC_API_KEY` per call (`apiKey`) or lets the SDK use ambient OAuth (`ambient`). The plain `@anthropic-ai/sdk` stays banned repo-wide.
4. **Multiple credentials per provider.** Each row is one `(provider, authMode, label)` triple. A user can hold "Anthropic (ambient)" + "Anthropic (prod key)" + "Anthropic (personal key)" simultaneously and choose at chat time.
5. **Persistent conversations.** New `ai_conversations` + `ai_messages` tables, per user + per scope. Each scope has its own independent message history; nothing crosses over.
6. **Soft-delete retention.** Conversations stay until user-deletion. A nightly job hard-purges rows where `deleted_at` is older than 30 days. No per-site retention setting.
7. **No-credentials UX.** Banner inside the chat panel with a "Go to AI settings" button; Send disabled until at least one credential exists.
8. **OpenAI Agents SDK.** Use `@openai/agents` (higher-level). One SDK handles both ambient (env) and apiKey modes. Driver wraps `AiTool` definitions with handlers that route through our browser bridge for write tools.
9. **Hard-coded price table.** `server/ai/pricing.ts` updated by hand. Token counts always stored; cost is best-effort.

The only outstanding implementation detail is the **model picker grouping** — it should group by provider with capability badges (vision, tools, cache), but the exact layout is a Phase 3 UI decision and doesn't need to be locked here.

---

## Files that disappear

- `server/handlers/agent/index.ts` → `server/ai/handlers/chat.ts` + `toolResult.ts`
- `server/handlers/agent/tools.ts` → split: tool definitions into `server/ai/tools/pageBuilder/*` (TypeBox), MCP-wrapping + Zod adapter logic into `server/ai/drivers/anthropic.ts`.
- `src/admin/pages/site/agent/agentSlice.ts` → composes into `src/admin/ai/AiAssistantSlice.ts`
- `src/admin/pages/site/agent/agentConfig.ts` → replaced by `src/admin/ai/transport.ts`
- `src/admin/pages/site/agent/executor.ts` → `src/admin/pages/site/agent/siteBridge.ts` (kept; renamed; same behaviour)
- Architecture tests: `no-anthropic-sdk.test.ts`, `agent-sdk-integration.test.ts`, `task381-agent-panel-tab.test.ts`, `task390-agent-config.test.ts` → replaced by `ai-driver-isolation.test.ts` + `ai-no-direct-agent-imports.test.ts`
- Docs: `docs/features/agent.md` is rewritten in Phase 3 to describe the new runtime; Constraint #385 is removed; `CLAUDE.md`'s ban on `@anthropic-ai/sdk` is rewritten as "imports allowed only in `server/ai/drivers/anthropic.ts`".

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
- Source-of-truth files (today):
  - `server/handlers/agent/index.ts` — current endpoint
  - `server/handlers/agent/tools.ts` — current tool registry
  - `src/admin/pages/site/agent/` — current client implementation
  - `src/core/plugin-sdk/capabilities.ts` — capability catalog
  - `server/plugins/host/handlers/crypto.ts` — pattern for `crypto.subtle` usage
  - `server/db/migrations-{pg,sqlite}.ts` — where the new tables land
