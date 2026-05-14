import { useEffect, useId, useState } from 'react'
import { createHeadingBlock, createParagraphBlock, serializeMarkdownBlocks } from '@core/content/markdown'
import type {
  ContentCollection,
  ContentEntry,
  ContentEntryStatus,
  UpdateContentCollectionInput,
} from '@core/content/schemas'
import { useEditorStore } from '@site/store/store'
import { HeadingIcon } from 'pixel-art-icons/icons/heading'
import { ImagesIcon } from 'pixel-art-icons/icons/images'
import { TextPlusIcon } from 'pixel-art-icons/icons/text-plus'
import { AdminCanvasLayout } from '@admin/layouts'
import { MediaExplorerPanel } from '@site/panels/MediaExplorerPanel'
import type { CanvasNotchAction } from '@site/canvas/CanvasNotch'
import { ContentDocumentCanvas } from './components/ContentDocumentCanvas/ContentDocumentCanvas'
import { ContentCollectionCreateDialog } from './components/ContentCollectionCreateDialog/ContentCollectionCreateDialog'
import { ContentExplorerPanel } from './components/ContentExplorerPanel/ContentExplorerPanel'
import { ContentSettingsPanel } from './components/ContentSettingsPanel/ContentSettingsPanel'
import { ContentSidebar, type ContentPanelId } from './components/ContentSidebar/ContentSidebar'
import { ContentToolbar } from './components/ContentToolbar/ContentToolbar'
import { MediaPickerDialog } from './components/MediaPickerDialog/MediaPickerDialog'
import { useContentEntryDraft } from './hooks/useContentEntryDraft'
import { useContentMediaPicker } from './hooks/useContentMediaPicker'
import { useContentWorkspace } from './hooks/useContentWorkspace'
import { publicContentPath } from './utils/contentEntryUtils'
import { CORE_CAPABILITIES } from '@core/capabilities'
import type { CmsCurrentUser } from '@core/persistence'
import { useCurrentAdminUser } from '@admin/sessionContext'
import {
  canCreateContent,
  canEditAnyContent,
  canEditContentEntry,
  canManageContentCollections,
  canPublishContentEntry,
} from '@admin/access'

const UNRESTRICTED_ADMIN_USER: CmsCurrentUser = {
  id: 'admin-ui-unrestricted',
  email: 'admin-ui-unrestricted@example.invalid',
  displayName: 'Admin',
  status: 'active',
  role: {
    id: 'admin-ui-unrestricted',
    slug: 'admin-ui-unrestricted',
    name: 'Admin',
    description: '',
    isSystem: true,
    capabilities: [...CORE_CAPABILITIES],
  },
  capabilities: [...CORE_CAPABILITIES],
  lastLoginAt: null,
  failedLoginCount: 0,
  lockedUntil: null,
  avatarMediaId: null,
  avatarUrl: null,
  gravatarHash: '',
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
}

