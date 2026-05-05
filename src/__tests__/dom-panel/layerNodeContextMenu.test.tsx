/**
 * layerNodeContextMenu.test.tsx
 *
 * Tests for the LayerNodeContextMenu "Insert module here" submenu:
 * - The submenu trigger is always present.
 * - Hovering it opens a `ContextMenuSubmenu` containing the shared ModulePicker
 *   (search + module/VC list).
 * - Picking a base module routes through useInsertModule with the right-clicked
 *   nodeId as an explicit parent.
 * - Picking a Visual Component routes through insertComponentRef with the
 *   right-clicked nodeId as parent.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { LayerNodeContextMenu } from '../../editor/components/DomPanel/LayerNodeContextMenu'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { VisualComponent } from '@core/visualComponents/schemas'
import '../../modules/base/index'

afterEach(cleanup)

function makeVC(id: string, name: string): VisualComponent {
  return {
    id,
    name,
    rootNode: {
      id: `root-${id}`,
      moduleId: 'base.body',
      props: {},
      children: [],
      breakpointOverrides: {},
      classIds: [],
    },
    params: [],
    breakpoints: [],
    classIds: [],
    filePath: `src/components/${name}.tsx`,
    generated: true,
    ejected: false,
    createdAt: 1_700_000_000_000,
  }
}

function resetStore(vcs: VisualComponent[] = []) {
  localStorage.clear()
  const home = makePage({
    id: 'page-home',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root-home',
    nodes: {
      'root-home': makeNode({ id: 'root-home', moduleId: 'base.body', children: ['container-node'] }),
      'container-node': makeNode({ id: 'container-node', moduleId: 'base.container' }),
    },
  })
  useEditorStore.setState({
    site: makeSite({ pages: [home], files: [], visualComponents: vcs }),
    activePageId: 'page-home',
    selectedNodeId: 'container-node',
    hoveredNodeId: null,
    activeDocument: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

const noop = () => {}

function renderMenu(nodeId = 'container-node', vcs: VisualComponent[] = []) {
  resetStore(vcs)
  return render(
    <LayerNodeContextMenu
      x={100}
      y={200}
      nodeId={nodeId}
      onClose={noop}
      onDelete={noop}
      onDuplicate={noop}
      onRename={noop}
      onWrapInContainer={noop}
      onCopy={noop}
      onCut={noop}
      onPaste={noop}
    />,
  )
}

function openInsertSubmenu() {
  // ContextMenuSubmenu opens on mouseEnter — fire that to open the panel.
  const trigger = screen.getByRole('menuitem', { name: /insert module here/i })
  fireEvent.mouseEnter(trigger)
  return trigger
}

beforeEach(() => resetStore())

describe('LayerNodeContextMenu — Insert module here', () => {
  it('renders the "Insert module here" submenu trigger', () => {
    renderMenu()
    expect(screen.getByRole('menuitem', { name: /insert module here/i })).toBeDefined()
  })

  it('opens the module picker submenu on hover', () => {
    renderMenu()
    openInsertSubmenu()

    // ContextMenuSubmenu renders a panel with role="menu" and aria-label
    // matching the trigger label. The picker's search input lives inside.
    expect(screen.getByRole('menu', { name: 'Insert module here' })).toBeDefined()
    expect(screen.getByRole('searchbox', { name: 'Search modules' })).toBeDefined()
  })

  it('inserts a base module into the right-clicked node when picked', () => {
    renderMenu('container-node')
    openInsertSubmenu()

    const submenu = screen.getByRole('menu', { name: 'Insert module here' })
    const textOption = within(submenu).getAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.text',
    )
    expect(textOption).toBeDefined()
    fireEvent.click(textOption!)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const container = page?.nodes['container-node']
    expect(container?.children.length).toBe(1)

    const insertedId = container?.children[0]
    const inserted = insertedId ? page?.nodes[insertedId] : null
    expect(inserted?.moduleId).toBe('base.text')
  })

  it('inserts a Visual Component into the right-clicked node when picked', () => {
    const vc = makeVC('vc-abc', 'MyCard')
    renderMenu('container-node', [vc])
    openInsertSubmenu()

    const submenu = screen.getByRole('menu', { name: 'Insert module here' })
    const vcItem = submenu.querySelector('[data-vc-id="vc-abc"]') as HTMLElement
    expect(vcItem).not.toBeNull()
    fireEvent.click(vcItem)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const container = page?.nodes['container-node']
    expect(container?.children.length).toBe(1)

    const insertedId = container?.children[0]
    const inserted = insertedId ? page?.nodes[insertedId] : null
    expect(inserted?.moduleId).toBe('base.visual-component-ref')
    expect(inserted?.props.componentId).toBe('vc-abc')
  })

  it('falls back to selectedNodeId when nodeId prop is not provided', () => {
    const vc = makeVC('vc-1', 'HeroCard')
    resetStore([vc])

    render(
      <LayerNodeContextMenu
        x={100}
        y={200}
        onClose={noop}
        onDelete={noop}
        onDuplicate={noop}
        onRename={noop}
        onWrapInContainer={noop}
        onCopy={noop}
        onCut={noop}
        onPaste={noop}
      />,
    )

    openInsertSubmenu()

    const submenu = screen.getByRole('menu', { name: 'Insert module here' })
    const vcItem = submenu.querySelector('[data-vc-id="vc-1"]') as HTMLElement
    fireEvent.click(vcItem)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    // selectedNodeId in resetStore is 'container-node' — VC ref should land there.
    const container = page?.nodes['container-node']
    expect(container?.children.length).toBe(1)
  })
})
