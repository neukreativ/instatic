import { describe, expect, it } from 'bun:test'
import type { Project } from '../../core/page-tree/types'
import { CmsAdapter } from '../../core/persistence/cms'

function project(): Project {
  return {
    id: 'project_1',
    name: 'CMS Site',
    projectMode: 'html',
    pages: [
      {
        id: 'page_home',
        title: 'Home',
        slug: 'index',
        rootNodeId: 'root',
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.root',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
    files: [],
    visualComponents: [],
    breakpoints: [
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    settings: {
      colorTokens: {},
      typeScale: { baseSize: 16, ratio: 1.25 },
      shortcuts: {},
    },
    classes: {},
    createdAt: 1000,
    updatedAt: 2000,
  }
}

describe('CmsAdapter', () => {
  it('loads the single-site draft project from the CMS API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new CmsAdapter(async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ project: project() }), { status: 200 })
    })

    const loaded = await adapter.loadProject('ignored-in-single-site-mode')

    expect(loaded?.id).toBe('project_1')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/project',
      init: { method: 'GET', credentials: 'include' },
    })
  })

  it('saves the draft project to the CMS API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new CmsAdapter(async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    await adapter.saveProject(project())

    expect(calls[0].input).toBe('/api/cms/project')
    expect(calls[0].init).toMatchObject({
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
    })
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      project: { id: 'project_1', name: 'CMS Site' },
    })
  })

  it('returns undefined when no draft project exists yet', async () => {
    const adapter = new CmsAdapter(async () =>
      new Response(JSON.stringify({ error: 'Draft project not found' }), { status: 404 }))

    await expect(adapter.loadProject('default')).resolves.toBeUndefined()
  })
})
