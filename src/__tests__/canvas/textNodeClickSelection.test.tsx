import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@site/store/store'
import { setEditorSelectPreference } from '@site/preferences/editorPreferences'
import { CanvasRoot } from '@site/canvas/CanvasRoot'
import { queryCanvasElement, waitForCanvasElement } from './iframeCanvasQuery'
import { makeNode, makePage, makeSite } from '../fixtures'
import '@modules/base'

const originalFetch = globalThis.fetch

function renderCanvas() {
  return render(<DndContext><CanvasRoot /></DndContext>)
}

function setupContainerWithTextPage() {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['container'] })
  const container = makeNode({
    id: 'container',
    moduleId: 'base.container',
    children: ['heading'],
  })
  const heading = makeNode({
    id: 'heading',
    moduleId: 'base.text',
    props: { text: 'Click me', tag: 'h1' },
  })
  const page = makePage({
    id: 'page-1',
    rootNodeId: 'root',
    nodes: { root, container, heading },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: 'page-1',
    activeDocument: null,
    activeBreakpointId: 'desktop',
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function setupTagNoneTextPage() {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['bare'] })
  const bare = makeNode({
    id: 'bare',
    moduleId: 'base.text',
    props: { text: 'Bare text', tag: 'none' },
  })
  const page = makePage({
    id: 'page-1',
    rootNodeId: 'root',
    nodes: { root, bare },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: 'page-1',
    activeDocument: null,
    activeBreakpointId: 'desktop',
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

/** Simulate a browser click whose event.target is the #text node, not the element. */
function clickTextNodeContent(element: HTMLElement) {
  const textNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
  if (!textNode) throw new Error('Expected a text node child')

  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'target', { value: textNode, enumerable: true })
  element.dispatchEvent(event)
}

beforeEach(() => {
  cleanup()
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ value: null }), { status: 200 })) as typeof fetch
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('text node click selection', () => {
  it('selects the text module when clicking rendered text inside a container', async () => {
    setupContainerWithTextPage()
    renderCanvas()

    const headingEl = await waitForCanvasElement<HTMLElement>('[data-node-id="heading"]')
    await act(async () => {
      clickTextNodeContent(headingEl)
    })

    expect(useEditorStore.getState().selectedNodeId).toBe('heading')
  })

  it('selects tag:none text via its canvas-only host element', async () => {
    setupTagNoneTextPage()
    renderCanvas()

    const hostEl = await waitForCanvasElement<HTMLElement>('[data-node-id="bare"][data-instatic-canvas-text-host]')
    fireEvent.click(hostEl)

    expect(useEditorStore.getState().selectedNodeId).toBe('bare')
    expect(queryCanvasElement('[data-node-id="container"]')).toBeNull()
  })

  it('keeps text selection in active expanded mode when clicking text pixels', async () => {
    setEditorSelectPreference('propertiesSectionsMode', 'active')
    setupContainerWithTextPage()
    renderCanvas()

    const headingEl = await waitForCanvasElement<HTMLElement>('[data-node-id="heading"]')
    await act(async () => {
      clickTextNodeContent(headingEl)
    })

    expect(useEditorStore.getState().selectedNodeId).toBe('heading')
  })
})
