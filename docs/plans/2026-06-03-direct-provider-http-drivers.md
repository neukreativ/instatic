# Direct provider HTTP/SSE drivers — research + implementation plan

**Status:** In progress — Phase 0 (shared `http/` scaffolding), Phase 1 (Anthropic direct HTTP driver), and Phase 4 (history replay + session machinery cleanup) shipped in commit 59b0ebdfb655. Phases 2 (OpenAI + OpenRouter), 3 (Ollama), and 5 (gate/deps/docs) remain.
**Date:** 2026-06-03
**Scope:** Replace the four AI-provider *SDKs* (`@anthropic-ai/claude-agent-sdk`, `@openai/agents`, `@openrouter/agent`, plus `@modelcontextprotocol/sdk` and `zod`) with hand-written HTTP/SSE drivers that talk directly to each provider's REST API. The runtime, handlers, tools, wire protocol, and UI are **unchanged**.

---

## 1. Executive summary

Instatic already has the right abstraction for this. Every provider SDK is confined to a single driver file behind the `AiProvider` interface (`server/ai/drivers/types.ts`), gated by `ai-driver-isolation.test.ts`. The runtime (`runtime/runner.ts`), the persister, the handlers, and the browser wire protocol (`AiStreamEvent` NDJSON) are all **provider-agnostic** and would not change.

The refactor is therefore **contained to `server/ai/drivers/`**, plus three small ripples (the chat handler must load full history, the dead "session resume" machinery gets deleted, and the gate test inverts). It removes the four largest server-side dependencies and `zod` entirely.

