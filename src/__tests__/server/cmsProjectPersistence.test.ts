import { describe, expect, it } from 'bun:test'
import type { Project } from '../../../core/page-tree/types'
import type { DbClient, DbResult } from '../../../server/cms/db'
import {
  loadDraftProject,
  saveDraftProject,
} from '../../../server/cms/projectRepository'

class ProjectFakeDb implements DbClient {
  site: Record<string, unknown> | null = null
  pages: Record<string, unknown>[] = []

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
      return { rows: [], rowCount: 0 }
    }
    if (normalized.startsWith('insert into site')) {
      this.site = {
        id: 'default',
        name: params[0],
        settings_json: params[1],
        created_at: new Date('2026-01-01').toISOString(),
        updated_at: new Date('2026-01-02').toISOString(),
      }
      return { rows: [], rowCount: 1 }
    }
    if (normalized.startsWith('insert into pages')) {
      const page = {
        id: params[0],
        title: params[1],
        slug: params[2],
        draft_document_json: params[3],
        sort_order: params[4],
        created_at: new Date('2026-01-01').toISOString(),
        updated_at: new Date('2026-01-02').toISOString(),
      }
      const index = this.pages.findIndex((p) => p.id === page.id)
      if (index >= 0) this.pages[index] = page
      else this.pages.push(page)
      return { rows: [], rowCount: 1 }
    }
    if (normalized.startsWith('delete from pages where not')) {
      const ids = params[0] as string[]
      this.pages = this.pages.filter((p) => ids.includes(String(p.id)))
      return { rows: [], rowCount: 1 }
    }
    if (normalized.startsWith('select id, name, settings_json')) {
      return { rows: this.site ? [this.site as Row] : [], rowCount: this.site ? 1 : 0 }
    }
    if (normalized.startsWith('select id, title, slug, draft_document_json')) {
      return {
        rows: [...this.pages].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)) as Row[],
        rowCount: this.pages.length,
      }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }
}

function validProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project_1',
    name: 'Example Site',
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
    packageJson: {
      scripts: {},
      dependencies: {},
      devDependencies: {},
    },
    breakpoints: [
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    settings: {
      metaTitle: 'Example',
      colorTokens: { '--color-primary': '#111111' },
      typeScale: { baseSize: 16, ratio: 1.25 },
      shortcuts: {},
    },
    classes: {
      class_1: {
        id: 'class_1',
        name: 'Hero',
        styles: { color: 'red' },
        breakpointStyles: {},
        createdAt: 1,
        updatedAt: 2,
      },
    },
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  }
}

describe('CMS draft project persistence', () => {
  it('saves the single-site project shell and page draft rows', async () => {
    const db = new ProjectFakeDb()
    await saveDraftProject(db, validProject())

    expect(db.site).toMatchObject({ name: 'Example Site' })
    expect(db.site?.settings_json).toMatchObject({
      cmsProjectSchemaVersion: 1,
      project: {
        id: 'project_1',
        settings: { metaTitle: 'Example' },
        classes: { class_1: { name: 'Hero' } },
      },
    })
    expect(db.pages).toHaveLength(1)
    expect(db.pages[0]).toMatchObject({
      id: 'page_home',
      title: 'Home',
      slug: 'index',
      sort_order: 0,
    })
  })

  it('loads a saved draft project without reading published versions', async () => {
    const db = new ProjectFakeDb()
    await saveDraftProject(db, validProject())

    const loaded = await loadDraftProject(db)

    expect(loaded).toMatchObject({
      id: 'project_1',
      name: 'Example Site',
      settings: { metaTitle: 'Example' },
      classes: { class_1: { name: 'Hero' } },
      pages: [{ id: 'page_home', title: 'Home', slug: 'index' }],
    })
  })

  it('removes page rows that no longer exist in the draft project', async () => {
    const db = new ProjectFakeDb()
    await saveDraftProject(db, validProject({
      pages: [
        validProject().pages[0],
        { ...validProject().pages[0], id: 'page_about', title: 'About', slug: 'about' },
      ],
    }))

    await saveDraftProject(db, validProject())

    expect(db.pages.map((p) => p.id)).toEqual(['page_home'])
  })
})
