/**
 * MetaTab — the SEO workspace's editing surface.
 *
 * Two persistent columns:
 *   - Left: sticky preview editor. Platform switcher (Search / Open Graph /
 *     X / Schema) over live 1:1 platform previews, editable snippet fields
 *     with inherited-value placeholders and pixel length meters. The pinned
 *     "Site defaults" row opens the site-level editor instead.
 *   - Right: target index — search, kind filters, issues summary chips,
 *     dense rows with per-field health dots, full keyboard navigation.
 *
 * The homepage is selected by default so the user lands on a live preview,
 * not an empty defaults form. Switching targets with unsaved changes asks
 * through an in-app dialog (never `confirm()`).
 */
import { useState } from 'react'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import type { SeoTarget } from '../lib/seoApi'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import { SeoTargetIndex } from '../components/SeoTargetIndex'
import { SeoPreviewEditor } from '../components/SeoPreviewEditor'
import { SiteDefaultsEditor } from '../components/SiteDefaultsEditor'
import styles from './MetaTab.module.css'

/** Selection id for the pinned site-defaults pseudo-target. */
export const SITE_DEFAULTS_ID = 'site:defaults'

interface MetaTabProps {
  workspace: SeoWorkspace
  canManage: boolean
}

/** Homepage first, then any page, then the site defaults row. */
function defaultSelectionId(targets: SeoTarget[]): string {
  return (
    targets.find((target) => target.kind === 'page' && target.route === '/')?.id ??
    targets.find((target) => target.kind === 'page')?.id ??
    SITE_DEFAULTS_ID
  )
}

export function MetaTab({ workspace, canManage }: MetaTabProps) {
  const [selection, setSelection] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [pendingSelection, setPendingSelection] = useState<string | null>(null)

  const selectedId = selection ?? defaultSelectionId(workspace.targets)

  const selectedTarget: SeoTarget | null =
    selectedId === SITE_DEFAULTS_ID
      ? null
      : workspace.targets.find((target) => target.id === selectedId) ?? null

  function handleSelect(nextId: string): void {
    if (nextId === selectedId) return
    if (editorDirty) {
      setPendingSelection(nextId)
      return
    }
    setSelection(nextId)
  }

  function discardAndSwitch(): void {
    if (pendingSelection !== null) {
      setSelection(pendingSelection)
      setEditorDirty(false)
      setPendingSelection(null)
    }
  }

  return (
    <div className={styles.columns}>
      <div className={styles.editorColumn}>
        {selectedTarget ? (
          <SeoPreviewEditor
            key={selectedTarget.id}
            target={selectedTarget}
            workspace={workspace}
            canManage={canManage}
            onDirtyChange={setEditorDirty}
          />
        ) : (
          <SiteDefaultsEditor
            key={SITE_DEFAULTS_ID}
            workspace={workspace}
            canManage={canManage}
            onDirtyChange={setEditorDirty}
          />
        )}
      </div>

      <div className={styles.indexColumn}>
        <SeoTargetIndex
          workspace={workspace}
          selectedId={selectedId}
          siteDefaultsId={SITE_DEFAULTS_ID}
          onSelect={handleSelect}
        />
      </div>

      <Dialog
        open={pendingSelection !== null}
        onClose={() => setPendingSelection(null)}
        title="Discard unsaved changes?"
        tone="danger"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setPendingSelection(null)}>
              Keep editing
            </Button>
            <Button variant="destructive" size="sm" onClick={discardAndSwitch} data-testid="seo-discard-switch">
              Discard changes
            </Button>
          </>
        }
      >
        <p>The selected target has unsaved SEO changes. Switching now will discard them.</p>
      </Dialog>
    </div>
  )
}
