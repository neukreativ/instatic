/**
 * LayerNodeContextMenu — right-click menu for nodes in the DOM panel and
 * canvas. Hosts rename / duplicate / cut / copy / paste / wrap / delete
 * actions and an "Insert module here" `ContextMenuSubmenu` that shows the
 * shared `ModulePicker` (search + categorized module list, including site
 * Visual Components) as a true second-level dropdown — same primitive,
 * same styling, same hover/focus/colors as every other submenu.
 *
 * Selection of a base module routes through `useInsertModule` with the
 * right-clicked nodeId as an explicit parent — no smart-resolution fallback.
 *
 * The Paste item is rendered conditionally: it appears only when the
 * clipboard slice has a captured subtree. The clipboard is global and
 * persisted to localStorage, so it can survive page reloads and span
 * across sites.
 *
 * Architecture gate (G4, G5): Visual Component insertion MUST go through the
 * shared `insertComponentRef` action in `siteSlice` so cycle detection and
 * VC/page-mode dispatch are applied uniformly.
 * See `src/__tests__/architecture/component-system-placement.test.ts`.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  ContextMenu as UIContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
} from '@ui/components/ContextMenu'
import { useEditorStore } from '@core/editor-store/store'
import { useInsertModule } from '../../hooks/useInsertModule'
import { ModulePicker } from '../ModulePicker'
import type { AnyModuleDefinition } from '@core/module-engine/types'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { CopyIcon } from 'pixel-art-icons/icons/copy'
import { Copy2Icon } from 'pixel-art-icons/icons/copy-2'
import { EraserIcon } from 'pixel-art-icons/icons/eraser'
import { FilesStack2Icon } from 'pixel-art-icons/icons/files-stack-2'
import { CheckboxIcon } from 'pixel-art-icons/icons/checkbox'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { PlusIcon } from 'pixel-art-icons/icons/plus'

interface LayerNodeContextMenuProps {
  x: number
  y: number
  onClose: () => void
  onDelete: () => void
  onDuplicate: () => void
  onRename: () => void
  onWrapInContainer: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  /** The node that was right-clicked. When omitted, falls back to selectedNodeId. */
  nodeId?: string
}

export function LayerNodeContextMenu({
  x,
  y,
  onClose,
  onDelete,
  onDuplicate,
  onRename,
  onWrapInContainer,
  onCopy,
  onCut,
  onPaste,
  nodeId: nodeIdProp,
}: LayerNodeContextMenuProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null)

  // Per-node selector — fallback for nodeId when no explicit prop is given.
  // CanvasRoot selects the right-clicked node before opening the menu, so
  // selectedNodeId is reliable there even without an explicit nodeId prop.
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const insertComponentRef = useEditorStore((s) => s.insertComponentRef)
  const insertModule = useInsertModule()

  // Reactive boolean for the conditional Paste item — re-renders whenever
  // the clipboard entry transitions between null and non-null.
  const canPaste = useEditorStore((s) => s.clipboardEntry !== null)

  const nodeId = nodeIdProp ?? selectedNodeId

  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  const handleSelectModule = useCallback(
    (mod: AnyModuleDefinition) => {
      if (!nodeId) return
      insertModule(mod, nodeId)
    },
    [insertModule, nodeId],
  )

  const handleSelectVC = useCallback(
    (vcId: string) => {
      if (!nodeId) return
      insertComponentRef(nodeId, vcId)
    },
    [insertComponentRef, nodeId],
  )

  return (
    <UIContextMenu
      x={x}
      y={y}
      ariaLabel="Node options"
      onClose={onClose}
    >
      <ContextMenuItem ref={firstItemRef} onClick={onRename}>
        <span aria-hidden="true"><EditIcon size={13} /></span>
        Rename
      </ContextMenuItem>

      <ContextMenuItem onClick={onDuplicate}>
        <span aria-hidden="true"><CopyIcon size={13} /></span>
        Duplicate
      </ContextMenuItem>

      <ContextMenuSeparator />

      <ContextMenuItem onClick={onCopy}>
        <span aria-hidden="true"><Copy2Icon size={13} /></span>
        Copy
      </ContextMenuItem>

      <ContextMenuItem onClick={onCut}>
        <span aria-hidden="true"><EraserIcon size={13} /></span>
        Cut
      </ContextMenuItem>

      {canPaste && (
        <ContextMenuItem onClick={onPaste}>
          <span aria-hidden="true"><FilesStack2Icon size={13} /></span>
          Paste
        </ContextMenuItem>
      )}

      <ContextMenuSeparator />

      <ContextMenuItem onClick={onWrapInContainer}>
        <span aria-hidden="true"><CheckboxIcon size={13} /></span>
        Wrap in Container
      </ContextMenuItem>

      <ContextMenuSubmenu
        label="Insert module here"
        icon={<PlusIcon size={13} />}
        onClose={onClose}
        width={280}
        maxHeight={420}
        // The submenu hosts a search input — clicks on the input must not
        // dismiss the panel. Only menuitem clicks (i.e. picking a module/VC)
        // should close.
        closeOnItemClickOnly
      >
        <ModulePicker
          onSelectModule={handleSelectModule}
          onSelectVC={handleSelectVC}
        />
      </ContextMenuSubmenu>

      <ContextMenuSeparator />

      <ContextMenuItem danger onClick={onDelete}>
        <span aria-hidden="true"><DeleteIcon size={13} /></span>
        Delete
      </ContextMenuItem>
    </UIContextMenu>
  )
}
