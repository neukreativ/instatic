import { describe, expect, it } from 'bun:test'
import {
  isTextContentEventTarget,
  resolveCanvasEventElement,
  resolveDeepestCanvasNodeIdFromEvent,
  resolvePreferredCanvasNodeIdFromEvent,
} from '@site/canvas/canvasEventTarget'

describe('canvasEventTarget', () => {
  it('resolves text-node targets to their parent element', () => {
    const parent = document.createElement('p')
    parent.appendChild(document.createTextNode('Hello'))
    const textNode = parent.firstChild!

    expect(resolveCanvasEventElement(textNode)).toBe(parent)
  })

  it('treats ancestor nodes as non-targets when the click hits inner text', () => {
    const container = document.createElement('div')
    container.dataset.nodeId = 'container'
    const heading = document.createElement('h1')
    heading.dataset.nodeId = 'heading'
    heading.dataset.moduleId = 'base.text'
    heading.textContent = 'Title'
    container.appendChild(heading)
    document.body.appendChild(container)

    const textNode = heading.firstChild!
    expect(isTextContentEventTarget(textNode)).toBe(true)
    expect(resolvePreferredCanvasNodeIdFromEvent(textNode)).toBe('heading')

    container.remove()
  })

  it('returns the innermost data-node-id for text-node clicks', () => {
    const container = document.createElement('div')
    container.dataset.nodeId = 'container'
    const heading = document.createElement('h1')
    heading.dataset.nodeId = 'heading'
    heading.textContent = 'Title'
    container.appendChild(heading)

    const textNode = heading.firstChild!
    expect(resolveDeepestCanvasNodeIdFromEvent(textNode)).toBe('heading')
  })

  it('treats line breaks inside text modules as text-content hits', () => {
    const heading = document.createElement('h1')
    heading.dataset.nodeId = 'heading'
    heading.dataset.moduleId = 'base.text'
    const br = document.createElement('br')
    heading.appendChild(document.createTextNode('Line one'))
    heading.appendChild(br)

    expect(isTextContentEventTarget(br)).toBe(true)
    expect(resolvePreferredCanvasNodeIdFromEvent(br)).toBe('heading')
  })
})
