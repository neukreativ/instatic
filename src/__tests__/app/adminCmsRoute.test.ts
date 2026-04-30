import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

describe('admin CMS route wiring', () => {
  it('routes /admin to the editor in CMS persistence mode', () => {
    const router = readFileSync(join(root, 'src/app/router.ts'), 'utf8')

    expect(router).toContain("path: '/admin'")
    expect(router).toContain("persistenceMode: 'cms'")
  })

  it('uses the server CMS adapter without local last-project tracking', () => {
    const editor = readFileSync(join(root, 'src/app/EditorLayout.tsx'), 'utf8')

    expect(editor).toContain('cmsAdapter')
    expect(editor).toContain('rememberLastProject: false')
  })
})
