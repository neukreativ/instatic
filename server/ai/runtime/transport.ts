/**
 * Streaming transport + browser bridge registry for the AI runtime.
 *
 * Two responsibilities:
 *
 *   1. NDJSON encoding — `encodeStreamEvent(ev)` converts an AiStreamEvent
 *      into the wire bytes (`JSON.stringify(ev) + '\n'`).
 *
 *   2. Browser bridge registry — drivers need to await the browser's
 *      response to a write tool. `createBridge()` issues a fresh bridgeId
 *      and returns an `AiBrowserBridge` whose `callBrowser()` returns a
 *      promise that resolves when /admin/api/ai/tool-result POSTs back.
 *
 * Extracted into its own module so the chat handler stays focused on HTTP
 * + auth + persistence, not bridge bookkeeping.
 */

import { nanoid } from 'nanoid'
import type {
  AiBrowserBridge,
  AiStreamEvent,
  AiToolOutput,
} from './types'

// ---------------------------------------------------------------------------
// NDJSON encoder
// ---------------------------------------------------------------------------

const TEXT_ENCODER = new TextEncoder()

export function encodeStreamEvent(event: AiStreamEvent): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify(event) + '\n')
}

// ---------------------------------------------------------------------------
// Bridge registry
// ---------------------------------------------------------------------------

interface PendingToolResolver {
  resolve(result: AiToolOutput): void
  reject(err: Error): void
}

interface BridgeEntry {
  pending: Map<string, PendingToolResolver>
  emit(event: AiStreamEvent): void
}

const activeBridges = new Map<string, BridgeEntry>()

/**
 * Allocate a new bridge for one chat stream. Returns the public-facing
 * bridgeId (sent to the browser via `bridgeReady`), an `AiBrowserBridge`
 * implementation drivers can call, and a `destroy()` hook the handler MUST
 * call in its finally-block (rejects any in-flight tool waiters).
 *
 * `emit` is the sink the driver-bridge uses to push `toolRequest` events
 * back through the NDJSON stream. Wire it to the same enqueue function the
 * chat handler uses for other events.
 */
export function createBridge(emit: (event: AiStreamEvent) => void): {
  bridgeId: string
  bridge: AiBrowserBridge
  destroy: () => void
} {
  const bridgeId = nanoid()
  const entry: BridgeEntry = { pending: new Map(), emit }
  activeBridges.set(bridgeId, entry)

  const bridge: AiBrowserBridge = {
    callBrowser(toolName, input) {
      const requestId = nanoid()
      return new Promise<AiToolOutput>((resolve, reject) => {
        entry.pending.set(requestId, { resolve, reject })
        emit({ type: 'toolRequest', requestId, toolName, input })
      })
    },
  }

  const destroy = () => {
    const live = activeBridges.get(bridgeId)
    if (!live) return
    if (live.pending.size > 0) {
      // Pending entries at stream-end mean the browser never POSTed a
      // tool-result for an in-flight tool call — diagnostic surface only,
      // not a fatal error.
      console.warn(
        `[ai/transport] bridge ${bridgeId} closed with ${live.pending.size} pending tool result(s).`,
      )
    }
    for (const pending of live.pending.values()) {
      pending.reject(new Error('AI chat stream ended before tool result arrived.'))
    }
    live.pending.clear()
    activeBridges.delete(bridgeId)
  }

  return { bridgeId, bridge, destroy }
}

/**
 * Resolve a pending tool wait. Called by the /admin/api/ai/tool-result
 * handler when the browser POSTs the result of a write tool.
 *
 * Returns true when a matching pending promise was found + resolved. False
 * when the bridge is gone (stream closed) or the requestId is unknown.
 */
export function resolveBridgeToolResult(
  bridgeId: string,
  requestId: string,
  result: AiToolOutput,
): boolean {
  const entry = activeBridges.get(bridgeId)
  if (!entry) return false
  const pending = entry.pending.get(requestId)
  if (!pending) return false
  entry.pending.delete(requestId)
  pending.resolve(result)
  return true
}

/**
 * Test-only: list every live bridge id. Production code uses
 * `resolveBridgeToolResult` + `createBridge` exclusively.
 */
export function __listActiveBridgesForTesting(): string[] {
  return [...activeBridges.keys()]
}

/**
 * Test-only: tear down every live bridge. Avoids cross-test bleed in unit
 * tests that exercise `createBridge` directly.
 */
export function __destroyAllBridgesForTesting(): void {
  for (const [, entry] of activeBridges) {
    for (const pending of entry.pending.values()) {
      pending.reject(new Error('Test teardown.'))
    }
    entry.pending.clear()
  }
  activeBridges.clear()
}
