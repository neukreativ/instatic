/**
 * ClassPicker — always-visible class chip manager.
 *
 * Replaces ClassesTab in the Properties Panel redesign (Spec #659 §2).
 * Now permanently visible (no tab click required — PP-2 acceptance criterion).
 *
 * Changes vs. ClassesTab:
 *   - Pill right-click context menu owns reorder/rename/remove actions — PP-8
 *   - Chip × has tooltip="Remove from this element" — PP-9
 *   - Class assignment UI lives directly under the selected element header
 *   - Uses reorderNodeClass store action (new in classSlice — Task #456)
 *
 * Architecture:
 *   - Always mounted when a node is selected (PropertiesPanel renders it unconditionally)
 *   - Active class styling is rendered by PropertiesPanel below the header class strip
 *   - Guideline #242: reorderNodeClass no-ops at array boundaries
 *   - Guideline #350: pixel-art-icons only; CloseIcon for × button
 *   - Constraint #451: X/Twitter logo icon is prohibited (use CloseIcon for × buttons)
 */

import {
  useState,
  useReducer,
  useRef,
  useEffect,
  useId,
  useImperativeHandle,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore, selectActiveCanvasPage } from '@site/store/store'
import { useEditorPreference } from '@site/preferences/editorPreferences'
import { Button } from '@ui/components/Button'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@ui/components/ContextMenu'
import { Dialog } from '@ui/components/Dialog'
import { Input } from '@ui/components/Input'
import { ChevronUpIcon } from 'pixel-art-icons/icons/chevron-up'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { EditSolidIcon } from 'pixel-art-icons/icons/edit-solid'
import {
  isGeneratedClassLocked,
  isUserVisibleClass,
  classifySelectorCreateInput,
  type PageNode,
  type StyleRule,
} from '@core/page-tree'
import { recordClassUsage } from '@site/preferences/classUsage'
import { getErrorMessage } from '@core/utils/errorMessage'
import { useClassPickerSuggestions } from './useClassPickerSuggestions'
import {
  deriveSelectorPickerModel,
  type SelectorSuggestionItem,
} from './selectorPickerModel'
import {
  SelectorInputArea,
  SelectorPillStack,
  SelectorSuggestionsPortal,
} from './ClassPickerParts'
import dialogStyles from '../../../../shared/dialogs/SiteCreateDialog/SiteCreateDialog.module.css'
import styles from './ClassPicker.module.css'

interface ClassContextMenuState {
  x: number
  y: number
  classId: string
}

interface ClassPickerUiState {
  query: string
  showSuggestions: boolean
  contextMenu: ClassContextMenuState | null
  renameTarget: StyleRule | null
  createError: string | null
  highlightedIndex: number
}

type ClassPickerUiAction =
  | { type: 'inputChanged'; query: string }
  | { type: 'openSuggestions' }
  | { type: 'closeSuggestions' }
  | { type: 'resetAfterSubmit' }
  | { type: 'setContextMenu'; contextMenu: ClassContextMenuState | null }
  | { type: 'setRenameTarget'; renameTarget: StyleRule | null }
  | { type: 'setCreateError'; message: string | null }
  | { type: 'moveHighlight'; direction: 'next' | 'previous'; count: number }

const initialClassPickerUiState: ClassPickerUiState = {
  query: '',
  showSuggestions: false,
  contextMenu: null,
  renameTarget: null,
  createError: null,
  highlightedIndex: -1,
}

function classPickerUiReducer(
  state: ClassPickerUiState,
  action: ClassPickerUiAction,
): ClassPickerUiState {
  switch (action.type) {
    case 'inputChanged':
      return {
        ...state,
        query: action.query,
        showSuggestions: true,
        createError: null,
        highlightedIndex: -1,
      }
    case 'openSuggestions':
      return { ...state, showSuggestions: true }
    case 'closeSuggestions':
      return { ...state, showSuggestions: false, highlightedIndex: -1 }
    case 'resetAfterSubmit':
      return {
        ...state,
        query: '',
        showSuggestions: false,
        createError: null,
        highlightedIndex: -1,
      }
    case 'setContextMenu':
      return { ...state, contextMenu: action.contextMenu }
    case 'setRenameTarget':
      return { ...state, renameTarget: action.renameTarget }
    case 'setCreateError':
      return { ...state, createError: action.message }
    case 'moveHighlight': {
      if (action.count <= 0) return state
      if (action.direction === 'next') {
        const next = state.highlightedIndex + 1
        return {
          ...state,
          showSuggestions: true,
          highlightedIndex: next >= action.count ? 0 : next,
        }
      }
      return {
        ...state,
        showSuggestions: true,
        highlightedIndex:
          state.highlightedIndex <= 0 ? action.count - 1 : state.highlightedIndex - 1,
      }
    }
  }
}

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

