/**
 * Architecture Gate — admin scrollbar chrome.
 *
 * Scrollbars are part of the editor chrome, so they must be tokenized and
 * styled consistently across Firefox (`scrollbar-color`) and WebKit/Blink
 * (`::-webkit-scrollbar`). The properties panel also keeps a stable gutter so
 * the docked style rail is not covered by platform scrollbars.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const SRC_ROOT = join(import.meta.dir, '../..')

function readSource(relative: string): string {
  const path = join(SRC_ROOT, relative)
  if (!existsSync(path)) {
    throw new Error(`[arch] expected file does not exist: ${relative}`)
  }
  return readFileSync(path, 'utf8')
}

describe('architecture — admin scrollbar chrome', () => {
  const globals = readSource('styles/globals.css')
  const styleSurfaceCss = readSource(
    'admin/pages/site/panels/PropertiesPanel/StyleSurface.module.css',
  )

  it('declares dedicated scrollbar tokens in globals.css', () => {
    for (const token of [
      '--editor-scrollbar-size',
      '--editor-scrollbar-radius',
      '--editor-scrollbar-track',
      '--editor-scrollbar-thumb',
      '--editor-scrollbar-thumb-hover',
    ]) {
      expect(globals).toContain(token)
    }
  })

  it('styles both standards and WebKit scrollbar implementations with tokens', () => {
    expect(globals).toContain(
      'scrollbar-color: var(--editor-scrollbar-thumb) var(--editor-scrollbar-track);',
    )
    expect(globals).toContain('width: var(--editor-scrollbar-size);')
    expect(globals).toContain('height: var(--editor-scrollbar-size);')
    expect(globals).toContain('background: var(--editor-scrollbar-track);')
    expect(globals).toContain('background: var(--editor-scrollbar-thumb);')
    expect(globals).toContain('background: var(--editor-scrollbar-thumb-hover);')
    expect(globals).toContain('border-radius: var(--editor-scrollbar-radius);')
  })

  it('keeps the properties style rail clear of overlaying scrollbars', () => {
    expect(styleSurfaceCss).toContain('scrollbar-gutter: stable;')
  })
})
