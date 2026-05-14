import { useCallback, useEffect, useState } from 'react'
import {
  createCmsContentCollection,
  createCmsContentEntry,
  deleteCmsContentCollection,
  deleteCmsContentEntry,
  listCmsContentAuthors,
  listCmsContentCollections,
  listCmsContentEntries,
  publishCmsContentEntry,
  saveCmsContentEntryDraft,
  updateCmsContentEntryAuthor,
  updateCmsContentEntryCollection,
  updateCmsContentCollection,
  updateCmsContentEntryStatus,
} from '@core/persistence'
import { useEditorStore } from '@site/store/store'
import type {
  ContentCollection,
  ContentEntry,
  ContentEntryStatus,
  ContentUserReference,
  CreateContentCollectionInput,
  UpdateContentCollectionInput,
} from '@core/content/schemas'
import { updateEntryList } from '@content/utils/contentEntryUtils'

interface UseContentWorkspaceOptions {
  loadAuthors?: boolean
}

export function useContentWorkspace({
  loadAuthors: shouldLoadAuthors = true,
}: UseContentWorkspaceOptions = {}) {
  const [collections, setCollections] = useState<ContentCollection[]>([])
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [authors, setAuthors] = useState<ContentUserReference[]>([])
  const [authorsLoading, setAuthorsLoading] = useState(true)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<ContentEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId) ?? null
  const contentLoading = loading || entriesLoading

  const selectEntry = useCallback((entry: ContentEntry | null) => {
    setSelectedEntry(entry)
    useEditorStore.getState().setPropertiesPanel({ collapsed: false })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fetchAuthors() {
      if (!shouldLoadAuthors) {
        setAuthors([])
        setAuthorsLoading(false)
        return
      }
      setAuthorsLoading(true)
      try {
        const nextAuthors = await listCmsContentAuthors()
        if (!cancelled) setAuthors(nextAuthors)
      } catch (_err) {
        // Author reassignment is optional; keep the editor usable if this
        // auxiliary candidate list is unavailable.
        if (!cancelled) setAuthors([])
      } finally {
        if (!cancelled) setAuthorsLoading(false)
      }
    }

    void fetchAuthors()
    return () => { cancelled = true }
  }, [shouldLoadAuthors])

  const updateSelectedEntry = useCallback((entry: ContentEntry) => {
    setSelectedEntry(entry)
    setEntries((current) => updateEntryList(current, entry))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadCollections() {
      setLoading(true)
      setEntriesLoading(true)
      setError(null)
      try {
        const nextCollections = await listCmsContentCollections()
        if (cancelled) return
        const fallbackCollectionId = nextCollections[0]?.id ?? null
        setCollections(nextCollections)
        setEntriesLoading(Boolean(fallbackCollectionId))
        setSelectedCollectionId((current) => current ?? fallbackCollectionId)
      } catch (err) {
        if (!cancelled) {
          setEntriesLoading(false)
          setError(err instanceof Error ? err.message : 'Could not load content')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadCollections()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedCollectionId) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setEntriesLoading(false)
      })
      return () => { cancelled = true }
    }
    const collectionId = selectedCollectionId
    let cancelled = false

    async function loadEntries() {
      setEntriesLoading(true)
      setError(null)
      try {
        const nextEntries = await listCmsContentEntries(collectionId)
        if (cancelled) return
        setEntries(nextEntries)
        setSelectedEntry((current) => {
          if (!current || current.collectionId !== collectionId) {
            useEditorStore.getState().setPropertiesPanel({ collapsed: false })
            return nextEntries[0] ?? null
          }
          return current
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load entries')
      } finally {
        if (!cancelled) setEntriesLoading(false)
      }
    }

    void loadEntries()
    return () => { cancelled = true }
  }, [selectedCollectionId])

  const selectCollection = useCallback((collectionId: string) => {
    if (collectionId === selectedCollectionId) return
    setEntriesLoading(true)
    setSelectedCollectionId(collectionId)
  }, [selectedCollectionId])

  const createUntitledEntry = useCallback(async () => {
    if (!selectedCollection) return null
    const nextSlug = entries.length === 0 ? 'untitled' : `untitled-${entries.length + 1}`
    const entry = await createCmsContentEntry(selectedCollection.id, {
      title: 'Untitled',
      slug: nextSlug,
    })
    // Keep "Untitled" stored on the server + visible in the sidebar list, but
    // hand the editor a draft view with an empty title so the title field
    // shows its placeholder instead of pre-filling "Untitled". The user can
    // start typing their real title immediately; on save the draft is
    // persisted with whatever they entered (falling back to "Untitled" on
    // the server side if they leave it blank).
    const draftEntry: ContentEntry = { ...entry, title: '' }
    setEntries((current) => updateEntryList(current, entry))
    selectEntry(draftEntry)
    return draftEntry
  }, [entries.length, selectEntry, selectedCollection])

  const duplicateEntry = useCallback(async (entry: ContentEntry) => {
    setError(null)
    // Pick a unique slug within the same collection. We re-list against the
    // current `entries` state which is the freshest local snapshot — the
    // server is authoritative for true uniqueness, but contention on slug
    // generation here is virtually nil for the editor flow and the server
    // returns a typed slug_conflict error if a parallel session collides.
    const existingSlugs = new Set(entries.map((candidate) => candidate.slug))
    const baseSlug = `${entry.slug}-copy`
    let slug = baseSlug
    let suffix = 2
    while (existingSlugs.has(slug)) {
      slug = `${baseSlug}-${suffix}`
      suffix += 1
    }
    const duplicated = await createCmsContentEntry(entry.collectionId, {
      title: `${entry.title} (copy)`,
      slug,
      bodyMarkdown: entry.bodyMarkdown,
      featuredMediaId: entry.featuredMediaId,
      seoTitle: entry.seoTitle,
      seoDescription: entry.seoDescription,
    })
    setEntries((current) => updateEntryList(current, duplicated))
    selectEntry(duplicated)
    return duplicated
  }, [entries, selectEntry])

  const createCollection = useCallback(async (input: CreateContentCollectionInput) => {
    setError(null)
    setEntriesLoading(true)
    const collection = await createCmsContentCollection(input)
    setCollections((current) => [...current, collection])
    setEntries([])
    setSelectedCollectionId(collection.id)
    selectEntry(null)
    return collection
  }, [selectEntry])

  const updateCollection = useCallback(async (
    collectionId: string,
    input: UpdateContentCollectionInput,
  ) => {
    setError(null)
    const collection = await updateCmsContentCollection(collectionId, input)
    setCollections((current) => current.map((candidate) =>
      candidate.id === collection.id ? collection : candidate
    ))
    return collection
  }, [])

  const deleteCollection = useCallback(async (collectionId: string) => {
    setError(null)
    await deleteCmsContentCollection(collectionId)

    const nextCollections = collections.filter((collection) => collection.id !== collectionId)
    const nextSelectedCollectionId = selectedCollectionId === collectionId
      ? nextCollections[0]?.id ?? null
      : selectedCollectionId
    setCollections(nextCollections)

    if (selectedCollectionId === collectionId) {
      setSelectedCollectionId(nextSelectedCollectionId)
      setEntries([])
      setEntriesLoading(Boolean(nextSelectedCollectionId))
      selectEntry(null)
    }
  }, [collections, selectEntry, selectedCollectionId])

  const renameEntry = useCallback(async (
    entry: ContentEntry,
    input: Pick<ContentEntry, 'title' | 'slug'>,
  ) => {
    setError(null)
    const updatedEntry = await saveCmsContentEntryDraft(entry.id, {
      title: input.title,
      slug: input.slug,
      bodyMarkdown: entry.bodyMarkdown,
      featuredMediaId: entry.featuredMediaId,
      seoTitle: entry.seoTitle,
      seoDescription: entry.seoDescription,
    })
    setEntries((current) => updateEntryList(current, updatedEntry))
    if (selectedEntry?.id === entry.id) selectEntry(updatedEntry)
    return updatedEntry
  }, [selectEntry, selectedEntry?.id])

  const deleteEntry = useCallback(async (entry: ContentEntry) => {
    setError(null)
    await deleteCmsContentEntry(entry.id)

    const nextEntries = entries.filter((candidate) => candidate.id !== entry.id)
    const nextSelectedEntry = selectedEntry?.id === entry.id
      ? nextEntries[0] ?? null
      : selectedEntry
    setEntries(nextEntries)

    if (selectedEntry?.id === entry.id) {
      selectEntry(nextSelectedEntry)
    }
    return nextSelectedEntry
  }, [entries, selectEntry, selectedEntry])

  const publishEntry = useCallback(async (entry: ContentEntry) => {
    setError(null)
    const updatedEntry = await publishCmsContentEntry(entry.id)
    setEntries((current) => updateEntryList(current, updatedEntry))
    if (selectedEntry?.id === entry.id) selectEntry(updatedEntry)
    return updatedEntry
  }, [selectEntry, selectedEntry?.id])

  const updateEntryStatus = useCallback(async (
    entry: ContentEntry,
    status: Exclude<ContentEntryStatus, 'published'>,
  ) => {
    setError(null)
    const updatedEntry = await updateCmsContentEntryStatus(entry.id, status)
    setEntries((current) => updateEntryList(current, updatedEntry))
    if (selectedEntry?.id === entry.id) selectEntry(updatedEntry)
    return updatedEntry
  }, [selectEntry, selectedEntry?.id])

  const updateEntryAuthor = useCallback(async (
    entry: ContentEntry,
    authorUserId: string,
  ) => {
    if (entry.authorUserId === authorUserId) return entry
    setError(null)
    const updatedEntry = await updateCmsContentEntryAuthor(entry.id, authorUserId)
    setEntries((current) => updateEntryList(current, updatedEntry))
    if (selectedEntry?.id === entry.id) selectEntry(updatedEntry)
    return updatedEntry
  }, [selectEntry, selectedEntry?.id])

  const moveEntryToCollection = useCallback(async (
    entry: ContentEntry,
    collectionId: string,
  ) => {
    if (entry.collectionId === collectionId) return entry
    setError(null)
    const updatedEntry = await updateCmsContentEntryCollection(entry.id, collectionId)
    // Active collection view: the moved entry no longer belongs here.
    if (entry.collectionId === selectedCollectionId) {
      setEntries((current) => current.filter((candidate) => candidate.id !== entry.id))
    }
    // Active collection view: it may already be the destination if the user
    // is viewing it. In that case the entry should appear in the list.
    if (collectionId === selectedCollectionId) {
      setEntries((current) => updateEntryList(current, updatedEntry))
    }
    if (selectedEntry?.id === entry.id) selectEntry(updatedEntry)
    return updatedEntry
  }, [selectEntry, selectedCollectionId, selectedEntry?.id])

  const moveSelectedEntryToCollection = useCallback(async (collectionId: string) => {
    if (!selectedEntry || selectedEntry.collectionId === collectionId) return selectedEntry
    setError(null)
    setEntriesLoading(true)
    const entry = await updateCmsContentEntryCollection(selectedEntry.id, collectionId)
    setSelectedCollectionId(collectionId)
    setEntries([entry])
    selectEntry(entry)
    return entry
  }, [selectEntry, selectedEntry])

  return {
    collections,
    entries,
    authors,
    authorsLoading,
    selectedCollection,
    selectedCollectionId,
    selectedEntry,
    contentLoading,
    error,
    setError,
    selectCollection,
    selectEntry,
    updateSelectedEntry,
    createUntitledEntry,
    duplicateEntry,
    createCollection,
    updateCollection,
    deleteCollection,
    renameEntry,
    deleteEntry,
    publishEntry,
    updateEntryStatus,
    updateEntryAuthor,
    moveEntryToCollection,
    moveSelectedEntryToCollection,
  }
}