function isClassRule(rule: StyleRule): boolean {
  return !rule.kind || rule.kind === 'class'
}

function cssAttrSelectorValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function getSelectedCanvasElement(nodeId: string): HTMLElement | null {
  const selector = `[data-node-id="${cssAttrSelectorValue(nodeId)}"]`
  const localElement = document.querySelector<HTMLElement>(selector)
  if (localElement) return localElement

  for (const frame of document.querySelectorAll('iframe')) {
    try {
      const frameElement = frame.contentDocument?.querySelector<HTMLElement>(selector) ?? null
      if (frameElement) return frameElement
    } catch (_err) {
      // Canvas iframes are same-origin srcdoc documents; ignore any unexpected
      // cross-origin iframe a plugin or dev tool may add to the admin shell.
    }
  }
  return null
}

function useClassPickerDerivedState({
  site,
  node,
  nodeId,
  activeClassId,
  inlineStyleEditing,
  query,
  highlightedIndex,
}: {
  site: { styleRules: Record<string, StyleRule> } | null
  node: PageNode | null
  nodeId: string
  activeClassId: string | null
  inlineStyleEditing: boolean
  query: string
  highlightedIndex: number
}) {
  const assignedIds = node?.classIds ?? []
  const visibleAssignedIds = assignedIds.filter((id) => isUserVisibleClass(site?.styleRules[id]))
  const nodeHasInlineStyles = !!node?.inlineStyles && Object.keys(node.inlineStyles).length > 0
  const allRules = Object.values(site?.styleRules ?? {}).filter(isUserVisibleClass)
  const allClasses = allRules.filter(isClassRule)
  const visibleRuleRegistry = Object.fromEntries(allRules.map((rule) => [rule.id, rule]))
  const selectedElement = getSelectedCanvasElement(nodeId)
  const selectorModel = deriveSelectorPickerModel({
    rules: visibleRuleRegistry,
    node,
    selectedElement,
    activeRuleId: inlineStyleEditing ? null : activeClassId,
  })
  const ambientSelectorItems = selectorModel.suggestions.filter((item) => item.rule.kind === 'ambient')
  const suggestions = useClassPickerSuggestions({
    allClasses,
    assignedIds,
    selectorItems: ambientSelectorItems,
    query,
    highlightedIndex,
  })
  const hasSuggestionRows = (
    suggestions.isEmptyQuery
      ? suggestions.candidates.length > 0
      : suggestions.filteredSuggestions.length > 0
  ) || suggestions.selectorSuggestions.length > 0

  return {
    visibleAssignedIds,
    showInlinePill: nodeHasInlineStyles || inlineStyleEditing,
    selectedElement,
    selectorModel,
    hasSuggestionRows,
    highlightedSelectorId: suggestions.highlightedSelectorItem?.rule.id ?? null,
    ...suggestions,
  }
}

// ---------------------------------------------------------------------------
// ClassPicker
// ---------------------------------------------------------------------------

export interface ClassPickerHandle {
  /** Focus the 'Add or create selector…' input. */
  focusInput: () => void
}

interface ClassPickerProps {
  nodeId: string
  /**
   * Optional inline action rendered to the right of the 'Add or create selector…'
   * input as a sibling cell in the same two-column row. The suggestions
   * dropdown spans both cells so search results can use the full row width.
   */
  trailingAction?: ReactNode
  /** React 19: ref is a regular prop on function components. */
  ref?: Ref<ClassPickerHandle>
}

