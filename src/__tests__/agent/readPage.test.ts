import { describe, expect, it, beforeAll } from 'bun:test'
import type { SiteAgentSnapshot } from '@site/agent/siteAgentSnapshot'
import { makePage, makeSite } from '../publisher/helpers'

let renderAgentPage: typeof import('../../../server/ai/tools/site/render')['renderAgentPage']

beforeAll(async () => {
  await import('../../../src/modules/base') // register base modules in this process
  ;({ renderAgentPage } = await import('../../../server/ai/tools/site/render'))
})

function snap(): SiteAgentSnapshot {
  const page = makePage({
    root: { moduleId: 'base.body', children: ['t'] },
    t: { moduleId: 'base.text', props: { text: 'Hi', tag: 'h1' } },
  })
  const site = makeSite({
    pages: [page],
    styleRules: {
      r1: { id: 'r1', name: 'heading', kind: 'ambient', selector: 'h1', order: 0, styles: { color: 'red' } },
    },
  })
  return { page, site, selectedNodeId: null, activeBreakpointId: 'desktop' }
}

describe('renderAgentPage', () => {
  it('returns an annotated body with uid attributes and a <style> css bundle', () => {
    const { html, css } = renderAgentPage(snap())
    expect(html).toContain('uid="t"') // node addressable
    expect(html).toContain('Hi') // content present
    expect(html).not.toContain('<head>') // body only, not full document
    expect(css.startsWith('<style>')).toBe(true)
    expect(css).toContain('</style>')
  })
})

describe('catalog derivations', () => {
  it('describes modules from the registry (base.text present, base.body excluded)', async () => {
    const { describeAgentModules } = await import('../../../server/ai/tools/site/render')
    const mods = describeAgentModules()
    const ids = mods.map((m) => m.id)
    expect(ids).toContain('base.text')
    expect(ids).not.toContain('base.body')
  })

  it('describes tokens from site.settings', async () => {
    const { describeAgentTokens } = await import('../../../server/ai/tools/site/render')
    const tokens = describeAgentTokens(snap().site)
    expect(tokens).toHaveProperty('colors')
    expect(tokens).toHaveProperty('fonts')
  })

  it('filterTokenFamily narrows to one family', async () => {
    const { describeAgentTokens, filterTokenFamily } = await import(
      '../../../server/ai/tools/site/render'
    )
    const tokens = describeAgentTokens(snap().site)
    const onlyColors = filterTokenFamily(tokens, 'colors')
    expect(onlyColors.colors).toBe(tokens.colors)
    expect(onlyColors.typography).toEqual([])
    expect(onlyColors.spacing).toEqual([])
    expect(onlyColors.fonts).toEqual([])
  })
})