**The one premise that needs correcting:** the brief assumes *"Instatic already owns the tool loop."* It does **not**. Today the SDKs own the agentic loop — Anthropic via `query()`, OpenAI via `Runner.run()`, OpenRouter via `callModel()`. The real work of this refactor is **moving the tool loop into our own code** (inside each driver's `stream()` generator). That is very achievable — the `AiProvider.stream()` contract is already an async generator designed to host exactly such a loop, and the server/browser tool-execution mechanics already exist (`callTool` / `bridge.callBrowser`). But it must be scoped honestly: this is "build the loop," not just "swap the transport."

**Recommendation: do it.** It is high-value (removes ~900 MB+ of install footprint and `zod`), low **architectural** risk (the boundary already exists, and two in-repo templates already exist — see §4), and it fixes a latent correctness bug (OpenAI/OpenRouter currently don't replay multi-turn history at all — §3.2). The medium-risk surface is parity work: prompt-cache headers, usage/cost accounting, history mapping, and abort handling — all itemised in §9.

---

## 2. Current state — how the SDKs are used today

### 2.1 The abstraction (this is the good news)

```
handlers/chat.ts ──► runtime/runner.ts (runChat) ──► AiProvider.stream(req) ──► [SDK]
                          │                                  ▲
                          └─ persister (DB)                  └─ drivers/{anthropic,openai,openrouter,ollama}.ts
```

- `AiProvider` (`drivers/types.ts`) — `capabilities()`, `listModels()`, `stream(req): AsyncIterable<AiStreamEvent>`.
- `drivers/index.ts` — registry mapping `AiProviderId → AiProvider`.
- `runtime/runner.ts` — consumes **one** `driver.stream()` pass, forwards each canonical `AiStreamEvent` to the browser (NDJSON) and the persister (DB). **It does not loop.**
- `runtime/types.ts` — the canonical vocabulary: `AiMessage`, `AiTool`, `AiContentBlock`, `AiStreamEvent`, `AiBrowserBridge`. Provider-agnostic, NDJSON wire shape.

Nothing above the driver line knows which provider answered. That line is exactly where the SDK lives and exactly where the HTTP client will live. **No caller changes.**

### 2.2 Where each SDK actually sits

| Driver | SDK | What the SDK owns today |
|---|---|---|
| `anthropic.ts` | `@anthropic-ai/claude-agent-sdk` | `query()` runs the **full Claude-Code agent harness**: multi-turn tool loop, in-process MCP tool server (`createSdkMcpServer`), session transcript persistence + `resume`, built-in FS/shell tools (we *disable* them via `disallowedTools`), `skills`, `cwd`, `canUseTool`. |
| `openai.ts` | `@openai/agents` | `Runner.run(agent, input, {stream:true})` owns the loop + tool dispatch via `Agent`/`Runner`/`OpenAIProvider`. |
| `openrouter.ts` | `@openrouter/agent` | `callModel().getFullResponsesStream()` owns the loop; translates OpenAI-**Responses** events. |
| `ollama.ts` | *(none — `fetch` skeleton)* | **Not implemented.** Already a pure-`fetch` stub that documents the exact SSE approach this plan generalises. |

### 2.3 The "Agent SDK is more than this CMS needs" observation is correct

The Anthropic driver spends real code *suppressing* the Agent SDK's harness:

- `disallowedTools: ['Bash','Read','Write','Edit','Glob','Grep','NotebookEdit']` — disabling built-in agent tools we never want.
- `cwd: process.cwd()`, `skills: []`, `canUseTool: () => ({behavior:'allow'})` — harness knobs that are meaningless for a "chat that edits the live site" use case.
- Tools are wrapped as an **in-process MCP server** (`@modelcontextprotocol/sdk` `CallToolResult` shapes) purely because that is the SDK's tool-registration API.

A direct `POST /v1/messages` call has **no** built-in tools, no MCP layer, no cwd/skills — so all of that code *disappears* rather than being ported. The direct driver is smaller than the SDK driver it replaces.

### 2.4 Dependency-removability (verified by grep)

| Package | Imported only by | Removable after refactor? |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` | `drivers/anthropic.ts` | ✅ |
| `@openai/agents` | `drivers/openai.ts` | ✅ |
| `@openrouter/agent` | `drivers/openrouter.ts` | ✅ |
| `@modelcontextprotocol/sdk` | `drivers/anthropic.ts` only | ✅ (only used for MCP tool wrapping) |
| `zod` | `drivers/anthropic.ts`, `drivers/openrouter.ts`, `drivers/typeboxToZod.ts` | ✅ — TypeBox schemas *are* JSON Schema; the provider `tools`/`input_schema` fields take JSON Schema directly, so the TypeBox→Zod bridge is no longer needed and `typeboxToZod.ts` is deleted. |

`server/ai/tools/site/systemPrompt.ts` mentions `claude-agent-sdk` in a **comment only** (it mirrors a prompt literal); no import. Footprint figures from the brief (≈678 MB Anthropic, ≈208 MB OpenAI) are taken as given per scoping.

---

## 3. The one real semantic change: history replay vs. session resume

This is the only behaviour that genuinely changes, and it must be handled deliberately.

### 3.1 Today

- **Anthropic** relies on the Agent SDK's **server-side session**. The driver sends only the *latest user message* (`serialiseMessagesAsPrompt` → a single string) and replays prior history via `Options.resume = sessionId`. The runner persists the SDK `session_id` (`persister.recordSession` → `ai_conversations.session_id`) and the handler passes it back as `req.resumeSessionId`.
- **OpenAI / OpenRouter** send **only the latest user message** (`serialiseLatestUserMessage`) and **do not replay history at all** — this is documented in `openrouter.ts` as a known follow-up. So today these providers are effectively single-turn-memory within the model call.

### 3.2 After (direct HTTP)

Direct REST has **no server-side session**. Each turn must send the **full conversation** in the provider's native message array:

- **Anthropic:** `messages: [{role:'user'|'assistant', content:[...blocks]}]`, where assistant `tool_use` blocks and the following `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}` pair up the call/result. `system` is a top-level field.
- **OpenAI Responses:** an `input` array of items mixing message items and `{type:'function_call'}` / `{type:'function_call_output', call_id, output}` items.

**The data already exists.** The conversation store persists the full canonical log: `appendAssistantText`, `appendToolCall` (assistant `toolCall` block + `toolCallId`/`toolName`), and `appendToolResult` (`role:'tool'` rows). So the change is:

1. The **chat handler** loads the full `AiMessage[]` history and passes it as `req.messages` (instead of just the latest user turn).
2. Each **driver** maps `AiMessage[]` → its provider message array, pairing `toolCall` blocks with `role:'tool'` results.

**This is a net win:** it *fixes* the latent OpenAI/OpenRouter "no history replay" bug for free, and unifies memory behaviour across all providers.

### 3.3 Dead code to delete (pre-release — no back-compat, per CLAUDE.md)

- `AiStreamEvent` variant `{type:'session'}` and all handling of it in `runner.ts`.
- `persister.recordSession` + `ConversationsPersister.recordSession`.
- `conversations/store.ts` `setConversationSessionId` and the `ai_conversations.session_id` column (drop in **both** `migrations-pg.ts` and `migrations-sqlite.ts` with identical IDs — see `docs/reference/database-dialects.md`). *(Verify the column has no other reader before dropping.)*
- `AiStreamRequest.resumeSessionId` and the handler plumbing that sets it.
- `drivers/types.ts` doc references to "resume".

---

## 4. Two templates already live in the repo

The refactor is **not greenfield**. Two existing files are near-complete templates:

1. **`drivers/ollama.ts`** — already a pure-`fetch` skeleton whose header comment spells out the exact recipe: `POST .../v1/chat/completions` with `stream:true`, parse `data: …\n\n` SSE lines into `AiStreamEvent`, bridge tool calls via `req.bridge.callBrowser(...)`. Finishing Ollama *is* a direct-HTTP driver.
2. **`drivers/openrouter.ts`** — its `translateEvent()` already maps the **OpenAI Responses** event stream (`response.output_text.delta`, `response.output_item.done` function calls, `response.completed` usage) to canonical `AiStreamEvent`. The same translation drives a direct **OpenAI** Responses driver — only the transport (raw SSE instead of the SDK's `getFullResponsesStream()`) and the manual tool loop differ.

Plus existing helpers to reuse as-is: `classifyAuthOrBillingError`, `isAbortError`, `normaliseToolOutput`, `parseToolArguments` (in `openrouter.ts`), and `parseValue`/`Type` from `@core/utils/typeboxHelpers` for boundary validation.

---

## 5. Provider API reference (the concrete wire facts)

### 5.1 Anthropic Messages API

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Headers:** `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json`
- **Body:** `{ model, max_tokens (required), system, messages, tools, stream: true }`
- **Tools:** `{ name, description, input_schema: <JSON Schema> }` — feed the TypeBox schema **directly** (it is JSON Schema). No Zod.
- **Prompt caching (GA, no beta header):** set `cache_control: {type:'ephemeral'}` on the trailing `system` block of the static prefix. The current 3-element `systemPrompt` array (`[prefix, '__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__', suffix]`) maps to two `system` blocks, `cache_control` on the first.
- **SSE event sequence:** `message_start` (Message w/ empty content + initial `usage`) → per block: `content_block_start`, N× `content_block_delta`, `content_block_stop` → `message_delta` (carries `stop_reason` + **cumulative** `usage`) → `message_stop`.
  - **Text:** `content_block_delta.delta.type === 'text_delta'` → `{type:'text'}`.
  - **Tool use:** `content_block_start.content_block.type === 'tool_use'` (`id`, `name`, `input:{}`), then `content_block_delta.delta.type === 'input_json_delta'` with `partial_json` **string fragments** — accumulate per `index` and `JSON.parse` at `content_block_stop` → `{type:'toolCall'}`.
  - **Usage / cache:** `usage` on `message_start` and `message_delta` carries `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` → `{type:'usage', cacheReadTokens, cacheCreationTokens}`.
- **Stop / loop:** `message_delta.delta.stop_reason === 'tool_use'` ⇒ execute the tool(s), append the assistant `tool_use` turn + a `{role:'user', content:[{type:'tool_result', tool_use_id, content}]}` turn, and re-POST. Loop until `stop_reason !== 'tool_use'` (`end_turn`/`max_tokens`/`stop_sequence`).
- **Cost:** not returned — compute from `pricing.ts` (unchanged path; `costUsd` left undefined so the persister prices it).

### 5.2 OpenAI Responses API

- **Endpoint:** `POST https://api.openai.com/v1/responses`
- **Headers:** `Authorization: Bearer <key>`, `content-type: application/json`
- **Body:** `{ model, instructions (system), input: [items], tools, stream: true }`
- **Tools:** `{ type:'function', name, parameters: <JSON Schema>, strict?: bool }` — TypeBox schema directly. (`strict:true` requires `additionalProperties:false` + all-required; start with `strict` omitted to avoid schema-shape constraints, revisit later.)
- **Model function call:** output item `{type:'function_call', call_id, name, arguments(JSON string)}`.
- **Feed result back:** append input item `{type:'function_call_output', call_id, output}` and re-POST.
- **SSE events (already handled in `openrouter.ts`):** `response.output_text.delta` → text; `response.output_item.done` (function_call) → toolCall; `response.completed` → usage (`response.usage.input_tokens`/`output_tokens`/`input_tokens_details.cached_tokens`); `response.failed` / `error` → error.

### 5.3 OpenRouter & Ollama

- **OpenRouter:** identical to §5.2 against `https://openrouter.ai/api/v1/responses`; keep the live `/models` catalogue fetch (already plain `fetch` + TypeBox-validated) and the native `usage.cost` → `costUsd` pass-through.
- **Ollama:** OpenAI-compatible `chat/completions` SSE against the credential `baseUrl`; finish the existing skeleton.

---

## 6. Target architecture

Introduce a small shared HTTP layer so the loop, SSE parsing, and history mapping are written **once**, not four times.

```
server/ai/drivers/
  http/
    sse.ts            # parseSseStream(response): AsyncIterable<{event,data}> — one robust SSE line parser
    toolLoop.ts       # runToolLoop(...) — provider-agnostic multi-turn driver:
                      #   send → stream events → on tool_use: execute (server handler | browser bridge)
                      #   via the existing callTool logic → append result turn → resend → until stop.
    execTool.ts       # the shared callTool/callAiTool body (server vs browser, TypeBox re-validation,
                      #   AiToolOutput normalisation) lifted out of anthropic.ts/openrouter.ts
  anthropic.ts        # Anthropic Messages mapping: request body, SSE→AiStreamEvent, AiMessage[]→messages[]
  openai.ts           # OpenAI Responses mapping (shares the Responses translator with openrouter)
  openrouter.ts       # OpenAI Responses mapping + live model catalogue + native cost
  ollama.ts           # OpenAI chat/completions mapping (finish skeleton)
  responses-shared.ts # shared OpenAI-Responses event translation + message mapping (openai + openrouter)
  models.ts           # the static MODELS/pricing-adjacent lists (unchanged content)
  types.ts            # AiProvider contract (unchanged)
  index.ts            # registry (unchanged)
  # DELETED: typeboxToZod.ts, anthropicStream.ts (folded into the new anthropic.ts/sse.ts)
```

Each provider driver becomes three pure, unit-testable functions:

1. `buildRequestBody(req)` — canonical → provider JSON.
2. `mapHistory(messages)` — `AiMessage[]` → provider message/input array (tool pairing).
3. `translate(sseEvent, state)` — provider SSE → `AiStreamEvent | null`.

`stream()` then = `runToolLoop({ buildRequestBody, mapHistory, translate, endpoint, headers, req })`.

**Abort:** pass `req.signal` straight to `fetch(..., {signal})` (already the pattern in `openrouter.ts`/`ollama.ts`); on abort, return cleanly (no error event), matching today.

---

## 7. Implementation plan (phased, file-by-file)

### Phase 0 — Shared HTTP scaffolding
- **Add** `drivers/http/sse.ts`: `async function* parseSseStream(res: Response)` yielding `{event, data}` from `res.body` (Bun `ReadableStream`), handling multi-line `data:`, `event:` names, and `[DONE]`. Unit-tested against canned byte chunks (including a JSON object split across two chunks).
- **Add** `drivers/http/execTool.ts`: lift the existing `callTool`/`callAiTool` body (server `handler` vs `bridge.callBrowser`, `parseValue` re-validation, `normaliseToolOutput`). One copy, returns `AiToolOutput`.
- **Add** `drivers/http/toolLoop.ts`: the provider-agnostic generator described in §6. Takes per-provider `buildRequestBody`/`mapHistory`/`translate`/`endpoint`/`headers`. Emits canonical events, executes tools between turns, loops until the provider signals "no more tool calls," yields a final `usage`.

### Phase 1 — Anthropic driver (highest value)
- **Rewrite** `drivers/anthropic.ts` to `fetch https://api.anthropic.com/v1/messages` using the §5.1 mapping. Implement `mapHistory` (tool_use/tool_result pairing, image blocks → `{type:'image', source:{type:'base64',...}}`), `cache_control` on the system prefix, and the SSE translator (fold in `anthropicStream.ts`).
- **Delete** `drivers/anthropicStream.ts` (folded), `drivers/typeboxToZod.ts` (no Zod).
- **Drop** imports of `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`, `zod`.

### Phase 2 — OpenAI + OpenRouter (shared Responses path)
- **Add** `drivers/responses-shared.ts`: the OpenAI-Responses event translator (port `openrouter.ts:translateEvent`) + `mapHistory` for the `input` array (`function_call`/`function_call_output` pairing).
- **Rewrite** `drivers/openai.ts` → `fetch https://api.openai.com/v1/responses`.
- **Rewrite** `drivers/openrouter.ts` → `fetch https://openrouter.ai/api/v1/responses`; keep the existing `/models` catalogue fetch and native `usage.cost` pass-through.
- **Drop** `@openai/agents`, `@openrouter/agent`, `zod`.

### Phase 3 — Finish Ollama
- **Implement** `drivers/ollama.ts:stream()` against `${baseUrl}/v1/chat/completions` (OpenAI chat-completions SSE), and `listModels()` against `${baseUrl}/api/tags`.

### Phase 4 — History replay + delete session machinery
- **Chat handler** (`server/ai/handlers/chat.ts`): load the full conversation history and pass it as `req.messages`. (Confirm where the message log is read; today only the latest turn is threaded.)
- **Delete** session-resume code path (§3.3): `{type:'session'}` event, `recordSession`, `setConversationSessionId`, `ai_conversations.session_id` column (PG + SQLite migrations), `resumeSessionId` plumbing.

### Phase 5 — Gate + deps + docs
- **`package.json`:** remove `@anthropic-ai/claude-agent-sdk`, `@openai/agents`, `@openrouter/agent`, `@modelcontextprotocol/sdk`, `zod`. `bun install` to update `bun.lock`.
- **`ai-driver-isolation.test.ts`:** remove the per-SDK allow-rules; **invert** the gate to assert that **no** provider SDK and **no** `zod` is imported anywhere under `server/`/`src/` (a strictly stronger boundary). Keep `@anthropic-ai/sdk` banned.
- **Docs:** update `docs/server.md` AI section + `docs/plans/2026-05-26-ai-runtime-rewrite.md` cross-refs to describe direct HTTP drivers and history replay (CLAUDE.md: docs track code in the same change).

### Phase 6 — Verify
- `bun run build`, `bun test`, `bun run lint`. Live smoke test each provider via `/admin/ai` with a real key (Anthropic first): single-turn text, a tool-using turn, a multi-turn follow-up (history replay), and an abort mid-stream.

---

## 8. Testing strategy

The direct drivers are **more** testable than the SDK versions — feed canned SSE byte streams to a mocked `fetch`, with no network:

- **`sse.ts`** — unit tests: split frames, multi-line data, `event:`-named frames, `[DONE]`, partial-JSON-across-chunks.
- **per-provider `translate()`** — table-driven tests mapping captured real SSE frames (§5 examples) → expected `AiStreamEvent`.
- **`mapHistory()`** — tool_use/tool_result and function_call/function_call_output pairing; image blocks; system prefix + `cache_control`.
- **`toolLoop.ts`** — mock `fetch` returns "turn 1: tool_use" then "turn 2: end_turn"; assert server-handler and browser-bridge tools both execute and that the second request body contains the tool result.
- **Usage/cost** — assert cache token fields propagate and `pricing.ts` still prices providers that omit `costUsd`.

---

## 9. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Prompt-cache parity** (manual `cache_control` vs SDK auto) | Med | Map the existing 3-element `systemPrompt` to system blocks + `cache_control`; assert `cache_read/creation` tokens appear in tests and a live smoke run. |
| **History-mapping correctness** (tool_use/result pairing) | Med | Pure-function `mapHistory` with table tests; this is the most bug-prone area. |
| **Usage/cost regressions** (cache accounting) | Med | Reuse `persister`/`pricing.ts` unchanged; unit-test token propagation per provider. |
| **Abort handling** | Low | `fetch(signal)` + clean return on `AbortError` — already the openrouter/ollama pattern. |
| **Image inputs** (`AiContentBlock 'image'`) | Low | Map base64 → Anthropic `image`/OpenAI `input_image`; small and well-documented. |
| **Model-list drift** | Low | Static `MODELS` already a documented maintenance cost; unchanged. |
| **No live API in CI** | Low | Same as today (SDK calls also weren't CI-tested); mocked-fetch coverage is *new* and stronger. |
| **Loss of future Agent-SDK features** (skills, server tools) | Low | This CMS explicitly disables them today; if ever needed, they're re-addable behind the same interface. |

**Architectural risk is low** because the `AiProvider` boundary, the runner, the wire protocol, and two in-repo HTTP templates already exist.

---

## 10. Effort estimate

| Phase | Rough size |
|---|---|
| 0 — shared http/ scaffolding | ~0.5–1 day |
| 1 — Anthropic driver | ~1–1.5 days (mapping + cache + SSE + tests) |
| 2 — OpenAI + OpenRouter | ~1 day (shared Responses path) |
| 3 — Ollama | ~0.5 day |
| 4 — history replay + delete session machinery | ~0.5–1 day (incl. migration) |
| 5 — gate/deps/docs | ~0.5 day |
| 6 — verify + live smoke | ~0.5 day |
| **Total** | **~4.5–6 days** for one engineer |

---

## 11. Out of scope / open questions

- **Streaming tool-call arguments to the UI** — today tool input surfaces once complete; keep that (don't stream `input_json_delta` to the browser) unless desired.
- **`strict` tool schemas (OpenAI)** — start without `strict`; enabling it later requires `additionalProperties:false` + all-required, which may need TypeBox schema tweaks.
- **Confirm the exact read path** in `handlers/chat.ts` that must switch from "latest user message" to "full history" before Phase 4.
- **Confirm no other reader** of `ai_conversations.session_id` before dropping the column.
- **Retry/backoff** — the SDKs did some implicit retrying; decide whether to add a thin retry on 429/5xx (the `classifyAuthOrBillingError` helper already distinguishes these).
```