export function ClassPicker({ nodeId, trailingAction, ref }: ClassPickerProps) {
  const site = useEditorStore((s) => s.site)
  const node = useEditorStore((s) => selectActiveCanvasPage(s)?.nodes[nodeId] ?? null)
  const activeClassId = useEditorStore((s) => s.activeClassId)
  const setActiveClass = useEditorStore((s) => s.setActiveClass)
  const inlineStyleEditing = useEditorStore((s) => s.inlineStyleEditing)
  const setInlineStyleEditing = useEditorStore((s) => s.setInlineStyleEditing)
  const clearNodeInlineStyles = useEditorStore((s) => s.clearNodeInlineStyles)
  const addNodeClass = useEditorStore((s) => s.addNodeClass)
  const removeNodeClass = useEditorStore((s) => s.removeNodeClass)
  const createClass = useEditorStore((s) => s.createClass)
  const createAmbientRule = useEditorStore((s) => s.createAmbientRule)
  const renameClass = useEditorStore((s) => s.renameClass)
  const reorderNodeClass = useEditorStore((s) => s.reorderNodeClass)
  const setPreviewNodeClass = useEditorStore((s) => s.setPreviewNodeClass)
  const clearPreviewNodeClass = useEditorStore((s) => s.clearPreviewNodeClass)

  const [ui, dispatchUi] = useReducer(classPickerUiReducer, initialClassPickerUiState)
  const { query, showSuggestions, contextMenu, renameTarget, createError, highlightedIndex } = ui
  const hoverPreviewEnabled = useEditorPreference('hoverPreview')

  const inputRef = useRef<HTMLInputElement>(null)
  const inputRowRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }))

  const {
    visibleAssignedIds,
    showInlinePill,
    selectedElement,
    selectorModel,
    candidatesById,
    isEmptyQuery,
    filteredSuggestions,
    recentIds,
    frequentIds,
    remainingCandidates,
    shouldShowAllSection,
    surfacedCount,
    flatNavIds,
    highlightedClassId,
    highlightedSelectorItem,
    highlightedSelectorId,
    canCreateNew,
    hasSubmittableQuery,
    submitTooltip,
    exactMatchedClass,
    exactMatchAlreadyAssigned,
    exactMatchedSelectorItem,
    createIntent,
    selectorSuggestions,
    hasSuggestionRows,
  } = useClassPickerDerivedState({
    site,
    node,
    nodeId,
    activeClassId,
    inlineStyleEditing,
    query,
    highlightedIndex,
  })

  const contextClass = contextMenu ? site?.styleRules[contextMenu.classId] ?? null : null
  const contextClassIndex = contextMenu ? visibleAssignedIds.indexOf(contextMenu.classId) : -1

  const openSuggestions = () => dispatchUi({ type: 'openSuggestions' })

  const handleAddExisting = (classId: string) => {
    addNodeClass(nodeId, classId)
    setActiveClass(classId)
    clearPreviewNodeClass(nodeId, classId)
    recordClassUsage(classId)
    dispatchUi({ type: 'resetAfterSubmit' })
  }

  const handleSelectAmbient = (item: SelectorSuggestionItem) => {
    if (item.disabled) return
    setActiveClass(item.rule.id)
    dispatchUi({ type: 'resetAfterSubmit' })
  }

  const handleCreateAndAdd = () => {
    const intent = classifySelectorCreateInput(query)
    if (intent.kind === 'empty') return
    try {
      if (intent.kind === 'class') {
        const newClass = createClass(intent.name)
        addNodeClass(nodeId, newClass.id)
        setActiveClass(newClass.id)
        clearPreviewNodeClass(nodeId)
        recordClassUsage(newClass.id)
      } else {
        const newRule = createAmbientRule({ selector: intent.selector })
        const createdModel = deriveSelectorPickerModel({
          rules: { [newRule.id]: newRule },
          node,
          selectedElement,
          activeRuleId: null,
        })
        const createdSuggestion = createdModel.suggestions[0]
        if (createdSuggestion && !createdSuggestion.disabled) setActiveClass(newRule.id)
      }
      dispatchUi({ type: 'resetAfterSubmit' })
    } catch (err) {
      dispatchUi({
        type: 'setCreateError',
        message: getErrorMessage(err, 'Unable to create selector'),
      })
    }
  }

  const submitQuery = () => {
    if (highlightedSelectorItem) {
      handleSelectAmbient(highlightedSelectorItem)
      return
    }
    if (highlightedClassId) {
      handleAddExisting(highlightedClassId)
      return
    }
    if (isEmptyQuery) return
    if (exactMatchedClass) {
      if (!exactMatchAlreadyAssigned) handleAddExisting(exactMatchedClass.id)
      return
    }
    if (exactMatchedSelectorItem) {
      handleSelectAmbient(exactMatchedSelectorItem)
      return
    }
    if (canCreateNew) handleCreateAndAdd()
  }

  const previewClass = (classId: string) => {
    if (!hoverPreviewEnabled) return
    setPreviewNodeClass(nodeId, classId)
  }

  const clearPreviewClass = (classId: string) => {
    clearPreviewNodeClass(nodeId, classId)
  }

  useEffect(() => {
    if (!hoverPreviewEnabled) clearPreviewNodeClass(nodeId)
  }, [hoverPreviewEnabled, clearPreviewNodeClass, nodeId])

  useEffect(() => () => clearPreviewNodeClass(nodeId), [clearPreviewNodeClass, nodeId])

  useEffect(() => {
    const highlightedSuggestionId = highlightedClassId ?? highlightedSelectorId
    if (!highlightedSuggestionId) return
    const el = document.querySelector<HTMLElement>(
      `[data-selector-suggestion-id="${cssAttrSelectorValue(highlightedSuggestionId)}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlightedClassId, highlightedSelectorId])

  const closeSuggestions = () => {
    clearPreviewNodeClass(nodeId)
    dispatchUi({ type: 'closeSuggestions' })
  }

  const closeContextMenu = () => {
    dispatchUi({ type: 'setContextMenu', contextMenu: null })
  }

  const openClassContextMenu = (classId: string, event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dispatchUi({
      type: 'setContextMenu',
      contextMenu: { x: event.clientX, y: event.clientY, classId },
    })
  }

  const openKeyboardClassContextMenu = (classId: string, event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    dispatchUi({
      type: 'setContextMenu',
      contextMenu: { ...keyboardMenuPosition(event.currentTarget), classId },
    })
  }

  const handleRename = (name: string) => {
    if (!renameTarget) return
    renameClass(renameTarget.id, name)
    dispatchUi({ type: 'setRenameTarget', renameTarget: null })
  }

  const removeAssignedClass = (classId: string) => {
    if (activeClassId === classId) setActiveClass(null)
    removeNodeClass(nodeId, classId)
  }

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submitQuery()
      return
    }
    if (e.key === 'Escape') {
      closeSuggestions()
      return
    }
    if (e.key === 'ArrowDown') {
      if (flatNavIds.length === 0) return
      e.preventDefault()
      dispatchUi({ type: 'moveHighlight', direction: 'next', count: flatNavIds.length })
      return
    }
    if (e.key === 'ArrowUp') {
      if (flatNavIds.length === 0) return
      e.preventDefault()
      dispatchUi({ type: 'moveHighlight', direction: 'previous', count: flatNavIds.length })
    }
  }

  return (
    <div className={styles.container}>
      <PillContextMenuPortal
        contextMenu={contextMenu}
        contextClass={contextClass}
        contextClassIndex={contextClassIndex}
        visibleAssignedCount={visibleAssignedIds.length}
        onClose={closeContextMenu}
        onEdit={(c) => setActiveClass(c.id)}
        onRename={(c) => dispatchUi({ type: 'setRenameTarget', renameTarget: c })}
        onMove={(c, direction) => reorderNodeClass(nodeId, c.id, direction)}
        onRemove={(c) => removeAssignedClass(c.id)}
      />

      {renameTarget && (
        <ClassRenameDialog
          initialValue={renameTarget.name}
          onCancel={() => dispatchUi({ type: 'setRenameTarget', renameTarget: null })}
          onRename={handleRename}
        />
      )}

      <SelectorInputArea
        inputRowRef={inputRowRef}
        inputRef={inputRef}
        trailingAction={trailingAction}
        query={query}
        hasSubmittableQuery={hasSubmittableQuery}
        submitTooltip={submitTooltip}
        onQueryChange={(nextQuery) => dispatchUi({ type: 'inputChanged', query: nextQuery })}
        onFocus={openSuggestions}
        onKeyDown={handleSearchKeyDown}
        onSubmit={submitQuery}
      >
        <SelectorSuggestionsPortal
          visibility={{
            open: showSuggestions,
            hasRows: hasSuggestionRows,
            canCreate: canCreateNew,
            emptyQuery: isEmptyQuery,
          }}
          sections={{ showAllHeader: shouldShowAllSection, surfacedCount }}
          inputRowRef={inputRowRef}
          inputRef={inputRef}
          recentIds={recentIds}
          frequentIds={frequentIds}
          remainingCandidates={remainingCandidates}
          selectorSuggestions={selectorSuggestions}
          candidatesById={candidatesById}
          filteredSuggestions={filteredSuggestions}
          highlightedClassId={highlightedClassId}
          highlightedSelectorId={highlightedSelectorId}
          createIntentKind={createIntent.kind}
          query={query}
          onClose={closeSuggestions}
          onPick={handleAddExisting}
          onPickSelector={handleSelectAmbient}
          onCreateAndAdd={handleCreateAndAdd}
          previewClass={previewClass}
          clearPreviewClass={clearPreviewClass}
        />
      </SelectorInputArea>
      {createError && <p role="alert" className={styles.errorText}>{createError}</p>}

      <SelectorPillStack
        pills={selectorModel.pills}
        showInlinePill={showInlinePill}
        inlineStyleEditing={inlineStyleEditing}
        onToggleRule={(ruleId, active) => setActiveClass(active ? null : ruleId)}
        onClassContextMenu={openClassContextMenu}
        onKeyboardClassContextMenu={openKeyboardClassContextMenu}
        onRemoveClass={removeAssignedClass}
        onToggleInline={() => setInlineStyleEditing(!inlineStyleEditing)}
        onClearInline={() => {
          clearNodeInlineStyles(nodeId)
          setInlineStyleEditing(false)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// PillContextMenuPortal — portals the right-click menu over a single pill.
//
// Render the menu only when both `contextMenu` (the open-state record) and
// `contextClass` (the class it points at) are present. Each action takes the
// `cls` so the parent doesn't re-derive it; the menu always closes after the
// caller's action runs (so callers don't have to remember to call onClose).
// ---------------------------------------------------------------------------

interface PillContextMenuPortalProps {
  contextMenu: ClassContextMenuState | null
  contextClass: StyleRule | null
  contextClassIndex: number
  visibleAssignedCount: number
  onClose: () => void
  onEdit: (cls: StyleRule) => void
  onRename: (cls: StyleRule) => void
  onMove: (cls: StyleRule, direction: 'up' | 'down') => void
  onRemove: (cls: StyleRule) => void
}

function PillContextMenuPortal({
  contextMenu,
  contextClass,
  contextClassIndex,
  visibleAssignedCount,
  onClose,
  onEdit,
  onRename,
  onMove,
  onRemove,
}: PillContextMenuPortalProps): React.ReactPortal | null {
  if (!contextMenu || !contextClass) return null
  const locked = isGeneratedClassLocked(contextClass)
  const runAndClose = (fn: () => void) => () => {
    fn()
    onClose()
  }
  return createPortal(
    <ClassPillContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      canMoveUp={contextClassIndex > 0}
      canMoveDown={contextClassIndex >= 0 && contextClassIndex < visibleAssignedCount - 1}
      locked={locked}
      onClose={onClose}
      onEdit={runAndClose(() => onEdit(contextClass))}
      onRename={runAndClose(() => {
        if (!locked) onRename(contextClass)
      })}
      onMoveUp={runAndClose(() => onMove(contextClass, 'up'))}
      onMoveDown={runAndClose(() => onMove(contextClass, 'down'))}
      onRemove={runAndClose(() => onRemove(contextClass))}
    />,
    document.body,
  )
}

function ClassPillContextMenu({
  x,
  y,
  canMoveUp,
  canMoveDown,
  onClose,
  onEdit,
  onRename,
  onMoveUp,
  onMoveDown,
  onRemove,
  locked,
}: {
  x: number
  y: number
  canMoveUp: boolean
  canMoveDown: boolean
  locked: boolean
  onClose: () => void
  onEdit: () => void
  onRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  return (
    <ContextMenu x={x} y={y} ariaLabel="Class actions" onClose={onClose}>
      <ContextMenuItem ref={firstItemRef} onClick={onEdit}>
        <span aria-hidden="true"><EditSolidIcon size={13} /></span>
        {locked ? 'View utility' : 'Edit styles'}
      </ContextMenuItem>
      <ContextMenuItem disabled={locked} onClick={onRename}>
        <span aria-hidden="true"><EditSolidIcon size={13} /></span>
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
        <span aria-hidden="true"><ChevronUpIcon size={13} /></span>
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
        <span aria-hidden="true"><ChevronDownIcon size={13} /></span>
        Move down
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger onClick={onRemove}>
        <span aria-hidden="true"><CloseIcon size={13} /></span>
        Remove from this element
      </ContextMenuItem>
    </ContextMenu>
  )
}

const CLASS_RENAME_FORM_ID = 'class-rename-form'

function ClassRenameDialog({
  initialValue,
  onCancel,
  onRename,
}: {
  initialValue: string
  onCancel: () => void
  onRename: (name: string) => void
}) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedName = name.trim()
  const nameInputId = useId()

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedName) return

    try {
      onRename(trimmedName)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Unable to rename class')
    }
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Rename selector"
      size="sm"
      initialFocusRef={inputRef}
      footer={
        <>
          <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form={CLASS_RENAME_FORM_ID}
            disabled={!trimmedName}
          >
            Save
          </Button>
        </>
      }
    >
      <form id={CLASS_RENAME_FORM_ID} className={dialogStyles.form} onSubmit={handleSubmit}>
        <div className={dialogStyles.field}>
          <label htmlFor={nameInputId} className={dialogStyles.label}>Name</label>
          <Input
            id={nameInputId}
            ref={inputRef}
            fieldSize="sm"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setError(null)
            }}
            aria-label="Class name"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {error && <p role="alert" className={dialogStyles.errorText}>{error}</p>}
      </form>
    </Dialog>
  )
}
