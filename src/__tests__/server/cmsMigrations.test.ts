import { describe, expect, it } from 'bun:test'
import { CMS_MIGRATIONS } from '../../../server/cms/migrations'

describe('CMS migrations', () => {
  it('creates the required CMS tables', () => {
    const sql = CMS_MIGRATIONS.map((m) => m.sql).join('\n')
    expect(sql).toContain('create table if not exists site')
    expect(sql).toContain('create table if not exists admin_users')
    expect(sql).toContain('create table if not exists sessions')
    expect(sql).toContain('create table if not exists pages')
    expect(sql).toContain('create table if not exists page_versions')
    expect(sql).toContain('create table if not exists media_assets')
  })

  it('stores draft and published page documents as jsonb', () => {
    const sql = CMS_MIGRATIONS.map((m) => m.sql).join('\n')
    expect(sql).toContain('draft_document_json jsonb not null')
    expect(sql).toContain('snapshot_json jsonb not null')
  })

  it('stores page sort order for reconstructing the editor draft', () => {
    const sql = CMS_MIGRATIONS.map((m) => m.sql).join('\n')
    expect(sql).toContain('sort_order integer not null default 0')
  })

  it('enforces a single-site row', () => {
    const sql = CMS_MIGRATIONS.map((m) => m.sql).join('\n')
    expect(sql).toContain("id text primary key default 'default'")
    expect(sql).toContain("constraint site_singleton check (id = 'default')")
  })
})
