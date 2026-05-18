import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { cn } from '@ui/cn'
import { Settings2SolidIcon } from 'pixel-art-icons/icons/settings-2-solid'
import type { CmsMediaAsset } from '@core/persistence'
import { MediaPickerField } from '@admin/pages/media/components/MediaPickerField'
import { useEditorStore } from '@site/store/store'
import { dataTableHasField } from '@core/data/fields'
import {
  POST_TYPE_FIELD_FEATURED_MEDIA,
  POST_TYPE_FIELD_SEO_TITLE,
  type DataTable,
  type DataRow,
  type DataRowStatus,
  type DataUserReference,
} from '@core/data/schemas'
import propertiesStyles from '../../../site/panels/PropertiesPanel/PropertiesPanel.module.css'
import { PanelHeader } from '@admin/shared/PanelHeader'
import styles from '../../ContentPage.module.css'

interface ContentSettingsPanelProps {
  selectedEntry: DataRow | null
  authors: DataUserReference[]
  authorsLoading: boolean
  collections: DataTable[]
  selectedCollection: DataTable | null
  loading: boolean
  slug: string
  slugId: string
  seoTitle: string
  seoTitleId: string
  seoDescription: string
  seoDescriptionId: string
  publicPath: string
  mediaError: string | null
  featuredMediaId: string | null
  featuredMediaAsset: CmsMediaAsset | null
  canEditEntry: boolean
  canPublishEntry: boolean
  canChangeAuthor: boolean
  onCollectionChange: (tableId: string) => void
  onAuthorChange: (authorUserId: string) => void
  onSlugChange: (value: string) => void
  onSeoTitleChange: (value: string) => void
  onSeoDescriptionChange: (value: string) => void
  onStatusChange: (status: DataRowStatus) => void
  onChooseFeaturedMedia: () => void
  onClearFeaturedMedia: () => void
  /**
   * Open the MediaViewerWindow on the currently-picked featured media asset.
   * Hidden when `featuredMediaAsset` is null (nothing to edit yet).
   */
  onEditFeaturedMedia: () => void
}

function contentAuthor(entry: DataRow): DataUserReference | null {
  return entry.author ?? entry.createdBy ?? entry.updatedBy ?? null
}

function contentAuthorLabel(entry: DataRow): string {
  const user = contentAuthor(entry)
  if (user?.displayName) return user.displayName
  if (user?.email) return user.email
  return 'Unknown user'
}

function contentAuthorRoleLabel(entry: DataRow): string | null {
  const author = contentAuthor(entry)
  return author?.roleName ?? author?.roleSlug ?? null
}

function authorOptionLabel(author: DataUserReference): string {
  return author.displayName || author.email || 'Unknown user'
}

