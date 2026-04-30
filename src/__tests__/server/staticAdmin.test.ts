import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DbClient, DbResult } from '../../../server/cms/db'
import { handleServerRequest } from '../../../server/router'

class StaticFakeDb implements DbClient {
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<DbResult<Row>> {
    return { rows: [], rowCount: 0 }
  }
}

function createStaticDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'page-builder-static-'))
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<div id="root">admin app</div>')
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log("admin")')
  return dir
}

describe('self-hosted admin static serving', () => {
  it('serves the built admin SPA at /admin', async () => {
    const staticDir = createStaticDir()
    try {
      const res = await handleServerRequest(new Request('http://localhost/admin'), {
        db: new StaticFakeDb(),
        staticDir,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('text/html')
      expect(await res.text()).toContain('admin app')
    } finally {
      rmSync(staticDir, { recursive: true, force: true })
    }
  })

  it('serves built asset files from /assets', async () => {
    const staticDir = createStaticDir()
    try {
      const res = await handleServerRequest(new Request('http://localhost/assets/app.js'), {
        db: new StaticFakeDb(),
        staticDir,
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toContain('javascript')
      expect(await res.text()).toContain('console.log')
    } finally {
      rmSync(staticDir, { recursive: true, force: true })
    }
  })
})
