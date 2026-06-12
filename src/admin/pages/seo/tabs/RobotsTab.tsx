/**
 * RobotsTab — generated robots.txt controls + live preview.
 *
 * Three FormField-wrapped switches (indexing, AI training crawlers, AI
 * answer crawlers) over a byte-identical CodeMirror preview of the served
 * file — the preview calls the same `generateRobotsTxt` the server endpoint
 * uses. Saving writes `site.settings.seo.robots`; output goes live with the
 * publish lifecycle.
 */
import { useState } from 'react'
import { Switch } from '@ui/components/Switch'
import { FormField } from '@ui/components/FormField'
import { getErrorMessage } from '@core/utils/errorMessage'
import {
  generateRobotsTxt,
  AI_TRAINING_CRAWLERS,
  AI_ANSWER_CRAWLERS,
  type SeoRobotsSettings,
} from '@core/seo'
import { SaveControls } from '../components/SeoPreviewEditor'
import { SeoCodeViewer } from '../components/SeoCodeViewer'
import type { SeoWorkspace } from '../hooks/useSeoWorkspace'
import styles from './SettingsTabs.module.css'

interface RobotsTabProps {
  workspace: SeoWorkspace
  canManage: boolean
}

export function RobotsTab({ workspace, canManage }: RobotsTabProps) {
  const stored = workspace.siteSeo?.robots ?? {}
  const [draft, setDraft] = useState<SeoRobotsSettings>(stored)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = JSON.stringify(draft) !== JSON.stringify(stored)

  const preview = generateRobotsTxt({
    robots: draft,
    sitemapEnabled: workspace.siteSeo?.sitemap?.enabled !== false,
    origin: workspace.publicOrigin ?? undefined,
  })

  function setFlag(flag: keyof SeoRobotsSettings, value: boolean): void {
    setDraft((current) => ({ ...current, [flag]: value }))
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function handleSave(): Promise<void> {
    setSaveState('saving')
    setSaveError(null)
    try {
      await workspace.saveSite({ ...(workspace.siteSeo ?? {}), robots: draft })
      setSaveState('saved')
    } catch (err) {
      console.error('[seo-page] robots save failed:', err)
      setSaveState('error')
      setSaveError(getErrorMessage(err, 'Could not save robots settings'))
    }
  }

  return (
    <section className={styles.tab} aria-label="Robots.txt settings">
      <header className={styles.header}>
        <div>
          <h2 className={styles.heading}>Robots.txt</h2>
          <p className={styles.subheading}>
            Generated automatically and served at <code>/robots.txt</code>. Changes go live on the next publish.
          </p>
        </div>
        <SaveControls dirty={isDirty} state={saveState} canManage={canManage} onSave={() => void handleSave()} />
      </header>
      {saveError && <p className={styles.error} role="alert">{saveError}</p>}
      {!workspace.publicOrigin && (
        <p className={styles.notice} role="status">
          No public origin configured — set the <code>PUBLIC_ORIGINS</code> environment
          variable so the sitemap link (and canonical URLs) use your real domain.
        </p>
      )}

      <div className={styles.controls}>
        <FormField
          layout="inline-end"
          label="Allow search engine indexing"
          description="Turning this off serves a global Disallow — the whole site disappears from search."
        >
          <Switch
            checked={draft.indexingEnabled !== false}
            onCheckedChange={(value) => setFlag('indexingEnabled', value)}
            disabled={!canManage}
            aria-label="Allow search engine indexing"
            data-testid="seo-robots-indexing"
          />
        </FormField>
        <FormField
          layout="inline-end"
          label="Allow AI training crawlers"
          description={`Bots that ingest content for model training: ${AI_TRAINING_CRAWLERS.join(', ')}.`}
        >
          <Switch
            checked={draft.allowAiTrainingCrawlers !== false}
            onCheckedChange={(value) => setFlag('allowAiTrainingCrawlers', value)}
            disabled={!canManage || draft.indexingEnabled === false}
            aria-label="Allow AI training crawlers"
            data-testid="seo-robots-ai-training"
          />
        </FormField>
        <FormField
          layout="inline-end"
          label="Allow AI search & answer crawlers"
          description={`Bots that fetch content to ground live AI answers: ${AI_ANSWER_CRAWLERS.join(', ')}. Blocking these removes the site from AI search results.`}
        >
          <Switch
            checked={draft.allowAiAnswerCrawlers !== false}
            onCheckedChange={(value) => setFlag('allowAiAnswerCrawlers', value)}
            disabled={!canManage || draft.indexingEnabled === false}
            aria-label="Allow AI search & answer crawlers"
            data-testid="seo-robots-ai-answer"
          />
        </FormField>
      </div>

      <h3 className={styles.previewHeading}>Preview</h3>
      <SeoCodeViewer docKey="robots-preview" value={preview} language="text" data-testid="seo-robots-preview" />
    </section>
  )
}
