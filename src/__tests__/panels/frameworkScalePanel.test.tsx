import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import { SpacingPanel } from '@site/panels/SpacingPanel'
import { TypographyPanel } from '@site/panels/TypographyPanel'
import { useEditorStore } from '@site/store/store'
import { makeSite } from '../fixtures'

function resetStore() {
  useEditorStore.setState({
    site: makeSite(),
    activePageId: 'page-1',
    typographyPanelOpen: true,
    spacingPanelOpen: true,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)
afterEach(cleanup)

describe('FrameworkScalePanel', () => {
  it('keeps scale creation in the section controls instead of the panel header', () => {
    useEditorStore.getState().createFrameworkTypographyGroup()
    useEditorStore.getState().createFrameworkSpacingGroup()

    render(
      <>
        <TypographyPanel />
        <SpacingPanel />
      </>,
    )

    const typographyPanel = screen.getByTestId('typography-panel')
    const spacingPanel = screen.getByTestId('spacing-panel')
    const typographyHeader = within(typographyPanel).getByRole('toolbar', {
      name: 'Typography panel header',
    })
    const spacingHeader = within(spacingPanel).getByRole('toolbar', {
      name: 'Spacing panel header',
    })
    const typographyScalePicker = within(typographyPanel).getByRole('group', {
      name: 'Typography scales',
    })
    const spacingScalePicker = within(spacingPanel).getByRole('group', {
      name: 'Spacing scales',
    })

    expect(within(typographyHeader).queryByRole('button', { name: 'Add typography scale' })).toBeNull()
    expect(within(spacingHeader).queryByRole('button', { name: 'Add spacing scale' })).toBeNull()
    expect(within(typographyScalePicker).getByRole('button', { name: 'Add typography scale' })).toBeDefined()
    expect(within(spacingScalePicker).getByRole('button', { name: 'Add spacing scale' })).toBeDefined()
  })
})
