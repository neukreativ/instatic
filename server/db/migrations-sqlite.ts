import type { Migration } from './runMigrations'

/**
 * SQLite dialect translations applied throughout this file:
 *   jsonb            → text          (stored as JSON strings; parsed by the adapter)
 *   timestamptz      → text          (stored as ISO 8601 strings)
 *   bytea            → blob
 *   bigint           → integer       (SQLite integers are 64-bit)
 *   boolean          → integer       (1 = true, 0 = false; repos use Boolean(row.enabled))
 *   default now()    → default current_timestamp  (no parens; SQLite special-cases this)
 *   '{}'::jsonb      → '{}'          (no PG cast syntax)
 *   distinct on (…)  → window-function subquery  (migration 009)
 *   multi-ADD COLUMN → split into one ALTER TABLE per column (SQLite limitation)
 *
 * Migration IDs and order are identical to migrations-pg.ts — enforced by the
 * architecture test downstream.
 */
export const sqliteMigrations: Migration[] = [
  {
    id: '001_cms_foundation',
    sql: `
      create table if not exists schema_migrations (
        id text primary key,
        applied_at text not null default current_timestamp
      );

      create table if not exists site (
        id text primary key default 'default',
        name text not null,
        settings_json text not null default '{}',
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );

      create table if not exists roles (
        id text primary key,
        slug text not null unique,
        name text not null,
        description text not null default '',
        is_system integer not null default 0,
        capabilities_json text not null default '[]',
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );

      insert into roles (id, slug, name, description, is_system, capabilities_json)
      values
        ('owner', 'owner', 'Owner', 'Permanent installation owner with full system access.', 1, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","roles.manage","audit.read"]'),
        ('admin', 'admin', 'Admin', 'Full admin access.', 1, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","roles.manage","audit.read"]'),
        ('editor', 'editor', 'Editor', 'Can edit and publish assigned site content.', 1, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.publish.own","media.manage"]'),
        ('content-manager', 'content-manager', 'Content Manager', 'Can manage all content entries and collections.', 1, '["site.read","content.create","content.edit.any","content.publish.any","content.manage","media.manage"]'),
        ('viewer', 'viewer', 'Viewer', 'Read-only admin access.', 1, '["site.read"]'),
        ('subscriber', 'subscriber', 'Subscriber', 'Reserved for future public member accounts.', 1, '[]')
      on conflict (id) do update
        set slug = excluded.slug,
            name = excluded.name,
            description = excluded.description,
            is_system = excluded.is_system,
            capabilities_json = excluded.capabilities_json,
            updated_at = current_timestamp;

      create table if not exists users (
        id text primary key,
        email text not null,
        email_normalized text not null,
        display_name text not null,
        password_hash text not null,
        status text not null default 'active',
        role_id text not null references roles(id) on delete restrict,
        last_login_at text,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp,
        deleted_at text,
        constraint users_status_check check (status in ('active', 'suspended'))
      );

      create unique index if not exists users_email_normalized_active_idx
        on users (email_normalized)
        where deleted_at is null;

      create unique index if not exists users_single_active_owner_idx
        on users (role_id)
        where role_id = 'owner' and status = 'active' and deleted_at is null;

      create table if not exists sessions (
        id_hash text primary key,
        user_id text not null references users(id) on delete cascade,
        created_at text not null default current_timestamp,
        last_seen_at text not null default current_timestamp,
        expires_at text not null,
        revoked_at text,
        ip_address text,
        user_agent text
      );

      create index if not exists sessions_user_idx
        on sessions (user_id, last_seen_at desc);

      create table if not exists audit_events (
        id text primary key,
        actor_user_id text references users(id) on delete set null,
        action text not null,
        target_type text,
        target_id text,
        metadata_json text not null default '{}',
        ip_address text,
        user_agent text,
        created_at text not null default current_timestamp
      );

      create index if not exists audit_events_created_idx
        on audit_events (created_at desc);

      create table if not exists pages (
        id text primary key,
        title text not null,
        slug text not null unique,
        status text not null default 'draft',
        draft_document_json text not null,
        active_version_id text,
        sort_order integer not null default 0,
        owner_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );

      create table if not exists page_versions (
        id text primary key,
        page_id text not null references pages(id) on delete cascade,
        version integer not null,
        snapshot_json text not null,
        published_at text not null default current_timestamp,
        published_by_user_id text references users(id) on delete set null,
        unique (page_id, version)
      );

      create table if not exists media_assets (
        id text primary key,
        filename text not null,
        mime_type text not null,
        size_bytes integer not null,
        storage_path text not null,
        public_path text not null unique,
        uploaded_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp
      );
    `,
  },
  {
    id: '002_page_sort_order',
    // `sort_order` is already present in the `pages` CREATE TABLE above (001).
    // SQLite does not support `ADD COLUMN IF NOT EXISTS` (added only in 3.37),
    // and the column is guaranteed to exist from migration 001, so this is a
    // tracked no-op that records the schema version step without touching DDL.
    sql: `select 1`,
  },
  {
    id: '003_content_documents',
    // See migrations-pg.ts:003 — same semantic effect, SQLite dialect.
    // SQLite has no jsonb / timestamptz — `_json` columns are TEXT (the
    // SQLite adapter auto-parses on read / stringifies on write). The
    // active-version FK is inline in the CREATE TABLE; SQLite accepts
    // forward FK references provided both tables exist before the first
    // INSERT that would trigger the check.
    sql: `
      create table if not exists data_tables (
        id text primary key,
        name text not null,
        slug text not null,
        kind text not null default 'data',
        route_base text not null default '',
        singular_label text not null,
        plural_label text not null,
        primary_field_id text not null default 'title',
        fields_json text not null default '[]',
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp,
        deleted_at text,
        constraint data_tables_kind_check check (kind in ('postType', 'data'))
      );

      create unique index if not exists data_tables_slug_active_idx
        on data_tables (slug)
        where deleted_at is null;

      insert into data_tables (
        id, name, slug, kind, route_base, singular_label, plural_label,
        primary_field_id, fields_json
      )
      values (
        'posts',
        'Posts',
        'posts',
        'postType',
        '/posts',
        'Post',
        'Posts',
        'title',
        '[{"type":"text","id":"title","label":"Title","required":true,"builtIn":true},{"type":"text","id":"slug","label":"Slug","required":true,"builtIn":true},{"type":"richText","id":"body","label":"Body","format":"markdown","builtIn":true},{"type":"media","id":"featuredMedia","label":"Featured media","mediaKind":"image","builtIn":true},{"type":"text","id":"seoTitle","label":"SEO title","builtIn":true},{"type":"longText","id":"seoDescription","label":"SEO description","builtIn":true}]'
      )
      on conflict (id) do update
        set name = excluded.name,
            slug = excluded.slug,
            kind = excluded.kind,
            route_base = excluded.route_base,
            singular_label = excluded.singular_label,
            plural_label = excluded.plural_label,
            primary_field_id = excluded.primary_field_id,
            fields_json = excluded.fields_json,
            updated_at = current_timestamp,
            deleted_at = null;

      create table if not exists data_rows (
        id text primary key,
        table_id text not null references data_tables(id) on delete restrict,
        cells_json text not null default '{}',
        slug text not null default '',
        status text not null default 'draft',
        active_version_id text references data_row_versions(id) on delete set null,
        author_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        published_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp,
        published_at text,
        deleted_at text,
        constraint data_rows_status_check check (status in ('draft', 'published', 'unpublished'))
      );

      -- The slug uniqueness predicate excludes empty strings so non-routable
      -- tables (data-kind, no slug field) can have many rows without slug
      -- collisions.
      create unique index if not exists data_rows_table_slug_active_idx
        on data_rows (table_id, slug)
        where deleted_at is null and slug <> '';

      create index if not exists data_rows_table_idx
        on data_rows (table_id, updated_at desc)
        where deleted_at is null;

      create table if not exists data_row_versions (
        id text primary key,
        row_id text not null references data_rows(id) on delete cascade,
        version_number integer not null,
        cells_json text not null default '{}',
        slug text not null default '',
        published_by_user_id text references users(id) on delete set null,
        published_at text not null default current_timestamp,
        created_at text not null default current_timestamp,
        unique (row_id, version_number)
      );

      create index if not exists data_row_versions_row_latest_idx
        on data_row_versions (row_id, version_number desc);

      create table if not exists data_row_redirects (
        id text primary key,
        table_id text not null references data_tables(id) on delete cascade,
        from_route_base text not null,
        from_slug text not null,
        target_row_id text not null references data_rows(id) on delete cascade,
        created_at text not null default current_timestamp
      );

      create unique index if not exists data_row_redirects_source_idx
        on data_row_redirects (from_route_base, from_slug);

      create index if not exists data_row_redirects_target_idx
        on data_row_redirects (target_row_id, created_at desc);
    `,
  },
  {
    id: '004_plugins_mvp',
    sql: `
      create table if not exists installed_plugins (
        id text primary key,
        name text not null,
        version text not null,
        enabled integer not null default 1,
        granted_permissions_json text not null default '[]',
        manifest_json text not null,
        installed_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );

      create index if not exists installed_plugins_enabled_idx
        on installed_plugins (enabled, installed_at desc);
    `,
  },
  {
    id: '005_plugin_records',
    sql: `
      create table if not exists plugin_records (
        id text primary key,
        plugin_id text not null references installed_plugins(id) on delete cascade,
        resource_id text not null,
        data_json text not null,
        created_at text not null default current_timestamp,
        updated_at text not null default current_timestamp
      );

      create index if not exists plugin_records_resource_idx
        on plugin_records (plugin_id, resource_id, created_at desc);
    `,
  },
  {
    id: '006_plugin_permission_grants',
    // `granted_permissions_json` is already present in the `installed_plugins`
    // CREATE TABLE in migration 004. Tracked no-op — see note on 002 above.
    sql: `select 1`,
  },
  {
    id: '007_plugin_lifecycle_status',
    // SQLite does not support multiple ADD COLUMN clauses in one ALTER TABLE;
    // split into two statements. No `IF NOT EXISTS` — SQLite ≤ 3.37 does not
    // support that form, and the migration system guarantees each block runs
    // exactly once (via schema_migrations tracking), so the guard is unnecessary.
    sql: `
      alter table installed_plugins
        add column lifecycle_status text not null default 'installed';

      alter table installed_plugins
        add column last_error text;
    `,
  },
  {
    id: '008_content_collection_route_base',
    // Folded into the unified `data_tables` CREATE TABLE in migration 003.
    // Tracked no-op — see migrations-pg.ts:008.
    sql: `select 1`,
  },
  {
    id: '009_content_entry_active_version_and_redirects',
    // `active_version_id` on `data_rows` and the `data_row_redirects` table
    // are now created as part of the unified migration 003. Tracked no-op.
    sql: `select 1`,
  },
  {
    id: '010_content_collection_fields',
    // `fields_json` is now created as part of the unified `data_tables` in
    // migration 003. Tracked no-op — see note on 002 above.
    sql: `select 1`,
  },
  {
    id: '011_published_runtime_assets',
    sql: `
      create table if not exists published_runtime_assets (
        id text primary key,
        page_version_id text not null references page_versions(id) on delete cascade,
        asset_path text not null,
        public_path text not null unique,
        content_type text not null,
        content_bytes blob not null,
        created_at text not null default current_timestamp
      );

      create index if not exists published_runtime_assets_page_version_idx
        on published_runtime_assets (page_version_id);
    `,
  },
  {
    id: '012_plugin_settings',
    sql: `
      alter table installed_plugins
        add column settings_json text not null default '{}';
    `,
  },
  {
    id: '013_auth_lockout',
    sql: `
      alter table users
        add column failed_login_count integer not null default 0;

      alter table users
        add column locked_until text;

      create table if not exists login_attempts (
        id text primary key,
        attempted_at text not null default current_timestamp,
        email_norm text,
        ip_address text,
        user_id text references users(id) on delete set null,
        result text not null
          constraint login_attempts_result_check
          check (result in ('success', 'bad_password', 'no_user', 'account_disabled', 'locked', 'rate_limited', 'mfa_failed'))
      );

      create index if not exists login_attempts_ip_idx
        on login_attempts (ip_address, attempted_at desc);

      create index if not exists login_attempts_email_idx
        on login_attempts (email_norm, attempted_at desc)
        where email_norm is not null;
    `,
  },
  {
    id: '014_session_devices_and_mfa',
    sql: `
      alter table sessions
        add column device_label text not null default '';

      alter table sessions
        add column mfa_passed_at text;

      alter table sessions
        add column step_up_expires_at text;

      create index if not exists sessions_user_active_idx
        on sessions (user_id, expires_at)
        where revoked_at is null;

      alter table users
        add column avatar_media_id text references media_assets(id) on delete set null;

      alter table users
        add column password_updated_at text;

      alter table users
        add column mfa_enabled integer not null default 0;

      alter table users
        add column mfa_enabled_at text;

      alter table users
        add column mfa_totp_secret text;

      alter table users
        add column mfa_recovery_code_hashes_json text not null default '[]';
    `,
  },
  {
    id: '015_plugin_crash_events',
    sql: `
      create table if not exists plugin_crash_events (
        id text primary key,
        plugin_id text not null,
        occurred_at text not null default current_timestamp,
        reason text not null,
        stack text
      );

      create index if not exists plugin_crash_events_plugin_idx
        on plugin_crash_events (plugin_id, occurred_at desc);
    `,
  },
  {
    id: '016_media_assets_metadata',
    // See migrations-pg.ts:016 — same semantic effect, SQLite dialect.
    // SQLite has no native boolean / timestamptz / jsonb — use integer / text.
    // The `_json` suffix triggers the SQLite adapter's auto JSON.parse/stringify.
    sql: `
      alter table media_assets
        add column alt_text text not null default '';

      alter table media_assets
        add column caption text not null default '';

      alter table media_assets
        add column title text not null default '';

      alter table media_assets
        add column tags_json text not null default '[]';

      alter table media_assets
        add column width integer;

      alter table media_assets
        add column height integer;

      alter table media_assets
        add column duration_ms integer;

      alter table media_assets
        add column focal_x real not null default 0.5;

      alter table media_assets
        add column focal_y real not null default 0.5;

      alter table media_assets
        add column dominant_color text;

      alter table media_assets
        add column deleted_at text;

      alter table media_assets
        add column replaced_at text;

      -- Responsive pipeline (docs/responsive-media.md) — see migrations-pg.ts.
      alter table media_assets
        add column blur_hash text;

      alter table media_assets
        add column variants_json text not null default '[]';

      alter table media_assets
        add column poster_path text;

      create index if not exists media_assets_deleted_idx
        on media_assets (deleted_at);
    `,
  },
  {
    id: '017_media_folders',
    // See migrations-pg.ts:017 — many-to-many folder model.
    sql: `
      create table if not exists media_folders (
        id text primary key,
        parent_id text references media_folders(id) on delete cascade,
        name text not null,
        slug text not null,
        sort_order integer not null default 0,
        created_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp
      );

      create unique index if not exists media_folders_parent_slug_idx
        on media_folders (coalesce(parent_id, ''), slug);

      create table if not exists media_asset_folders (
        asset_id text not null references media_assets(id) on delete cascade,
        folder_id text not null references media_folders(id) on delete cascade,
        primary key (asset_id, folder_id)
      );

      create index if not exists media_asset_folders_folder_idx
        on media_asset_folders (folder_id);
    `,
  },
  {
    id: '018_media_smart_folders',
    // See migrations-pg.ts:018.
    sql: `
      create table if not exists media_smart_folders (
        id text primary key,
        name text not null,
        query_json text not null,
        created_by_user_id text references users(id) on delete set null,
        created_at text not null default current_timestamp
      );
    `,
  },
  {
    id: '019_media_usage_refs',
    // See migrations-pg.ts:019.
    sql: `
      create table if not exists media_usage_refs (
        asset_id text not null references media_assets(id) on delete cascade,
        ref_kind text not null,
        ref_id text not null,
        ref_path text not null default '',
        computed_at text not null default current_timestamp,
        primary key (asset_id, ref_kind, ref_id, ref_path)
      );

      create index if not exists media_usage_refs_asset_idx
        on media_usage_refs (asset_id);
    `,
  },
]
