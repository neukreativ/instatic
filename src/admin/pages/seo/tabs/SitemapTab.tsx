/**
 * SitemapTab — sitemap.xml generation settings.
 *
 * Enable/disable, inclusion counts (computed from the same target data the
 * Meta tab uses), and per-target include/exclude switches for routable
 * targets. Noindex targets are excluded automatically and shown as such —
 * the control is disabled with the reason inline.
 */
import { useState } from 'react'
import { Switch } from '@ui/components/Switch'
import { FormField } from '@ui/components/FormField'
import { getErrorMessage } from '@core/utils/errorMessage'
import type { SeoSitemapSettings } from '@core/seo'
import { SaveControls } from '../components/SeoPreviewEditor'
import { SeoCodeViewer } from '../components/SeoCodeViewer'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SettingsTabs.module.css'

interface SitemapTabProps {
  workspace: SeoWorkspace
  canManage: boolean
}

export function SitemapTab({ workspace, canManage }: SitemapTabProps) {
  const stored = workspace.siteSeo?.sitemap ?? {}
  const [draft, setDraft] = useState<SeoSitemapSettings>(stored)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const enabled = draft.enabled !== false
  const excluded = new Set(draft.excludedTargets ?? [])

  // Routable targets only — templates have no public URL.
  const routable = workspace.targets.filter((target) => target.route !== null)
  const included = routable.filter((target) => {
    if (target.seo?.noindex === true) return false
    const key = `${target.kind === 'post' ? 'row' : 'page'}:${target.id}`
    return !excluded.has(key)
  })

  function toggleTarget(kind: 'page' | 'row', id: string, include: boolean): void {
    const key = `${kind}:${id}`
    setDraft((current) => {
      const set = new Set(current.excludedTargets ?? [])
      if (include) set.delete(key)
      else set.add(key)
      const next = { ...current }
      if (set.size === 0) delete next.excludedTargets
      else next.excludedTargets = [...set].sort()
      return next
    })
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    setSaveState('saving')
    setSaveError(null)
    try {
      await workspace.saveSite({ ...(workspace.siteSeo ?? {}), sitemap: draft })
      setSaveState('saved')
    } catch (err) {
      console.error('[seo-page] sitemap save failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not save sitemap settings'))
    }
  }

  return (
    <section className={styles.tab} aria-label="Sitemap settings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.heading}>Sitemap</h2>
          <p className={styles.subheading}>
            Generated from published content and served at <code>/sitemap.xml</code>. Changes go live on the next publish.
          </p>
        </div>
        <SaveControls dirty={isDirty} state={saveState} canManage={canManage} onSave={() => void handleSave()} />
      </header>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      {!workspace.publicOrigin && (
        <p className={styles.notice} role="status">
          No public origin configured — set the <code>PUBLIC_ORIGINS</code> environment
          variable so sitemap URLs use your real domain.
        </p>
      )}

      <div className={styles.controls}>
        <FormField
          layout="inline-end"
          label="Generate sitemap.xml"
          description="Search and answer engines use the sitemap to discover published pages and posts."
        >
          <Switch
            checked={enabled}
            disabled={!canManage}
            onCheckedChange={(value) => {
              setDraft((current) => {
                const next = { ...current }
                if (value) delete next.enabled
                else next.enabled = false
                return next
              })
              if (saveState !== 'idle') setSaveState('idle')
            }}
            aria-label="Generate sitemap.xml"
            data-testid="seo-sitemap-enabled"
          />
        </FormField>
      </div>

      <p className={styles.counts} role="status" data-testid="seo-sitemap-counts">
        {enabled
          ? `${included.length} of ${routable.length} routable targets included.`
          : 'Sitemap generation is disabled — /sitemap.xml returns 404.'}
      </p>

      {enabled && (
        <div className={styles.targetList} aria-label="Sitemap inclusion">
          {routable.map((target) => {
            const kindKey = target.kind === 'post' ? 'row' as const : 'page' as const
            const noindexed = target.seo?.noindex === true
            const isIncluded = !noindexed && !excluded.has(`${kindKey}:${target.id}`)
            return (
              <div key={target.id} className={styles.targetRow}>
                <Switch
                  checked={isIncluded}
                  disabled={!canManage || noindexed}
                  onCheckedChange={(value) => toggleTarget(kindKey, target.id, value)}
                  aria-label={`Include ${target.title} in the sitemap`}
                  switchSize="sm"
                />
                <span className={styles.targetTitle}>{target.title}</span>
                <span className={styles.targetRoute}>{target.route}</span>
                {noindexed && (
                  <span className={styles.targetNote}>noindex — excluded automatically</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      <h3 className={styles.previewHeading}>Entry format</h3>
      <SeoCodeViewer docKey="sitemap-sample" value={sampleEntry(workspace)} language="html" />
    </section>
  )
}

function sampleEntry(workspace: SeoWorkspace): string {
  const origin = workspace.publicOrigin ?? 'https://example.com'
  return [
    '<url>',
    `  <loc>${origin}/posts/hello-world</loc>`,
    '  <lastmod>2026-06-12T00:00:00.000Z</lastmod>',
    '</url>',
  ].join('\n')
}
