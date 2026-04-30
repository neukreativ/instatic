import type { Project, Page } from '../../src/core/page-tree/types'
import {
  DEFAULT_BREAKPOINTS,
  DEFAULT_PROJECT_SETTINGS,
} from '../../src/core/page-tree/types'
import type { DbClient } from './db'
import type { SiteRow } from './types'

export const CMS_PROJECT_SCHEMA_VERSION = 1

type ProjectShell = Omit<Project, 'name' | 'pages'>

interface StoredProjectShell {
  cmsProjectSchemaVersion: 1
  project: ProjectShell
}

interface PageDraftRow {
  id: string
  title: string
  slug: string
  draft_document_json: Page
  sort_order: number
}

function projectShell(project: Project): StoredProjectShell {
  return {
    cmsProjectSchemaVersion: CMS_PROJECT_SCHEMA_VERSION,
    project: {
      id: project.id,
      projectMode: project.projectMode,
      files: project.files,
      visualComponents: project.visualComponents,
      packageJson: project.packageJson,
      breakpoints: project.breakpoints,
      settings: project.settings,
      classes: project.classes,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readStoredShell(site: SiteRow): ProjectShell {
  const settings = site.settings_json
  const project = isRecord(settings.project) ? settings.project : {}
  return {
    id: typeof project.id === 'string' ? project.id : 'default',
    projectMode: project.projectMode === 'react' ? 'react' : 'html',
    files: Array.isArray(project.files) ? project.files as Project['files'] : [],
    visualComponents: Array.isArray(project.visualComponents)
      ? project.visualComponents as Project['visualComponents']
      : [],
    packageJson: isRecord(project.packageJson)
      ? project.packageJson as unknown as Project['packageJson']
      : undefined,
    breakpoints: Array.isArray(project.breakpoints)
      ? project.breakpoints as Project['breakpoints']
      : DEFAULT_BREAKPOINTS,
    settings: isRecord(project.settings)
      ? project.settings as unknown as Project['settings']
      : DEFAULT_PROJECT_SETTINGS,
    classes: isRecord(project.classes) ? project.classes as Project['classes'] : {},
    createdAt: typeof project.createdAt === 'number' ? project.createdAt : Date.parse(String(site.created_at)),
    updatedAt: typeof project.updatedAt === 'number' ? project.updatedAt : Date.parse(String(site.updated_at)),
  }
}

export async function saveDraftProject(db: DbClient, project: Project): Promise<void> {
  await db.query('begin')
  try {
    await db.query(
      `insert into site (id, name, settings_json)
       values ('default', $1, $2)
       on conflict (id) do update
         set name = excluded.name,
             settings_json = excluded.settings_json,
             updated_at = now()`,
      [project.name, projectShell(project)],
    )

    for (let index = 0; index < project.pages.length; index++) {
      const page = project.pages[index]
      await db.query(
        `insert into pages (id, title, slug, draft_document_json, sort_order)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update
           set title = excluded.title,
               slug = excluded.slug,
               draft_document_json = excluded.draft_document_json,
               sort_order = excluded.sort_order,
               updated_at = now()`,
        [page.id, page.title, page.slug, page, index],
      )
    }

    await db.query(
      'delete from pages where not (id = any($1::text[]))',
      [project.pages.map((page) => page.id)],
    )
    await db.query('commit')
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}

export async function loadDraftProject(db: DbClient): Promise<Project | null> {
  const siteResult = await db.query<SiteRow>(
    `select id, name, settings_json, created_at, updated_at
     from site
     where id = 'default'
     limit 1`,
  )
  const site = siteResult.rows[0]
  if (!site) return null

  const pagesResult = await db.query<PageDraftRow>(
    `select id, title, slug, draft_document_json, sort_order
     from pages
     order by sort_order asc, created_at asc`,
  )
  const shell = readStoredShell(site)
  return {
    ...shell,
    name: site.name,
    pages: pagesResult.rows.map((row) => row.draft_document_json),
  }
}
