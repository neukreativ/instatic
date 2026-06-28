/**
 * canvasEventTarget — resolve pointer/keyboard event targets inside canvas
 * iframes to the element that owns canvas selection.
 *
 * Clicks on rendered text often arrive with a `#text` node as `event.target`.
 * Ancestor module roots used to treat that as a hit on themselves and steal
 * selection from the inner semantic text element. Resolve text/comment targets
 * to their parent element before comparing `[data-node-id]` ownership.
 *
 * Always prefer `nativeEvent.target` over React's `event.target` when calling
 * these helpers — in iframe portals the synthetic target can differ from the
 * DOM node the author actually clicked.
 */

import { registry } from '@core/module-engine'

const CANVAS_NODE_SELECTOR = '[data-node-id]'

function isElementLike(value: EventTarget | null): value is Element {
  return value != null && typeof (value as { closest?: unknown }).closest === 'function'
}

/** The DOM target that originated the interaction. */
export function eventClickTarget(event: { nativeEvent: Event }): EventTarget | null {
  return event.nativeEvent.target
}

/** Normalize text/comment targets to the nearest Element host. */
export function resolveCanvasEventElement(target: EventTarget | null): Element | null {
  if (target == null) return null
  if (isElementLike(target)) return target
  const parent = (target as Node).parentElement
  return parent ?? null
}

/** True when the module's copy is edited in the Properties panel (Module section). */
export function isContentTextModuleId(moduleId: string | undefined): boolean {
  if (!moduleId) return false
  if (moduleId === 'base.text') return true
  return registry.get(moduleId)?.inlineTextEdit != null
}

/**
 * True when the click landed on visible text glyphs (or a line break inside
 * a text-bearing module), not on a container's empty padding/border box.
 */
export function isTextContentEventTarget(target: EventTarget | null): boolean {
  if (target == null) return false
  if ((target as Node).nodeType === Node.TEXT_NODE) return true
  if (!isElementLike(target)) return false
  if (target.tagName === 'BR') {
    const owner = target.closest<HTMLElement>(CANVAS_NODE_SELECTOR)
    return isContentTextModuleId(owner?.dataset.moduleId)
  }
  return false
}

/**
 * True when `currentTarget` is the nearest canvas node root for the event.
 * Returns false for ancestor nodes so the innermost module can handle the
 * interaction during capture/bubble.
 */
export function isCanvasNodeEventForElement(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  if (!isElementLike(currentTarget)) return true

  const resolvedTarget = resolveCanvasEventElement(target)
  if (!resolvedTarget) return false

  const closestNode = resolvedTarget.closest(CANVAS_NODE_SELECTOR)
  return closestNode === currentTarget
}

/** Innermost `[data-node-id]` element under the event target, if any. */
export function resolveDeepestCanvasNodeIdFromEvent(
  target: EventTarget | null,
): string | null {
  const resolvedTarget = resolveCanvasEventElement(target)
  if (!resolvedTarget) return null
  const closestNode = resolvedTarget.closest<HTMLElement>(CANVAS_NODE_SELECTOR)
  return closestNode?.dataset.nodeId ?? null
}

/**
 * Resolve the node id that should be selected for this click.
 *
 * Text-pixel hits prefer the innermost module whose copy is edited in the
 * Properties panel (`base.text`, button label, childless link text, …).
 */
export function resolvePreferredCanvasNodeIdFromEvent(
  target: EventTarget | null,
): string | null {
  const resolvedTarget = resolveCanvasEventElement(target)
  if (!resolvedTarget) return null

  if (isTextContentEventTarget(target)) {
    const owner = resolvedTarget.closest<HTMLElement>(CANVAS_NODE_SELECTOR)
    if (owner?.dataset.nodeId) return owner.dataset.nodeId
  }

  return resolveDeepestCanvasNodeIdFromEvent(target)
}
