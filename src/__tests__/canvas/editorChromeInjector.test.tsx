/**
 * Regression guard: the editor-chrome injector must NOT overwrite the site's
 * own `--font-sans` on the iframe `:root`.
 *
 * The injector is unlayered, so anything it sets on `:root` beats the site's
 * font tokens (which live in `@layer user-authored`). It used to copy the
 * admin `--font-sans` straight onto the iframe root, silently rendering every
 * canvas element in the editor's font instead of the site's configured one —
 * and making parent-doc overlays (the inline text-edit field) mismatch. The
 * editor font must ride a chrome-namespaced variable instead.
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { render, cleanup } from '@testing-library/react'
import { EditorChromeInjector } from '@site/canvas/EditorChromeInjector'

afterEach(cleanup)

/** A detached document whose :root carries admin typography tokens. */
function makeParentDoc(): Document {
  document.documentElement.style.setProperty('--font-sans', '"Inter Variable", system-ui, sans-serif')
  document.documentElement.style.setProperty('--text-xs', 'clamp(10px, calc(9.629px + 0.095vw), 11px)')
  document.documentElement.style.setProperty('--text-s', 'clamp(11px, calc(10.629px + 0.095vw), 12px)')
  return document
}

describe('EditorChromeInjector font isolation', () => {
  it('forwards editor typography under chrome-namespaced variables, never site Framework tokens', () => {
    const target = document.implementation.createHTMLDocument('iframe')
    render(<EditorChromeInjector targetDocument={target} parentDocument={makeParentDoc()} />)

    const css = target.getElementById('instatic-editor-chrome')?.textContent ?? ''
    expect(css).not.toBe('')

    // The chrome font is exposed as a namespaced var carrying the editor font…
    expect(css).toContain('--chrome-font-sans: "Inter Variable", system-ui, sans-serif;')
    // …and chrome rules reference it.
    expect(css).toContain('font-family: var(--chrome-font-sans);')
    expect(css).toContain('--chrome-text-xs: clamp(10px, calc(9.629px + 0.095vw), 11px);')
    expect(css).toContain('--chrome-text-s: clamp(11px, calc(10.629px + 0.095vw), 12px);')
    expect(css).toContain('font-size: var(--chrome-text-s);')
    expect(css).toContain('font-size: var(--chrome-text-xs);')

    // It must NEVER set the site's own --font-sans on :root, nor reference it —
    // doing so clobbers the site's font tokens for all canvas content.
    expect(css).not.toMatch(/^\s*--font-sans:/m)
    expect(css).not.toContain('var(--font-sans)')
    expect(css).not.toMatch(/^\s*--text-s:/m)
    expect(css).not.toMatch(/^\s*--text-xs:/m)
    expect(css).not.toContain('var(--text-s)')
    expect(css).not.toContain('var(--text-xs)')
  })
})
