/**
 * Runtime barrel — public exports the handlers + drivers consume.
 */

export {
  createBridge,
  encodeStreamEvent,
  resolveBridgeToolResult,
} from './transport'
export { runChat } from './runner'
export { createConversationsPersister } from './persister'
export type { ConversationsPersister } from './persister'
export type {
  AiAuthMode,
  AiBrowserBridge,
  AiContentBlock,
  AiMessage,
  AiProviderId,
  AiStreamEvent,
  AiTool,
  AiToolOutput,
  AiUsage,
  ToolContext,
  ToolExecution,
  ToolScope,
} from './types'
