import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from '@admin/lib/routing'
import { useLocation } from '@admin/lib/routing'
import { ContentPage } from '@content/ContentPage'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { useEditorStore } from '@site/store/store'
import { makeSite } from '../fixtures'
import { Toolbar } from '@site/toolbar'
import { AdminSectionNavigation } from '@admin/shared/AdminSectionNavigation'
import type { CmsCurrentUser } from '@core/persistence'
import { CORE_CAPABILITIES } from '@core/capabilities'

const originalFetch = globalThis.fetch

const imageAsset = {
  id: 'asset_image_1',
  filename: 'hero.png',
  publicPath: '/uploads/hero.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  width: 1200,
  height: 800,
  durationSeconds: null,
  uploadedByUserId: null,
  createdAt: '2026-05-01T10:00:00.000Z',
}

const videoAsset = {
  id: 'asset_video_1',
  filename: 'intro.mp4',
  publicPath: '/uploads/intro.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 4096,
  width: 1920,
  height: 1080,
  durationSeconds: 12,
  uploadedByUserId: null,
  createdAt: '2026-05-01T10:05:00.000Z',
}

const allBuiltInFields = [
  { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
  { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
  { type: 'richText', id: 'body', label: 'Body', format: 'markdown', builtIn: true },
  { type: 'media', id: 'featuredMedia', label: 'Featured media', mediaKind: 'image', builtIn: true },
  { type: 'text', id: 'seoTitle', label: 'SEO title', builtIn: true },
  { type: 'longText', id: 'seoDescription', label: 'SEO description', builtIn: true },
]

const titleOnlyFields = [
  { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
  { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
]

const ownerAuthor = {
  id: 'user_owner',
  email: 'owner@example.com',
  displayName: 'Owner Name',
  roleSlug: 'owner',
  roleName: 'Owner',
}

const editorAuthor = {
  id: 'user_editor',
  email: 'editor@example.com',
  displayName: 'Editor Name',
  roleSlug: 'editor',
  roleName: 'Editor',
}

const adminAuthor = {
  id: 'user_admin',
  email: 'admin@example.com',
  displayName: 'Admin Name',
  roleSlug: 'admin',
  roleName: 'Admin',
}

function makeTable(
  id: string,
  name: string,
  slug: string,
  routeBase: string,
  singularLabel: string,
  pluralLabel: string,
  fields: unknown[] = allBuiltInFields,
) {
  return {
    id,
    name,
    slug,
    kind: 'postType',
    routeBase,
    singularLabel,
    pluralLabel,
    primaryFieldId: 'title',
    fields,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  }
}

function makeRow(
  id: string,
  tableId: string,
  cells: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  const mergedCells: Record<string, unknown> = {
    title: '',
    slug: 'untitled',
    body: '',
    featuredMedia: null,
    seoTitle: '',
    seoDescription: '',
    ...cells,
  }
  return {
    id,
    tableId,
    cells: mergedCells,
    slug: typeof mergedCells.slug === 'string' ? mergedCells.slug : 'untitled',
    status: 'draft',
    authorUserId: null as string | null,
    createdByUserId: null as string | null,
    updatedByUserId: null as string | null,
    publishedByUserId: null as string | null,
    author: null,
    createdBy: null,
    updatedBy: null,
    publishedBy: null,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
    publishedAt: null as string | null,
    deletedAt: null as string | null,
    ...overrides,
  }
}

interface FetchCall {
  input: RequestInfo | URL
  init?: RequestInit
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Ambient fetch fallback for endpoints the shared Toolbar / AdminCanvasLayout
 * fire on mount (plugin list, draft site, publish status). Returns
 * `undefined` for non-ambient URLs so per-test handlers stay authoritative.
 */
function ambientFetchFallback(url: string): Response | undefined {
  if (url.endsWith('/admin/api/cms/plugins')) {
    return json({ plugins: [], adminPages: [] })
  }
  if (url.endsWith('/admin/api/cms/site')) {
    return json({ site: null }, 404)
  }
  if (url.endsWith('/admin/api/cms/publish/status')) {
    return json({ ok: false }, 404)
  }
  // The shared MediaPickerModal (workspace modal that replaced the old
  // inline MediaPickerDialog) loads folders alongside assets on mount.
  // Without this fallback the modal's workspace hook errors out and the
  // asset grid never renders.
  if (url.endsWith('/admin/api/cms/media/folders')) {
    return json({ folders: [] })
  }
  return undefined
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{location.pathname}</output>
}

const now = '2026-05-07T10:00:00.000Z'

function contentEditorUser(): CmsCurrentUser {
  return {
    id: 'content-editor',
    email: 'editor@example.com',
    displayName: 'Editor',
    status: 'active',
    role: {
      id: 'admin',
      slug: 'admin',
      name: 'Admin',
      description: '',
      isSystem: true,
      capabilities: [...CORE_CAPABILITIES],
    },
    capabilities: [...CORE_CAPABILITIES],
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordUpdatedAt: null,
    mfaEnabled: false,
    mfaEnabledAt: null,
    mfaRecoveryCodesRemaining: 0,
    avatarMediaId: null,
    avatarUrl: null,
    gravatarHash: '',
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Wraps test renders in the same provider stack production uses:
 *   MemoryRouter -> AdminSessionProvider -> StepUpProvider
 *
 * The shared Toolbar and AdminPageLayout require all three (router hooks,
 * AccountMenuButton -> useStepUp + useAuthenticatedAdminUser).
 */
function AdminTestProviders({
  initialEntries,
  user,
  children,
}: {
  initialEntries?: string[]
  user?: CmsCurrentUser
  children: ReactNode
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AdminSessionProvider user={user ?? contentEditorUser()}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

function clickToolbarSaveDraft() {
  fireEvent.click(screen.getByRole('button', { name: /more publishing actions/i }))
  const menu = screen.getByRole('menu', { name: /publishing actions/i })
  fireEvent.click(within(menu).getByRole('menuitem', { name: /save draft/i }))
}

function clickToolbarPublish() {
  fireEvent.click(screen.getByTestId('toolbar-publish-btn'))
}

beforeEach(() => {
  const site = makeSite({ name: 'Content Shell Site' })
  localStorage.clear()
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    leftSidebarWidth: 320,
    focusedPanel: 'canvas',
    siteExplorerPanelOpen: false,
    mediaExplorerPanelOpen: false,
    codeEditorPanelOpen: false,
    activeEditorFileId: null,
    activeMediaAssetPreview: null,
    dependenciesPanelOpen: false,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  const calls: FetchCall[] = []
  ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    const url = String(input)

    if (url === '/admin/api/cms/data/tables') {
      return json({
        tables: [makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts')],
      })
    }

    if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
      return json({ rows: [] })
    }

    if (url === '/admin/api/cms/data/authors' && init?.method === 'GET') {
      return json({ authors: [ownerAuthor, editorAuthor, adminAuthor] })
    }

    if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'POST') {
      return json({
        row: makeRow('entry_1', 'posts', { title: 'Untitled', slug: 'untitled' }, {
          authorUserId: ownerAuthor.id,
          author: ownerAuthor,
        }),
      }, 201)
    }

    if (url === '/admin/api/cms/data/rows/entry_1' && init?.method === 'PATCH') {
      const draft = JSON.parse(String(init.body))
      return json({
        row: {
          ...makeRow('entry_1', 'posts', draft.cells ?? {}),
          updatedAt: '2026-05-01T10:01:00.000Z',
        },
      })
    }

    if (url === '/admin/api/cms/data/rows/entry_1/publish' && init?.method === 'POST') {
      return json({
        row: {
          ...makeRow('entry_1', 'posts', { title: 'My first post', slug: 'untitled', body: '## Intro', featuredMedia: null, seoTitle: '', seoDescription: '' }),
          status: 'published',
          updatedAt: '2026-05-01T10:02:00.000Z',
          publishedAt: '2026-05-01T10:02:00.000Z',
        },
      })
    }

    if (url === '/admin/api/cms/data/rows/entry_1/status' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      return json({
        row: {
          ...makeRow('entry_1', 'posts', { title: 'My first post', slug: 'updated-slug', body: '', featuredMedia: imageAsset.id, seoTitle: '', seoDescription: '' }),
          status: body.status,
          updatedAt: '2026-05-01T10:03:00.000Z',
        },
      })
    }

    if (url === '/admin/api/cms/media') {
      return json({ assets: [imageAsset, videoAsset] })
    }

    const ambient = ambientFetchFallback(url)
    if (ambient) return ambient

    return json({ error: `Unhandled ${url}` }, 500)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('ContentPage', () => {
  it('uses SPA navigation with active Site and Content labels in the shared toolbar', () => {
    render(
      <AdminTestProviders initialEntries={['/admin/site']}>
        <Routes>
          <Route
            path="/admin/site"
            element={(
              <>
                <Toolbar
                  section="site"
                  adminNavigationSlot={<AdminSectionNavigation section="site" />}
                  rightSlot={<span>right</span>}
                />
                <LocationProbe />
              </>
            )}
          />
          <Route
            path="/admin/content"
            element={(
              <>
                <Toolbar
                  section="content"
                  adminNavigationSlot={<AdminSectionNavigation section="content" />}
                  rightSlot={<span>right</span>}
                />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </AdminTestProviders>,
    )

    expect(screen.getByText('Site')).toBeDefined()
    fireEvent.click(screen.getByRole('link', { name: 'Content' }))
    expect(screen.getByLabelText('current route').textContent).toBe('/admin/content')
    expect(screen.getByText('Content')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Site' })).toBeDefined()
  })

  it('does not delay admin navigation or use route changes to collapse workspace panels', async () => {
    const transitionStarts: string[] = []

    render(
      <AdminTestProviders initialEntries={['/admin/site']}>
        <Routes>
          <Route
            path="/admin/site"
            element={(
              <>
                <Toolbar
                  section="site"
                  adminNavigationSlot={(
                    <AdminSectionNavigation
                      section="site"
                      onWorkspaceNavigateStart={() => {
                        transitionStarts.push('content')
                        return 180
                      }}
                    />
                  )}
                  rightSlot={<span>site controls</span>}
                />
                <LocationProbe />
              </>
            )}
          />
          <Route
            path="/admin/content"
            element={(
              <>
                <Toolbar
                  section="content"
                  adminNavigationSlot={<AdminSectionNavigation section="content" />}
                  rightSlot={<span>content controls</span>}
                />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </AdminTestProviders>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Content' }))

    expect(transitionStarts).toEqual(['content'])
    expect(screen.getByLabelText('current route').textContent).toBe('/admin/content')
    expect(screen.getByText('content controls')).toBeDefined()

    const layoutSource = readFileSync(join(process.cwd(), 'src/admin/layouts/AdminCanvasLayout/AdminCanvasLayout.tsx'), 'utf8')
    expect(layoutSource).not.toContain('setLeftSidebarPanel(null)')
    expect(layoutSource).not.toContain('setPropertiesPanel({ collapsed: true })')
    expect(layoutSource).not.toContain('onBeforeWorkspaceExit')
  })

  it('does not fade or view-transition the central canvas surface during admin navigation', () => {
    const layoutCss = readFileSync(join(process.cwd(), 'src/admin/layouts/AdminCanvasLayout/AdminCanvasLayout.module.css'), 'utf8')

    expect(layoutCss).not.toContain('admin-canvas-content')
    expect(layoutCss).not.toMatch(/\.canvasContent\s*\{[^}]*animation:/s)
  })

  it('keeps loading skeletons visible until content entries finish loading', async () => {
    let resolveEntries: ((response: Response) => void) | null = null
    const entriesResponse = new Promise<Response>((resolve) => {
      resolveEntries = resolve
    })

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/admin/api/cms/data/tables') {
        return json({ tables: [makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts')] })
      }

      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return entriesResponse
      }

      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    expect(await screen.findByRole('region', { name: 'Posts' })).toBeDefined()
    expect(screen.getByTestId('content-entries-loading')).toBeDefined()
    expect(screen.getByTestId('content-canvas-loading')).toBeDefined()
    // Settings panel is entry-specific — it stays hidden until an entry is selected,
    // so no settings skeleton is shown during the initial entries load.
    expect(screen.queryByTestId('content-settings-panel')).toBeNull()
    expect(screen.queryByTestId('content-settings-loading')).toBeNull()
    expect(screen.queryByText('No entries yet.')).toBeNull()
    expect(screen.queryByText(/Create the first post/i)).toBeNull()

    resolveEntries?.(json({ rows: [] }))

    expect(await screen.findByText('No entries yet.')).toBeDefined()
    expect(await screen.findByText(/Create the first post/i)).toBeDefined()
  })

  it('mounts content inside the existing editor shell chrome', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    expect(await screen.findByTestId('toolbar')).toBeDefined()
    expect(screen.getByTestId('left-sidebar')).toBeDefined()
    expect(screen.getByTestId('right-sidebar')).toBeDefined()
    expect(screen.getByTestId('content-explorer-panel')).toBeDefined()
    expect(screen.getByTestId('content-canvas-root')).toBeDefined()
    // Settings panel is entry-specific — when no entry is selected, the panel is hidden.
    expect(screen.queryByTestId('content-settings-panel')).toBeNull()
    expect(screen.getByTestId('canvas-notch')).toBeDefined()
    expect(screen.getByText('Content Shell Site')).toBeDefined()
  })

  it('hides the right settings panel until an entry is selected, then shows it', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    expect(await screen.findByRole('region', { name: 'Posts' })).toBeDefined()
    await screen.findByText('No entries yet.')

    // No entry selected → settings panel must not be in the DOM.
    expect(screen.queryByTestId('content-settings-panel')).toBeNull()

    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    // After creating (and auto-selecting) an entry, the settings panel appears.
    expect(await screen.findByTestId('content-settings-panel')).toBeDefined()
  })

  it('shows entry authors in the content list and reassigns the selected entry author', async () => {
    const user = userEvent.setup()
    const calls: FetchCall[] = []
    ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = String(input)

      if (url === '/admin/api/cms/data/tables') {
        return json({ tables: [makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts')] })
      }

      if (url === '/admin/api/cms/data/authors' && init?.method === 'GET') {
        return json({ authors: [editorAuthor, adminAuthor] })
      }

      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return json({
          rows: [makeRow('entry_1', 'posts', {
            title: 'Authored post',
            slug: 'authored-post',
            body: 'Body',
            featuredMedia: null,
            seoTitle: '',
            seoDescription: '',
          }, {
            authorUserId: editorAuthor.id,
            author: editorAuthor,
          })],
        })
      }

      if (url === '/admin/api/cms/data/rows/entry_1/author' && init?.method === 'PATCH') {
        return json({
          row: makeRow('entry_1', 'posts', {
            title: 'Authored post',
            slug: 'authored-post',
            body: 'Body',
            featuredMedia: null,
            seoTitle: '',
            seoDescription: '',
          }, {
            authorUserId: adminAuthor.id,
            author: adminAuthor,
            updatedAt: '2026-05-01T10:04:00.000Z',
          }),
        })
      }

      if (url === '/admin/api/cms/media') {
        return json({ assets: [] })
      }

      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    const postsRegion = await screen.findByRole('region', { name: 'Posts' })
    expect(await within(postsRegion).findByText('Editor Name')).toBeDefined()
    expect(await screen.findByTestId('content-settings-panel')).toBeDefined()

    const authorSelect = screen.getByRole('combobox', { name: 'Author' }) as HTMLInputElement
    expect(authorSelect.value).toBe('Editor Name')
    expect(screen.getByText('Editor')).toBeDefined()

    await user.click(authorSelect)
    await user.click(await screen.findByRole('option', { name: 'Admin Name' }))

    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/rows/entry_1/author' &&
        call.init?.method === 'PATCH' &&
        call.init?.body === JSON.stringify({ authorUserId: adminAuthor.id })
      )).toBe(true)
    })
    expect((screen.getByRole('combobox', { name: 'Author' }) as HTMLInputElement).value).toBe('Admin Name')
    expect(within(postsRegion).getByText('Admin Name')).toBeDefined()
  })

  it('uses content-specific rail panels instead of editor-only panels', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByTestId('content-explorer-panel')

    expect(screen.getByTestId('panel-rail-content').getAttribute('aria-label')).toBe('Close Content panel')
    expect(screen.getByTestId('panel-rail-media').getAttribute('aria-label')).toBe('Open Media panel')
    expect(screen.queryByLabelText('Open Layers panel')).toBeNull()
    expect(screen.queryByLabelText('Open AI assistant panel')).toBeNull()
    expect(screen.queryByLabelText('Open Dependencies panel')).toBeNull()
  })

  it('reuses the shared media explorer panel in the content rail', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByTestId('content-explorer-panel')

    fireEvent.click(screen.getByTestId('panel-rail-media'))

    expect(await screen.findByTestId('media-explorer-panel')).toBeDefined()
    expect(screen.getByLabelText('Search media')).toBeDefined()
    expect(screen.getByRole('button', { name: 'List view' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeDefined()
    expect(screen.queryByTestId('content-media-panel')).toBeNull()
  })

  it('creates, edits, saves, and publishes a rich Markdown-backed post', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    expect(await screen.findByRole('region', { name: 'Posts' })).toBeDefined()
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'My first post' } })

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = '## Intro'
    fireEvent.input(firstBlock)

    expect(screen.getByRole('heading', { name: 'Intro' })).toBeDefined()

    clickToolbarSaveDraft()
    await screen.findByText('Draft saved')

    clickToolbarPublish()
    const publishedButton = await screen.findByRole('button', { name: /^published$/i }) as HTMLButtonElement
    expect(publishedButton.getAttribute('aria-disabled')).toBe('true')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCall = calls.find((call) => String(call.input) === '/admin/api/cms/data/rows/entry_1' && call.init?.method === 'PATCH')
    expect(saveCall?.init?.body).toBe(JSON.stringify({
      cells: {
        title: 'My first post',
        slug: 'untitled',
        body: '## Intro',
        featuredMedia: null,
        seoTitle: '',
        seoDescription: '',
      },
    }))
    expect(calls.some((call) =>
      String(call.input) === '/admin/api/cms/data/rows/entry_1/publish' &&
      call.init?.method === 'POST'
    )).toBe(true)
  })

  it('renders the post title as a wrapping multi-line editor', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const title = await screen.findByLabelText('Title') as HTMLTextAreaElement
    const longTitle = "Here's my first long post title that needs to wrap cleanly"

    expect(title.tagName).toBe('TEXTAREA')
    expect(title.getAttribute('rows')).toBe('1')

    fireEvent.change(title, { target: { value: longTitle } })

    expect(title.value).toBe(longTitle)

    const contentCss = readFileSync(join(process.cwd(), 'src/admin/pages/content/ContentPage.module.css'), 'utf8')
    expect(contentCss).toMatch(/\.titleInput\s*\{[^}]*white-space:\s*pre-wrap/s)
    expect(contentCss).toMatch(/\.titleInput\s*\{[^}]*overflow-wrap:\s*anywhere/s)
  })

  it('creates a custom collection and adds entries under that collection label', async () => {
    const calls: FetchCall[] = []
    ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = String(input)

      if (url === '/admin/api/cms/data/tables' && init?.method === 'GET') {
        return json({ tables: [makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts')] })
      }

      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return json({ rows: [] })
      }

      if (url === '/admin/api/cms/data/tables' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        return json({
          table: makeTable('products', body.name ?? 'Products', 'products', '/products', body.singularLabel ?? 'Product', body.pluralLabel ?? 'Products', body.fields),
        }, 201)
      }

      if (url === '/admin/api/cms/data/tables/products/rows' && init?.method === 'GET') {
        return json({ rows: [] })
      }

      if (url === '/admin/api/cms/data/tables/products/rows' && init?.method === 'POST') {
        return json({
          row: makeRow('product_1', 'products', { title: 'Untitled', slug: 'untitled' }),
        }, 201)
      }

      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Collections' }))
        .getByRole('button', { name: /new collection/i }),
    )

    const dialog = await screen.findByRole('dialog', { name: /new collection/i })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Product Catalog' } })
    fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'catalog-items' } })
    fireEvent.change(within(dialog).getByLabelText('URL path'), { target: { value: '/catalog' } })
    fireEvent.change(within(dialog).getByLabelText('Singular label'), { target: { value: 'Product' } })
    fireEvent.change(within(dialog).getByLabelText('Plural label'), { target: { value: 'Catalog' } })
    fireEvent.click(within(dialog).getByLabelText('Featured media'))
    fireEvent.click(within(dialog).getByLabelText('SEO fields'))
    fireEvent.click(within(dialog).getByRole('button', { name: /^create$/i }))

    const catalogRegion = await screen.findByRole('region', { name: 'Catalog' })
    fireEvent.click(within(catalogRegion).getByRole('button', { name: /new product/i }))

    expect(await screen.findByLabelText('Title')).toBeDefined()

    const createCollectionCall = calls.find((call) =>
      String(call.input) === '/admin/api/cms/data/tables' &&
      call.init?.method === 'POST'
    )
    expect(createCollectionCall?.init?.body).toBe(JSON.stringify({
      name: 'Product Catalog',
      slug: 'catalog-items',
      routeBase: '/catalog',
      singularLabel: 'Product',
      pluralLabel: 'Catalog',
      fields: [
        { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
        { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
        { type: 'richText', id: 'body', label: 'Body', format: 'markdown', builtIn: true },
      ],
      kind: 'postType',
    }))
    expect(calls.some((call) =>
      String(call.input) === '/admin/api/cms/data/tables/products/rows' &&
      call.init?.method === 'POST'
    )).toBe(true)
  })

  it('moves the selected entry from the settings sidebar and hides fields disabled by the target collection', async () => {
    const calls: FetchCall[] = []
    ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = String(input)

      if (url === '/admin/api/cms/data/tables') {
        return json({
          tables: [
            makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts'),
            makeTable('products', 'Products', 'products', '/products', 'Product', 'Products', titleOnlyFields),
          ],
        })
      }

      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return json({
          rows: [makeRow('entry_1', 'posts', {
            title: 'Portable lamp',
            slug: 'portable-lamp',
            body: 'A compact lamp',
            featuredMedia: imageAsset.id,
            seoTitle: 'SEO lamp',
            seoDescription: 'Lamp description',
          }, { updatedAt: '2026-05-01T10:01:00.000Z' })],
        })
      }

      if (url === '/admin/api/cms/data/rows/entry_1/table' && init?.method === 'PATCH') {
        return json({
          row: makeRow('entry_1', 'products', {
            title: 'Portable lamp',
            slug: 'portable-lamp',
            body: 'A compact lamp',
            featuredMedia: imageAsset.id,
            seoTitle: 'SEO lamp',
            seoDescription: 'Lamp description',
          }, { updatedAt: '2026-05-01T10:05:00.000Z' }),
        })
      }

      if (url === '/admin/api/cms/data/tables/products/rows' && init?.method === 'GET') {
        return json({
          rows: [makeRow('entry_1', 'products', {
            title: 'Portable lamp',
            slug: 'portable-lamp',
            body: 'A compact lamp',
            featuredMedia: imageAsset.id,
            seoTitle: 'SEO lamp',
            seoDescription: 'Lamp description',
          }, { updatedAt: '2026-05-01T10:05:00.000Z' })],
        })
      }

      if (url === '/admin/api/cms/media') {
        return json({ assets: [imageAsset] })
      }

      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    expect(await screen.findByDisplayValue('Portable lamp')).toBeDefined()
    expect(screen.getByLabelText('SEO title')).toBeDefined()
    expect(screen.getByText('Featured media')).toBeDefined()

    fireEvent.click(screen.getByLabelText('Collection'))
    fireEvent.click(await screen.findByRole('option', { name: 'Products' }))

    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/rows/entry_1/table' &&
        call.init?.method === 'PATCH' &&
        call.init?.body === JSON.stringify({ tableId: 'products' })
      )).toBe(true)
    })

    expect(await screen.findByRole('region', { name: 'Products' })).toBeDefined()
    expect(screen.queryByLabelText('SEO title')).toBeNull()
    expect(screen.queryByText('Featured media')).toBeNull()
  })

  it('opens explorer-style context menus for content collections and entries', async () => {
    const calls: FetchCall[] = []
    ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = String(input)

      if (url === '/admin/api/cms/data/tables' && init?.method === 'GET') {
        return json({
          tables: [
            makeTable('posts', 'Posts', 'posts', '/posts', 'Post', 'Posts'),
            makeTable('products', 'Products', 'products', '/products', 'Product', 'Products'),
          ],
        })
      }

      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return json({
          rows: [
            makeRow('entry_1', 'posts', { title: 'Summer sale', slug: 'summer-sale', body: 'Sale copy', featuredMedia: null, seoTitle: '', seoDescription: '' }, { updatedAt: '2026-05-01T10:01:00.000Z' }),
            makeRow('entry_2', 'posts', { title: 'Published story', slug: 'published-story', body: 'Published copy', featuredMedia: null, seoTitle: '', seoDescription: '' }, { status: 'published', updatedAt: '2026-05-01T10:02:00.000Z', publishedAt: '2026-05-01T10:02:00.000Z' }),
          ],
        })
      }

      if (url === '/admin/api/cms/data/tables/products/rows' && init?.method === 'GET') {
        return json({ rows: [] })
      }

      if (url === '/admin/api/cms/data/rows/entry_1' && init?.method === 'PATCH') {
        const draft = JSON.parse(String(init.body))
        return json({
          row: {
            ...makeRow('entry_1', 'posts', draft.cells ?? {}),
            updatedAt: '2026-05-01T10:05:00.000Z',
          },
        })
      }

      if (url === '/admin/api/cms/data/rows/entry_1/publish' && init?.method === 'POST') {
        return json({
          row: makeRow('entry_1', 'posts', { title: 'Summer sale', slug: 'summer-sale', body: 'Sale copy', featuredMedia: null, seoTitle: '', seoDescription: '' }, { status: 'published', updatedAt: '2026-05-01T10:03:00.000Z', publishedAt: '2026-05-01T10:03:00.000Z' }),
        })
      }

      if (url === '/admin/api/cms/data/rows/entry_2/status' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return json({
          row: makeRow('entry_2', 'posts', { title: 'Published story', slug: 'published-story', body: 'Published copy', featuredMedia: null, seoTitle: '', seoDescription: '' }, { status: body.status, updatedAt: '2026-05-01T10:04:00.000Z' }),
        })
      }

      if (url === '/admin/api/cms/data/rows/entry_1' && init?.method === 'DELETE') {
        return json({
          row: makeRow('entry_1', 'posts', { title: 'Winter sale', slug: 'winter-sale', body: 'Sale copy', featuredMedia: null, seoTitle: '', seoDescription: '' }, { updatedAt: '2026-05-01T10:06:00.000Z', deletedAt: '2026-05-01T10:06:00.000Z' }),
        })
      }

      if (url === '/admin/api/cms/data/tables/products' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body))
        return json({
          table: {
            ...makeTable('products', 'Products', 'products', '/products', 'Product', 'Products'),
            ...body,
            updatedAt: '2026-05-01T10:07:00.000Z',
          },
        })
      }

      if (url === '/admin/api/cms/data/tables/products' && init?.method === 'DELETE') {
        return json({
          table: makeTable('products', 'Catalog', 'catalog', '/catalog', 'Product', 'Catalog'),
        })
      }

      if (url === '/admin/api/cms/media') {
        return json({ assets: [] })
      }

      const ambient = ambientFetchFallback(url)
      if (ambient) return ambient
      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    const postsRegion = await screen.findByRole('region', { name: 'Posts' })
    const publishedButton = (await within(postsRegion).findByText('Published story')).closest('button')
    expect(publishedButton).toBeTruthy()

    fireEvent.contextMenu(publishedButton as HTMLButtonElement, { clientX: 240, clientY: 300 })
    let menu = screen.getByRole('menu', { name: 'Content item options' })
    expect(within(menu).getByRole('menuitem', { name: /open in new tab/i })).toBeDefined()
    expect(within(menu).getByRole('menuitem', { name: /convert to draft/i })).toBeDefined()
    expect(within(menu).queryByRole('menuitem', { name: /^publish$/i })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /convert to draft/i }))
    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/rows/entry_2/status' &&
        call.init?.method === 'PATCH' &&
        call.init?.body === JSON.stringify({ status: 'draft' })
      )).toBe(true)
    })

    const entryButton = (await within(postsRegion).findByText('Summer sale')).closest('button')
    expect(entryButton).toBeTruthy()

    fireEvent.contextMenu(entryButton as HTMLButtonElement, { clientX: 240, clientY: 320 })
    menu = screen.getByRole('menu', { name: 'Content item options' })
    expect(within(menu).getByRole('menuitem', { name: /^publish$/i })).toBeDefined()
    expect(within(menu).queryByRole('menuitem', { name: /convert to draft/i })).toBeNull()
    expect(within(menu).queryByRole('menuitem', { name: /open in new tab/i })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^publish$/i }))
    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/rows/entry_1/publish' &&
        call.init?.method === 'POST'
      )).toBe(true)
    })

    fireEvent.contextMenu(entryButton as HTMLButtonElement, { clientX: 240, clientY: 320 })
    menu = screen.getByRole('menu', { name: 'Content item options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^rename$/i }))

    let dialog = await screen.findByRole('dialog', { name: /rename post/i })
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Winter sale' } })
    fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'winter-sale' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }))

    expect(await within(postsRegion).findByText('Winter sale')).toBeDefined()
    expect(calls.some((call) =>
      String(call.input) === '/admin/api/cms/data/rows/entry_1' &&
      call.init?.method === 'PATCH' &&
      call.init?.body === JSON.stringify({
        cells: {
          title: 'Winter sale',
          slug: 'winter-sale',
          body: 'Sale copy',
          featuredMedia: null,
          seoTitle: '',
          seoDescription: '',
        },
      })
    )).toBe(true)

    const collectionsRegion = screen.getByRole('region', { name: 'Collections' })
    const productsButton = within(collectionsRegion)
      .getByText('Products')
      .closest('button')
    expect(productsButton).toBeTruthy()

    fireEvent.contextMenu(productsButton as HTMLButtonElement, { clientX: 220, clientY: 210 })
    menu = screen.getByRole('menu', { name: 'Content item options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /collection settings/i }))

    dialog = await screen.findByRole('dialog', { name: /collection settings/i })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Catalog' } })
    fireEvent.change(within(dialog).getByLabelText('Slug'), { target: { value: 'catalog' } })
    fireEvent.change(within(dialog).getByLabelText('URL path'), { target: { value: '/catalog' } })
    fireEvent.change(within(dialog).getByLabelText('Plural label'), { target: { value: 'Catalog' } })
    fireEvent.click(within(dialog).getByRole('button', { name: /^save$/i }))

    expect(await within(collectionsRegion).findByText('Catalog')).toBeDefined()
    expect(calls.some((call) =>
      String(call.input) === '/admin/api/cms/data/tables/products' &&
      call.init?.method === 'PATCH' &&
      call.init?.body === JSON.stringify({
        name: 'Catalog',
        slug: 'catalog',
        routeBase: '/catalog',
        singularLabel: 'Product',
        pluralLabel: 'Catalog',
        fields: allBuiltInFields,
      })
    )).toBe(true)

    const renamedEntryButton = within(screen.getByRole('region', { name: 'Posts' }))
      .getByRole('button', { name: /winter sale draft/i })
    fireEvent.contextMenu(renamedEntryButton as HTMLButtonElement, { clientX: 240, clientY: 320 })
    menu = screen.getByRole('menu', { name: 'Content item options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^delete$/i }))

    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/rows/entry_1' &&
        call.init?.method === 'DELETE'
      )).toBe(true)
    })
    expect(within(screen.getByRole('region', { name: 'Posts' })).queryByText('Winter sale')).toBeNull()

    const catalogButton = within(screen.getByRole('region', { name: 'Collections' }))
      .getByText('Catalog')
      .closest('button')
    fireEvent.contextMenu(catalogButton as HTMLButtonElement, { clientX: 220, clientY: 210 })
    menu = screen.getByRole('menu', { name: 'Content item options' })
    fireEvent.click(within(menu).getByRole('menuitem', { name: /^delete$/i }))

    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/admin/api/cms/data/tables/products' &&
        call.init?.method === 'DELETE'
      )).toBe(true)
    })
    expect(within(screen.getByRole('region', { name: 'Collections' })).queryByText('Catalog')).toBeNull()
  })

  it('opens the selected post in a new browser tab from the content toolbar', async () => {
    const originalOpen = window.open
    const openCalls: unknown[] = []
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(
        <AdminTestProviders>
          <ContentPage />
        </AdminTestProviders>,
      )

      await screen.findByRole('region', { name: 'Posts' })
      fireEvent.click(
        within(screen.getByRole('region', { name: 'Posts' }))
          .getByRole('button', { name: /new post/i }),
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /more publishing actions/i }).hasAttribute('disabled')).toBe(false)
      })
      fireEvent.click(screen.getByRole('button', { name: /more publishing actions/i }))
      const menu = screen.getByRole('menu', { name: /publishing actions/i })
      fireEvent.click(within(menu).getByRole('menuitem', { name: /open live post/i }))

      expect(openCalls).toEqual([['/posts/untitled', '_blank', 'noopener,noreferrer']])
    } finally {
      window.open = originalOpen
    }
  })

  it('opens semantic paragraph, heading level, and media choices from the block chrome', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /change block 1 type/i }))

    expect(screen.getByRole('menuitem', { name: /paragraph/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 2/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 3/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 4/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /media/i })).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: /^heading$/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /image/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /video/i })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /heading 3/i }))
    expect(screen.getByRole('heading', { level: 3, name: 'First block' })).toBeDefined()

    clickToolbarSaveDraft()
    await screen.findByText('Draft saved')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/admin/api/cms/data/rows/entry_1' && call.init?.method === 'PATCH')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      cells: {
        title: 'Untitled',
        slug: 'untitled',
        body: '### First block',
        featuredMedia: null,
        seoTitle: '',
        seoDescription: '',
      },
    }))
  })

  it('uses one media block type that can select image and video assets', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    await screen.findByTestId('content-block-0')
    fireEvent.click(screen.getByRole('button', { name: /change block 1 type/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /media/i }))

    fireEvent.click(screen.getByRole('button', { name: /choose media/i }))
    // Workspace-style MediaPickerModal: pick the asset, then commit via
    // "Use selected" — the modal no longer auto-commits on first click.
    fireEvent.click(await screen.findByRole('button', { name: /hero\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /use selected/i }))

    expect(screen.getAllByTestId(/content-block-frame-/)).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'hero.png' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /replace media/i }))
    fireEvent.click(await screen.findByRole('button', { name: /intro\.mp4/i }))
    fireEvent.click(screen.getByRole('button', { name: /use selected/i }))

    expect(screen.getAllByTestId(/content-block-frame-/)).toHaveLength(1)
    expect(screen.getByText('/uploads/intro.mp4')).toBeDefined()

    clickToolbarSaveDraft()
    await screen.findByText('Draft saved')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/admin/api/cms/data/rows/entry_1' && call.init?.method === 'PATCH')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      cells: {
        title: 'Untitled',
        slug: 'untitled',
        body: '@[video](/uploads/intro.mp4)',
        featuredMedia: null,
        seoTitle: '',
        seoDescription: '',
      },
    }))
  })

  it('reorders blocks by vertically dragging the block handle', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /add text/i }))
    const secondBlock = await screen.findByTestId('content-block-1')
    secondBlock.textContent = 'Second block'
    fireEvent.input(secondBlock)

    expect(screen.getByLabelText('Drag block 1')).toBeDefined()

    const firstFrame = screen.getByTestId('content-block-frame-0')
    const secondFrame = screen.getByTestId('content-block-frame-1')
    Object.defineProperty(firstFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 150,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(secondFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 170,
        bottom: 220,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 170,
        toJSON: () => ({}),
      }),
    })

    const firstHandle = screen.getByLabelText('Drag block 1')
    fireEvent.pointerDown(firstHandle, {
      pointerId: 1,
      button: 0,
      clientX: 30,
      clientY: 125,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })

    const frames = screen.getAllByTestId(/content-block-frame-/)
    expect(frames[0].textContent).toContain('Second block')
    expect(frames[1].textContent).toContain('First block')
  })

  it('keeps the dragged block visually anchored on drop before settling into place', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /add text/i }))
    const secondBlock = await screen.findByTestId('content-block-1')
    secondBlock.textContent = 'Second block'
    fireEvent.input(secondBlock)

    const firstFrame = screen.getByTestId('content-block-frame-0')
    const secondFrame = screen.getByTestId('content-block-frame-1')
    Object.defineProperty(firstFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 150,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(secondFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 170,
        bottom: 220,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 170,
        toJSON: () => ({}),
      }),
    })

    const firstHandle = screen.getByLabelText('Drag block 1')
    fireEvent.pointerDown(firstHandle, {
      pointerId: 1,
      button: 0,
      clientX: 30,
      clientY: 125,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })

    const droppedFrame = screen.getAllByTestId(/content-block-frame-/)[1]
    expect(droppedFrame.textContent).toContain('First block')
    expect(droppedFrame.getAttribute('data-drop-phase')).toBe('position')
    expect(droppedFrame.style.getPropertyValue('--content-block-translate-y')).toBe('10px')
  })

  it('edits slug, status, and featured media from the settings sidebar', async () => {
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'My first post' } })
    clickToolbarPublish()
    const publishedButton = await screen.findByRole('button', { name: /^published$/i }) as HTMLButtonElement
    expect(publishedButton.getAttribute('aria-disabled')).toBe('true')

    const slugInput = screen.getByLabelText('Slug') as HTMLInputElement
    expect(slugInput.disabled).toBe(false)
    fireEvent.change(slugInput, { target: { value: 'updated slug' } })

    fireEvent.click(screen.getByRole('button', { name: /choose featured media/i }))
    // Workspace-style MediaPickerModal: pick + commit via "Use selected".
    fireEvent.click(await screen.findByRole('button', { name: /hero\.png/i }))
    fireEvent.click(screen.getByRole('button', { name: /use selected/i }))

    clickToolbarSaveDraft()
    await screen.findByText('Draft saved')

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'unpublished' },
    })
    await screen.findByText('Unpublished')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/admin/api/cms/data/rows/entry_1' && call.init?.method === 'PATCH')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      cells: {
        title: 'My first post',
        slug: 'updated-slug',
        body: '',
        featuredMedia: imageAsset.id,
        seoTitle: '',
        seoDescription: '',
      },
    }))
    expect(calls.some((call) =>
      String(call.input) === '/admin/api/cms/data/rows/entry_1/status' &&
      call.init?.method === 'PATCH' &&
      call.init?.body === JSON.stringify({ status: 'unpublished' })
    )).toBe(true)
  })

  it('hydrates saved featured media metadata when reopening the content page', async () => {
    const baseFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/admin/api/cms/data/tables/posts/rows' && init?.method === 'GET') {
        return json({
          rows: [makeRow('entry_1', 'posts', {
            title: 'First post',
            slug: 'first-post',
            body: '',
            featuredMedia: imageAsset.id,
            seoTitle: '',
            seoDescription: '',
          }, {
            status: 'published',
            updatedAt: '2026-05-01T10:01:00.000Z',
            publishedAt: '2026-05-01T10:01:00.000Z',
          })],
        })
      }

      return baseFetch(input, init)
    }

    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    // The shared MediaPickerField tile renders filename + a metadata line
    // (mime · size · dimensions) instead of the saved publicPath — same
    // shape used by the property panel's media controls.
    expect(await screen.findByText(imageAsset.filename)).toBeDefined()
    expect(screen.getByText(new RegExp(imageAsset.mimeType.replace('/', '\\/')))).toBeDefined()
    expect(screen.queryByText(imageAsset.id)).toBeNull()
  })

  it('keeps typed paragraph text in left-to-right order while editing', async () => {
    const user = userEvent.setup()
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    await user.click(firstBlock)
    await user.keyboard('hello there')

    expect(firstBlock.textContent).toBe('hello there')
  })

  it('moves typing into the new paragraph after pressing Enter', async () => {
    const user = userEvent.setup()
    render(
      <AdminTestProviders>
        <ContentPage />
      </AdminTestProviders>,
    )

    await screen.findByRole('region', { name: 'Posts' })
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Posts' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    await user.click(firstBlock)
    await user.keyboard('hello')
    await user.keyboard('{Enter}')

    const secondBlock = await screen.findByTestId('content-block-1')
    expect(document.activeElement).toBe(secondBlock)

    await user.keyboard('world')

    expect(firstBlock.textContent).toBe('hello')
    expect(secondBlock.textContent).toBe('world')
  })

  it('keeps contenteditable text blocks uncontrolled so rerenders do not reset the caret', () => {
    const src = readFileSync(join(process.cwd(), 'src/admin/pages/content/RichMarkdownEditor.tsx'), 'utf8')

    expect(src).toContain('EditableTextBlock')
    expect(src).not.toContain('{block.text}')
  })

  it('uses the content publish button as the single published-state indicator', () => {
    const src = readFileSync(join(process.cwd(), 'src/admin/pages/content/components/ContentToolbar/ContentToolbar.tsx'), 'utf8')

    expect(src).toContain("'Retry publish'")
    expect(src).toContain("'Published'")
    expect(src).toContain('statusLabel={isCleanPublished ? null : statusText}')
    expect(src).toContain('publishDisabled={!selectedEntry || !canPublish || isPublishing || isCleanPublished}')
    expect(src).not.toContain("'Live'")
    expect(src).toContain('isCleanPublished ? CheckIcon')
    expect(src).not.toContain("'Publish failed'")
  })
})
