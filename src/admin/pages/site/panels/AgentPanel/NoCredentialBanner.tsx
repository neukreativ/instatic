/**
 * NoCredentialBanner — shown inside the AI panel when the site editor has
 * no provider configured.
 *
 * Triggered by `agentSlice.agentError` carrying the "No AI provider
 * configured" message (set by sendAgentMessage when `/admin/api/ai/defaults`
 * returns no `site` entry). The deep-link takes the user straight to the
 * Providers tab so they can set things up + come back.
 *
 * Lightweight — no fetch of its own. The slice is the source of truth.
 */

import { ArrowRightIcon } from 'pixel-art-icons/icons/arrow-right'
import styles from './AgentPanel.module.css'

interface NoCredentialBannerProps {
  message?: string
}

export function NoCredentialBanner({
  message = 'No AI provider configured for the site editor. Set one up to start chatting.',
}: NoCredentialBannerProps) {
  return (
    <div role="alert" className={styles.noCredentialBanner}>
      <p className={styles.noCredentialBannerText}>{message}</p>
      <a
        href="/admin/ai"
        className={styles.noCredentialBannerLink}
        target="_blank"
        rel="noreferrer"
      >
        <span>Open AI settings</span>
        <ArrowRightIcon size={12} aria-hidden="true" />
      </a>
    </div>
  )
}
