/**
 * Audit tab — placeholder until Phase 6.
 *
 * The audit log surface lights up in Phase 6 of the rollout plan when
 * `ai.*` audit events are wired (chat started/completed, tool called,
 * credentials touched, quota events). For now we show what's coming so
 * the tab is discoverable in the UI.
 */

import styles from '../AiPage.module.css'

export function AuditTab() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2>Usage audit</h2>
          <p>
            Per-user, per-surface AI usage with token + cost rollups.
            Lands in Phase 6 alongside the audit event family <code>ai.*</code>.
          </p>
        </div>
      </div>
      <div className={styles.emptyState}>
        Phase 6 — coming soon.
      </div>
    </section>
  )
}
