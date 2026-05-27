/**
 * Defaults tab — per-scope default `(credentialId, modelId)` selection.
 *
 * One row per `ToolScope`. Each row has a credential picker (sourced from
 * the user's credentials) and a model picker (sourced from the active
 * credential's provider). Saving a row PUTs to /admin/api/ai/defaults/:scope.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/components/Button'
import { Select } from '@ui/components/Select'
import { SaveSolidIcon } from 'pixel-art-icons/icons/save-solid'
import {
  type AiDefaults,
  type AiModel,
  type CredentialView,
  listCredentials,
  listDefaults,
  listModels,
  setDefault,
  AiApiError,
} from '../../../ai/api'
import styles from '../AiPage.module.css'

type ToolScope = 'site' | 'content' | 'data' | 'plugin'
const SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']
const SCOPE_DESCRIPTIONS: Record<ToolScope, string> = {
  site: 'Used by the visual site editor chat.',
  content: 'Used by the content workspace (Phase 4).',
  data: 'Used by the data workspace (Phase 4).',
  plugin: 'Used by api.ai.* calls from plugin code (Phase 5).',
}

export function DefaultsTab() {
  const [credentials, setCredentials] = useState<CredentialView[]>([])
  const [defaults, setDefaults] = useState<AiDefaults>({})
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, AiModel[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingScope, setSavingScope] = useState<ToolScope | null>(null)
  const [statusByScope, setStatusByScope] = useState<Record<string, string>>({})
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setError(null)
        const [creds, defs] = await Promise.all([listCredentials(), listDefaults()])
        if (cancelled) return
        setCredentials(creds)
        setDefaults(defs)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load defaults.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [refreshKey])

  // Lazy-load models for each provider that has any credentials. Cache
  // per-provider; the picker reads from this map. The fetch is started
  // inside a microtask so we don't synchronously setState during the
  // current commit (satisfies react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    const providersInUse = new Set(credentials.map((c) => c.providerId))
    for (const provider of providersInUse) {
      if (modelsByProvider[provider]) continue
      void listModels(provider).then((models) => {
        if (cancelled) return
        setModelsByProvider((prev) => ({ ...prev, [provider]: models }))
      }).catch(() => { /* swallow — picker shows "loading models…" */ })
    }
    return () => { cancelled = true }
  }, [credentials, modelsByProvider])

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Per-scope defaults</h2>
          <p>Pick which credential + model each AI surface uses by default. Users can override in the chat picker.</p>
        </div>
      </div>

      {error && <p role="alert" className={styles.errorAlert}>{error}</p>}

      {loading ? (
        <div className={styles.emptyState}>Loading…</div>
      ) : credentials.length === 0 ? (
        <div className={styles.emptyState}>
          Add a credential on the Providers tab before setting defaults.
        </div>
      ) : (
        <div className={styles.defaultsGrid}>
          {SCOPES.map((scope) => (
            <ScopeRow
              key={scope}
              scope={scope}
              credentials={credentials}
              modelsByProvider={modelsByProvider}
              current={defaults[scope]}
              busy={savingScope === scope}
              status={statusByScope[scope]}
              onSave={async (credentialId, modelId) => {
                setSavingScope(scope)
                setStatusByScope((prev) => ({ ...prev, [scope]: '' }))
                try {
                  await setDefault(scope, { credentialId, modelId })
                  setStatusByScope((prev) => ({ ...prev, [scope]: 'Saved.' }))
                  setRefreshKey((n) => n + 1)
                } catch (err) {
                  const message = err instanceof AiApiError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : 'Failed to save.'
                  setStatusByScope((prev) => ({ ...prev, [scope]: message }))
                } finally {
                  setSavingScope(null)
                }
              }}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function ScopeRow({
  scope,
  credentials,
  modelsByProvider,
  current,
  busy,
  status,
  onSave,
}: {
  scope: ToolScope
  credentials: CredentialView[]
  modelsByProvider: Record<string, AiModel[]>
  current: { credentialId: string; modelId: string } | undefined
  busy: boolean
  status: string | undefined
  onSave: (credentialId: string, modelId: string) => Promise<void>
}) {
  const [credentialId, setCredentialId] = useState<string>(current?.credentialId ?? credentials[0]?.id ?? '')
  const [explicitModelId, setExplicitModelId] = useState<string>(current?.modelId ?? '')

  const selectedCred = useMemo(
    () => credentials.find((c) => c.id === credentialId),
    [credentials, credentialId],
  )
  const models = useMemo(
    () => selectedCred ? (modelsByProvider[selectedCred.providerId] ?? []) : [],
    [selectedCred, modelsByProvider],
  )

  // Derived "effective" model id: prefer the explicit selection when it's
  // still valid against the loaded list; otherwise fall back to the first
  // model. Computed at render time — no effect, no setState ping-pong.
  const modelId = explicitModelId && models.some((m) => m.id === explicitModelId)
    ? explicitModelId
    : (models[0]?.id ?? '')

  const credOptions = credentials.map((c) => ({
    value: c.id,
    label: `${c.displayLabel} (${c.providerId})`,
  }))
  const modelOptions = models.map((m) => ({ value: m.id, label: m.label }))

  const canSave = !busy && credentialId && modelId &&
    (current?.credentialId !== credentialId || current?.modelId !== modelId)

  return (
    <div className={styles.defaultRow}>
      <div>
        <div className={styles.defaultScopeLabel}>{scope}</div>
        <p className={styles.secondaryText}>{SCOPE_DESCRIPTIONS[scope]}</p>
      </div>
      <Select
        aria-label={`Credential for ${scope}`}
        value={credentialId}
        onChange={(e) => setCredentialId(e.currentTarget.value)}
        options={credOptions}
      />
      <Select
        aria-label={`Model for ${scope}`}
        value={modelId}
        onChange={(e) => setExplicitModelId(e.currentTarget.value)}
        options={modelOptions.length > 0 ? modelOptions : [{ value: '', label: 'Loading models…' }]}
      />
      <div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!canSave}
          onClick={() => void onSave(credentialId, modelId)}
        >
          <SaveSolidIcon size={14} aria-hidden="true" />
          <span>Save</span>
        </Button>
        {status && (
          <p
            role="status"
            className={`${styles.testResult} ${status === 'Saved.' ? styles.success : styles.danger}`}
          >
            {status}
          </p>
        )}
      </div>
    </div>
  )
}