export function ContentPage() {
  const [activeContentPanel, setActiveContentPanel] = useState<ContentPanelId | null>('content')
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false)
  // These are monotonic counters used purely as "do the action now" pings:
  // bumping them re-runs the focus effect inside the canvas / body editor.
  const [focusTitleSignal, setFocusTitleSignal] = useState(0)
  const [focusBodySignal, setFocusBodySignal] = useState(0)
  const slugId = useId()
  const seoTitleId = useId()
  const seoDescriptionId = useId()

  const currentUser = useCurrentAdminUser()
  const permissionUser = currentUser ?? UNRESTRICTED_ADMIN_USER
  const canReassignAuthor = canEditAnyContent(permissionUser)
  const canCreateEntries = canCreateContent(permissionUser)
  const canManageCollections = canManageContentCollections(permissionUser)
  const workspace = useContentWorkspace({ loadAuthors: canReassignAuthor })
  const draft = useContentEntryDraft({
    selectedEntry: workspace.selectedEntry,
    updateSelectedEntry: workspace.updateSelectedEntry,
    setError: workspace.setError,
  })
  const mediaPicker = useContentMediaPicker({
    featuredMediaId: draft.featuredMediaId,
    setFeaturedMediaId: draft.setFeaturedMediaId,
    setBlocks: draft.setBlocks,
  })

  const publicPath = workspace.selectedCollection && draft.slug
    ? publicContentPath(workspace.selectedCollection.routeBase, draft.slug)
    : ''
  const canEditSelectedEntry = canEditContentEntry(permissionUser, workspace.selectedEntry)
  const canPublishSelectedEntry = canPublishContentEntry(permissionUser, workspace.selectedEntry)

  useEffect(() => {
    useEditorStore.getState().setPropertiesPanel({ collapsed: false })
  }, [])

  async function handleCreateEntry() {
    if (!canCreateEntries) {
      workspace.setError('Your role cannot create content entries')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entry = await workspace.createUntitledEntry()
      // `createUntitledEntry` hands us an entry whose title is empty so the
      // editor's title field renders as a placeholder rather than
      // pre-filling "Untitled" (the server-side fallback that the sidebar
      // list still shows). The user can type their real title immediately.
      draft.applySelectedEntry(entry)
      draft.setSaveMessage('saved')
      setFocusTitleSignal((n) => n + 1)
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not create entry')
    }
  }

  async function handleMoveEntryCollection(collectionId: string) {
    if (!canEditSelectedEntry) {
      workspace.setError('Your role cannot move this entry')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entry = await workspace.moveSelectedEntryToCollection(collectionId)
      if (entry) draft.applySelectedEntry(entry)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not move entry')
    }
  }

  async function handleUpdateEntryAuthor(authorUserId: string) {
    const entry = workspace.selectedEntry
    if (!entry || entry.authorUserId === authorUserId) return
    if (!canReassignAuthor) {
      workspace.setError('Your role cannot reassign authors')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const updatedEntry = await workspace.updateEntryAuthor(entry, authorUserId)
      draft.applySelectedEntry(updatedEntry)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not update author')
    }
  }

  async function handleUpdateCollection(
    collection: ContentCollection,
    input: UpdateContentCollectionInput,
  ) {
    if (!canManageCollections) {
      workspace.setError('Your role cannot manage content collections')
      return
    }
    workspace.setError(null)
    try {
      await workspace.updateCollection(collection.id, input)
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not update collection')
      throw err
    }
  }

  async function handleDeleteCollection(collection: ContentCollection) {
    if (!canManageCollections) {
      workspace.setError('Your role cannot manage content collections')
      return
    }
    workspace.setError(null)
    try {
      await workspace.deleteCollection(collection.id)
      if (workspace.selectedCollectionId === collection.id) {
        draft.applySelectedEntry(null)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not delete collection')
      throw err
    }
  }

  async function handleRenameEntry(
    entry: ContentEntry,
    input: Pick<ContentEntry, 'title' | 'slug'>,
  ) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entrySnapshot = workspace.selectedEntry?.id === entry.id
        ? {
            ...entry,
            bodyMarkdown: serializeMarkdownBlocks(draft.blocks),
            featuredMediaId: draft.featuredMediaId,
            seoTitle: draft.seoTitle,
            seoDescription: draft.seoDescription,
          }
        : entry
      const updatedEntry = await workspace.renameEntry(entrySnapshot, input)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(updatedEntry)
      }
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not rename entry')
      throw err
    }
  }

  async function handleDeleteEntry(entry: ContentEntry) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot delete this entry')
      return
    }
    workspace.setError(null)
    try {
      const nextEntry = await workspace.deleteEntry(entry)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(nextEntry)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not delete entry')
      throw err
    }
  }

  async function handleDuplicateEntry(entry: ContentEntry) {
    if (!canCreateEntries) {
      workspace.setError('Your role cannot create content entries')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      // If duplicating the currently-edited entry, persist the in-memory
      // draft first so the duplicate captures the latest unsaved edits.
      // Otherwise we'd silently copy the last-saved version of the body
      // which is confusing — the user clicked duplicate on the row they're
      // visibly editing.
      const source = workspace.selectedEntry?.id === entry.id
        ? {
            ...entry,
            bodyMarkdown: serializeMarkdownBlocks(draft.blocks),
            featuredMediaId: draft.featuredMediaId,
            seoTitle: draft.seoTitle,
            seoDescription: draft.seoDescription,
            title: draft.title || entry.title,
          }
        : entry
      const duplicated = await workspace.duplicateEntry(source)
      draft.applySelectedEntry(duplicated)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not duplicate entry')
      throw err
    }
  }

  async function handleMoveEntryToCollection(entry: ContentEntry, collectionId: string) {
    if (entry.collectionId === collectionId) return
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot move this entry')
      return
    }
    workspace.setError(null)
    try {
      const updatedEntry = await workspace.moveEntryToCollection(entry, collectionId)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(updatedEntry)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not move entry')
      throw err
    }
  }

  async function handlePublishEntry(entry: ContentEntry) {
    if (!canPublishContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot publish this entry')
      return
    }

    if (workspace.selectedEntry?.id === entry.id) {
      if (canEditContentEntry(permissionUser, entry)) {
        await draft.handlePublish()
      } else {
        draft.setSaveMessage('publishing')
        workspace.setError(null)
        try {
          const published = await workspace.publishEntry(entry)
          draft.applySelectedEntry(published)
          draft.setSaveMessage('published')
        } catch (err) {
          draft.setSaveMessage('error')
          workspace.setError(err instanceof Error ? err.message : 'Could not publish entry')
        }
      }
      return
    }

    workspace.setError(null)
    try {
      await workspace.publishEntry(entry)
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not publish entry')
      throw err
    }
  }

  async function handleStatusChange(status: ContentEntryStatus) {
    const entry = workspace.selectedEntry
    if (!entry || status === entry.status) return

    if (status === 'published') {
      await handlePublishEntry(entry)
      return
    }

    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }

    await draft.handleStatusChange(status)
  }

  async function handleConvertEntryToDraft(entry: ContentEntry) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }
    if (workspace.selectedEntry?.id === entry.id) {
      await draft.handleStatusChange('draft')
      return
    }

    workspace.setError(null)
    try {
      await workspace.updateEntryStatus(entry, 'draft')
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not convert entry to draft')
      throw err
    }
  }

  function handleSelectEntry(entry: Parameters<typeof workspace.selectEntry>[0]) {
    workspace.selectEntry(entry)
    draft.applySelectedEntry(entry)
  }

  const notchActions: CanvasNotchAction[] = [
    {
      id: 'heading',
      label: 'Heading',
      icon: HeadingIcon,
      onClick: () => draft.setBlocks((current) => [...current, createHeadingBlock()]),
    },
    {
      id: 'text',
      label: 'Text',
      icon: TextPlusIcon,
      onClick: () => draft.setBlocks((current) => [...current, createParagraphBlock()]),
    },
    {
      id: 'media',
      label: 'Media',
      icon: ImagesIcon,
      onClick: () => void mediaPicker.openMediaPicker('media'),
    },
  ]

  return (
    <>
      <AdminCanvasLayout
        workspace="content"
        toolbarRightSlot={(
          <ContentToolbar
            contentLoading={workspace.contentLoading}
            saveMessage={draft.saveMessage}
            isDirty={draft.isDirty}
            selectedEntry={workspace.selectedEntry}
            selectedCollection={workspace.selectedCollection}
            publicPath={publicPath}
            canSaveDraft={canEditSelectedEntry}
            canPublish={canPublishSelectedEntry}
            onSaveDraft={() => void draft.handleSaveDraft()}
            onPublish={() => {
              if (workspace.selectedEntry) void handlePublishEntry(workspace.selectedEntry)
            }}
          />
        )}
        contentSidebar={(
          <ContentSidebar
            activePanel={activeContentPanel}
            onActivePanelChange={setActiveContentPanel}
            contentPanel={(
              <ContentExplorerPanel
                loading={workspace.contentLoading}
                error={workspace.error}
                collections={workspace.collections}
                entries={workspace.entries}
                selectedCollection={workspace.selectedCollection}
                selectedCollectionId={workspace.selectedCollectionId}
                selectedEntryId={workspace.selectedEntry?.id ?? null}
                canCreateCollection={canManageCollections}
                canCreateEntry={canCreateEntries}
                canManageCollections={canManageCollections}
                canEditEntry={(entry) => canEditContentEntry(permissionUser, entry)}
                canPublishEntry={(entry) => canPublishContentEntry(permissionUser, entry)}
                onSelectCollection={workspace.selectCollection}
                onSelectEntry={handleSelectEntry}
                onCreateCollection={() => setCollectionDialogOpen(true)}
                onCreateEntry={() => void handleCreateEntry()}
                onUpdateCollection={handleUpdateCollection}
                onDeleteCollection={handleDeleteCollection}
                onRenameEntry={handleRenameEntry}
                onPublishEntry={handlePublishEntry}
                onConvertEntryToDraft={handleConvertEntryToDraft}
                onDeleteEntry={handleDeleteEntry}
                onDuplicateEntry={handleDuplicateEntry}
                onMoveEntryToCollection={handleMoveEntryToCollection}
                onClose={() => setActiveContentPanel(null)}
              />
            )}
            mediaPanel={(
              <MediaExplorerPanel
                variant="docked"
                open={activeContentPanel === 'media'}
                onOpenChange={(open) => setActiveContentPanel(open ? 'media' : null)}
              />
            )}
          />
        )}
        contentCanvas={(
          <ContentDocumentCanvas
            selectedEntry={workspace.selectedEntry}
            selectedCollection={workspace.selectedCollection}
            loading={workspace.contentLoading}
            title={draft.title}
            blocks={draft.blocks}
            notchActions={notchActions}
            canEditEntry={canEditSelectedEntry}
            canCreateEntry={canCreateEntries}
            focusTitleSignal={focusTitleSignal}
            focusBodySignal={focusBodySignal}
            onTitleChange={draft.setTitle}
            onTitleEnter={() => setFocusBodySignal((n) => n + 1)}
            onBlocksChange={draft.setBlocks}
            onRequestMedia={(blockId) => void mediaPicker.openMediaPicker('media', blockId)}
            onCreateEntry={() => void handleCreateEntry()}
          />
        )}
        contentRightPanel={workspace.selectedEntry ? (
          <ContentSettingsPanel
            selectedEntry={workspace.selectedEntry}
            authors={workspace.authors}
            authorsLoading={workspace.authorsLoading}
            collections={workspace.collections}
            selectedCollection={workspace.selectedCollection}
            loading={workspace.contentLoading}
            slug={draft.slug}
            slugId={slugId}
            seoTitle={draft.seoTitle}
            seoTitleId={seoTitleId}
            seoDescription={draft.seoDescription}
            seoDescriptionId={seoDescriptionId}
            publicPath={publicPath}
            mediaAssets={mediaPicker.mediaAssets}
            mediaLoading={mediaPicker.mediaLoading}
            mediaError={mediaPicker.mediaError}
            featuredMediaId={draft.featuredMediaId}
            featuredMediaAsset={mediaPicker.featuredMediaAsset}
            onCollectionChange={(collectionId) => void handleMoveEntryCollection(collectionId)}
            onAuthorChange={(authorUserId) => void handleUpdateEntryAuthor(authorUserId)}
            onSlugChange={draft.setSlug}
            onSeoTitleChange={draft.setSeoTitle}
            onSeoDescriptionChange={draft.setSeoDescription}
            onStatusChange={(status) => void handleStatusChange(status)}
            onChooseFeaturedMedia={() => void mediaPicker.openMediaPicker('featured')}
            onClearFeaturedMedia={() => draft.setFeaturedMediaId(null)}
            canEditEntry={canEditSelectedEntry}
            canPublishEntry={canPublishSelectedEntry}
            canChangeAuthor={canReassignAuthor}
          />
        ) : undefined}
      />

      {mediaPicker.mediaPicker && (
        <MediaPickerDialog
          mediaPicker={mediaPicker.mediaPicker}
          mediaLoading={mediaPicker.mediaLoading}
          mediaError={mediaPicker.mediaError}
          mediaAssets={mediaPicker.filteredMediaAssets}
          onInsertMedia={mediaPicker.insertMedia}
          onClose={mediaPicker.closeMediaPicker}
        />
      )}

      {collectionDialogOpen && (
        <ContentCollectionCreateDialog
          onCancel={() => setCollectionDialogOpen(false)}
          onCreate={async (input) => {
            if (!canManageCollections) {
              workspace.setError('Your role cannot manage content collections')
              setCollectionDialogOpen(false)
              return
            }
            await workspace.createCollection(input)
            setCollectionDialogOpen(false)
          }}
        />
      )}
    </>
  )
}
