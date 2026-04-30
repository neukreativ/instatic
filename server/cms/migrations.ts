import type { DbClient } from './db'

export interface Migration {
  id: string
  sql: string
}

export const CMS_MIGRATIONS: Migration[] = [
  {
    id: '001_cms_foundation',
    sql: `
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      );

      create table if not exists site (
        id text primary key default 'default',
        name text not null,
        settings_json jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint site_singleton check (id = 'default')
      );

      create table if not exists admin_users (
        id text primary key,
        email text not null unique,
        password_hash text not null,
        created_at timestamptz not null default now()
      );

      create table if not exists sessions (
        id_hash text primary key,
        admin_user_id text not null references admin_users(id) on delete cascade,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      create table if not exists pages (
        id text primary key,
        title text not null,
        slug text not null unique,
        status text not null default 'draft',
        draft_document_json jsonb not null,
        active_version_id text,
        sort_order integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists page_versions (
        id text primary key,
        page_id text not null references pages(id) on delete cascade,
        version integer not null,
        snapshot_json jsonb not null,
        published_at timestamptz not null default now(),
        published_by text references admin_users(id) on delete set null,
        unique (page_id, version)
      );

      create table if not exists media_assets (
        id text primary key,
        filename text not null,
        mime_type text not null,
        size_bytes bigint not null,
        storage_path text not null,
        public_path text not null unique,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: '002_page_sort_order',
    sql: `
      alter table pages
        add column if not exists sort_order integer not null default 0;
    `,
  },
]

export async function runMigrations(db: DbClient): Promise<void> {
  await db.query(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  for (const migration of CMS_MIGRATIONS) {
    const existing = await db.query<{ id: string }>(
      'select id from schema_migrations where id = $1',
      [migration.id],
    )
    if (existing.rows.length > 0) continue

    await db.query('begin')
    try {
      await db.query(migration.sql)
      await db.query('insert into schema_migrations (id) values ($1)', [migration.id])
      await db.query('commit')
    } catch (err) {
      await db.query('rollback')
      throw err
    }
  }
}
