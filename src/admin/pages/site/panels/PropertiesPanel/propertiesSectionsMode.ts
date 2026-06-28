/**
 * propertiesSectionsMode — helpers for the style-section expand preference.
 */

import type { PropertiesSectionsMode } from '@site/preferences/editorPreferences'

/** Whether a collapsible section should start open for the given mode. */
export function resolveSectionDefaultOpen(
  mode: PropertiesSectionsMode,
  setCount: number,
): boolean {
  if (mode === 'expanded') return true
  if (mode === 'collapsed') return false
  return setCount > 0
}