export function ContentSettingsPanel({
  selectedEntry,
  authors,
  authorsLoading,
  collections,
  selectedCollection,
  loading,
  slug,
  slugId,
  seoTitle,
  seoTitleId,
  seoDescription,
  seoDescriptionId,
  publicPath,
  mediaError,
  featuredMediaId,
  featuredMediaAsset,
  canEditEntry,
  canPublishEntry,
  canChangeAuthor,
  onCollectionChange,
  onAuthorChange,
  onSlugChange,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onStatusChange,
  onChooseFeaturedMedia,
  onClearFeaturedMedia,
  onEditFeaturedMedia,
}: ContentSettingsPanelProps) {
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)
  const seoEnabled = selectedCollection ? dataTableHasField(selectedCollection, POST_TYPE_FIELD_SEO_TITLE) : false
  const featuredMediaEnabled = selectedCollection ? dataTableHasField(selectedCollection, POST_TYPE_FIELD_FEATURED_MEDIA) : false
  const authorRoleLabel = selectedEntry ? contentAuthorRoleLabel(selectedEntry) : null
  const selectedAuthor = selectedEntry ? contentAuthor(selectedEntry) : null
  const authorOptions = selectedAuthor && !authors.some((author) => author.id === selectedAuthor.id)
    ? [selectedAuthor, ...authors]
    : authors
  const canEditSelectedEntry = Boolean(selectedEntry && canEditEntry)
  const canChangeStatus = Boolean(selectedEntry && (canEditEntry || canPublishEntry))
  const statusOptions = [
    { value: 'draft', label: 'Draft', enabled: canEditEntry },
    { value: 'published', label: 'Published', enabled: canPublishEntry },
    { value: 'unpublished', label: 'Unpublished', enabled: canEditEntry },
  ].filter((option) => option.enabled || option.value === selectedEntry?.status)
    .map(({ value, label }) => ({ value, label }))

  return (
    <aside
      data-panel=""
      data-testid="content-settings-panel"
      role="complementary"
      aria-label="Content settings"
      className={cn(propertiesStyles.panel, propertiesStyles.panelDocked)}
    >
      <PanelHeader
        panelId="content-settings"
        title="Settings"
        titleContent={(
          <span className={propertiesStyles.headerNodeTitle}>
            <Settings2SolidIcon size={13} aria-hidden="true" />
            <span className={propertiesStyles.headerNodeLabel}>Settings</span>
          </span>
        )}
        onClose={() => setPropertiesPanel({ collapsed: true })}
      />

      <div className={styles.settingsBody}>
        {loading ? (
          <ContentSettingsLoading />
        ) : (
          <>
            <div className={styles.field}>
              <span>Collection</span>
              <Select
                aria-label="Collection"
                value={selectedEntry?.tableId ?? selectedCollection?.id ?? ''}
                disabled={!canEditSelectedEntry}
                onChange={(event) => onCollectionChange(event.target.value)}
                options={collections.map((collection) => ({
                  value: collection.id,
                  label: collection.pluralLabel || collection.name,
                }))}
              />
            </div>
            <label className={styles.field} htmlFor={slugId}>
              <span>Slug</span>
              <Input
                id={slugId}
                value={slug}
                onChange={(event) => onSlugChange(event.target.value)}
                disabled={!canEditSelectedEntry}
              />
            </label>
            {seoEnabled && (
              <>
                <label className={styles.field} htmlFor={seoTitleId}>
                  <span>SEO title</span>
                  <Input
                    id={seoTitleId}
                    value={seoTitle}
                    onChange={(event) => onSeoTitleChange(event.target.value)}
                    disabled={!canEditSelectedEntry}
                  />
                </label>
                <label className={styles.field} htmlFor={seoDescriptionId}>
                  <span>SEO description</span>
                  <Textarea
                    id={seoDescriptionId}
                    value={seoDescription}
                    onChange={(event) => onSeoDescriptionChange(event.target.value)}
                    disabled={!canEditSelectedEntry}
                    resize="none"
                    rows={4}
                  />
                </label>
              </>
            )}
            <div className={styles.field}>
              <span>Status</span>
              <Select
                aria-label="Status"
                value={selectedEntry?.status ?? 'draft'}
                disabled={!canChangeStatus}
                onChange={(event) => {
                  const nextStatus = event.target.value as DataRowStatus
                  if (nextStatus === 'published' && !canPublishEntry) return
                  if (nextStatus !== 'published' && !canEditEntry) return
                  onStatusChange(nextStatus)
                }}
                options={statusOptions}
              />
            </div>
            <div className={styles.metaBlock}>
              <span>Public URL</span>
              <strong>{publicPath || 'Not available'}</strong>
            </div>
            {selectedEntry && (
              <div className={styles.authorBlock} aria-label="Content author">
                <span>Author</span>
                <div className={styles.authorRow}>
                  {canChangeAuthor && authorOptions.length > 0 ? (
                    <Select
                      aria-label="Author"
                      value={selectedEntry.authorUserId ?? selectedAuthor?.id ?? ''}
                      disabled={authorsLoading}
                      onChange={(event) => onAuthorChange(event.target.value)}
                      options={authorOptions.map((author) => ({
                        value: author.id,
                        label: authorOptionLabel(author),
                      }))}
                    />
                  ) : (
                    <strong>{contentAuthorLabel(selectedEntry)}</strong>
                  )}
                  {authorRoleLabel && (
                    <span className={styles.authorRoleBadge}>{authorRoleLabel}</span>
                  )}
                </div>
              </div>
            )}
            {featuredMediaEnabled && (
              <div className={styles.featuredMediaField}>
                <span>Featured media</span>
                <MediaPickerField
                  asset={featuredMediaAsset}
                  hasValue={Boolean(featuredMediaId)}
                  fallbackLabel={featuredMediaId ?? undefined}
                  fallbackHint="Saved reference"
                  mediaKind={featuredMediaAsset?.mimeType.startsWith('video/') ? 'video' : 'image'}
                  subjectLabel="featured media"
                  chooseLabel="Choose featured media"
                  disabled={!canEditSelectedEntry}
                  onBrowse={onChooseFeaturedMedia}
                  onEdit={featuredMediaAsset ? onEditFeaturedMedia : undefined}
                  onClear={featuredMediaId ? onClearFeaturedMedia : undefined}
                />
                {mediaError && <p className={styles.error} role="alert">{mediaError}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

function ContentSettingsLoading() {
  return (
    <div
      className={styles.settingsSkeleton}
      data-testid="content-settings-loading"
      aria-busy="true"
      aria-label="Loading content settings"
    >
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonInput)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonInput)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonTextarea)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonCard)} />
    </div>
  )
}
