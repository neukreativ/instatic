/**
 * ModulePickerMenu — top-level `ContextMenu` shell wrapping `ModulePicker`.
 *
 * Used by the toolbar "+" trigger; the right-click DOM-panel uses
 * `ContextMenuSubmenu` instead (the picker fits as a true second-level
 * dropdown). Both call sites share the same `ModulePicker` content, so the
 * primitives (rows, separators) and styling are identical between levels.
 *
 * The menu is rendered through `createPortal` to `document.body` so that
 * positioning rules from the trigger's surrounding layout (e.g. CanvasNotch's
 * `.notch > * { position: relative; z-index: 1 }`) cannot override the menu's
 * own `position: fixed` and break the parent layout.
 */

import { useRef, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import { ContextMenu } from '@ui/components/ContextMenu'
import type { FloatingAlign, FloatingSide } from '@ui/lib/floatingPosition'
import { ModulePicker } from './ModulePicker'

const PICKER_WIDTH = 280
const PICKER_MAX_HEIGHT = 420

interface ModulePickerMenuProps {
  /** Element the menu anchors to. */
  anchorRef: RefObject<HTMLElement | null>
  /** Preferred side relative to the anchor. Default: 'auto'. */
  side?: FloatingSide
  /** Cross-axis alignment. Default: 'center' — the menu centers on the trigger. */
  align?: FloatingAlign
  /** Stack order. Default: 1000. */
  zIndex?: number
  onClose: () => void
  onSelectModule: (mod: AnyModuleDefinition) => void
  onSelectVC: (vcId: string) => void
}

export function ModulePickerMenu({
  anchorRef,
  side = 'auto',
  align = 'center',
  zIndex = 1000,
  onClose,
  onSelectModule,
  onSelectVC,
}: ModulePickerMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  if (typeof document === 'undefined') return null

  return createPortal(
    <ContextMenu
      ref={menuRef}
      anchorRef={anchorRef}
      side={side}
      align={align}
      offset={6}
      width={PICKER_WIDTH}
      minWidth={PICKER_WIDTH}
      maxHeight={PICKER_MAX_HEIGHT}
      zIndex={zIndex}
      ariaLabel="Add module"
      onClose={onClose}
    >
      <ModulePicker
        containerRef={menuRef}
        onSelectModule={onSelectModule}
        onSelectVC={onSelectVC}
      />
    </ContextMenu>,
    document.body,
  )
}
