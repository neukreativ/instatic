import type { Migration } from './runMigrations'

export const pgMigrations: Migration[] = [
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
        updated_at timestamptz not null default now()
      );

      create table if not exists roles (
        id text primary key,
        slug text not null unique,
        name text not null,
        description text not null default '',
        is_system boolean not null default false,
        capabilities_json jsonb not null default '[]'::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      insert into roles (id, slug, name, description, is_system, capabilities_json)
      values
        ('owner', 'owner', 'Owner', 'Permanent installation owner with full system access.', true, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","roles.manage","audit.read"]'::jsonb),
        ('admin', 'admin', 'Admin', 'Full admin access.', true, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.edit.any","content.publish.own","content.publish.any","content.manage","media.manage","runtime.manage","plugins.manage","users.manage","roles.manage","audit.read"]'::jsonb),
        ('editor', 'editor', 'Editor', 'Can edit and publish assigned site content.', true, '["site.read","site.edit","pages.edit","pages.publish","content.create","content.edit.own","content.publish.own","media.manage"]'::jsonb),
        ('content-manager', 'content-manager', 'Content Manager', 'Can manage all content entries and collections.', true, '["site.read","content.create","content.edit.any","content.publish.any","content.manage","media.manage"]'::jsonb),
        ('viewer', 'viewer', 'Viewer', 'Read-only admin access.', true, '["site.read"]'::jsonb),
        ('subscriber', 'subscriber', 'Subscriber', 'Reserved for future public member accounts.', true, '[]'::jsonb)
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
        last_login_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
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
        created_at timestamptz not null default now(),
        last_seen_at timestamptz not null default now(),
        expires_at timestamptz not null,
        revoked_at timestamptz,
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
        metadata_json jsonb not null default '{}'::jsonb,
        ip_address text,
        user_agent text,
        created_at timestamptz not null default now()
      );

      create index if not exists audit_events_created_idx
        on audit_events (created_at desc);

      create table if not exists pages (
        id text primary key,
        title text not null,
        slug text not null unique,
        status text not null default 'draft',
        draft_document_json jsonb not null,
        active_version_id text,
        sort_order integer not null default 0,
        owner_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists page_versions (
        id text primary key,
        page_id text not null references pages(id) on delete cascade,
        version integer not null,
        snapshot_json jsonb not null,
        published_at timestamptz not null default now(),
        published_by_user_id text references users(id) on delete set null,
        unique (page_id, version)
      );

      create table if not exists media_assets (
        id text primary key,
        filename text not null,
        mime_type text not null,
        size_bytes bigint not null,
        storage_path text not null,
        public_path text not null unique,
        uploaded_by_user_id text references users(id) on delete set null,
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
  {
    id: '003_content_documents',
    // Originally named after the legacy `content_*` shape; the migration now
    // creates the unified `data_*` schema that replaced it. All cells live in
    // `cells_json` keyed by field id; post-type built-ins (title, slug, body,
    // featuredMedia, seoTitle, seoDescription) are seeded into the 'posts'
    // table's `fields_json` rather than hardcoded as columns.
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
        fields_json jsonb not null default '[]'::jsonb,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        deleted_at timestamptz,
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
        '[
          {"type":"text","id":"title","label":"Title","required":true,"builtIn":true},
          {"type":"text","id":"slug","label":"Slug","required":true,"builtIn":true},
          {"type":"richText","id":"body","label":"Body","format":"markdown","builtIn":true},
          {"type":"media","id":"featuredMedia","label":"Featured media","mediaKind":"image","builtIn":true},
          {"type":"text","id":"seoTitle","label":"SEO title","builtIn":true},
          {"type":"longText","id":"seoDescription","label":"SEO description","builtIn":true}
        ]'::jsonb
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

      -- Created before data_row_versions so versions.row_id can reference it.
      -- active_version_id FK to data_row_versions is added as a constraint
      -- after data_row_versions exists below.
      create table if not exists data_rows (
        id text primary key,
        table_id text not null references data_tables(id) on delete restrict,
        cells_json jsonb not null default '{}'::jsonb,
        slug text not null default '',
        status text not null default 'draft',
        active_version_id text,
        author_user_id text references users(id) on delete set null,
        created_by_user_id text references users(id) on delete set null,
        updated_by_user_id text references users(id) on delete set null,
        published_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        published_at timestamptz,
        deleted_at timestamptz,
        constraint data_rows_status_check check (status in ('draft', 'published', 'unpublished'))
      );

      -- The slug uniqueness predicate excludes empty strings so non-routable
      -- tables (data-kind, no slug field) can have many rows without slug
      -- collisions. Routable tables always populate slug from cells.slug.
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
        cells_json jsonb not null default '{}'::jsonb,
        slug text not null default '',
        published_by_user_id text references users(id) on delete set null,
        published_at timestamptz not null default now(),
        created_at timestamptz not null default now(),
        unique (row_id, version_number)
      );

      create index if not exists data_row_versions_row_latest_idx
        on data_row_versions (row_id, version_number desc);

      -- Add the active-version FK now that both tables exist. Wrapped in a
      -- DO block so re-applying the migration does not fail with
      -- "constraint already exists" on idempotent re-runs.
      do $$ begin
        if not exists (
          select 1 from pg_constraint where conname = 'data_rows_active_version_fk'
        ) then
          alter table data_rows
            add constraint data_rows_active_version_fk
            foreign key (active_version_id) references data_row_versions(id) on delete set null;
        end if;
      end $$;

      create table if not exists data_row_redirects (
        id text primary key,
        table_id text not null references data_tables(id) on delete cascade,
        from_route_base text not null,
        from_slug text not null,
        target_row_id text not null references data_rows(id) on delete cascade,
        created_at timestamptz not null default now()
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
        enabled boolean not null default true,
        granted_permissions_json jsonb not null default '[]'::jsonb,
        manifest_json jsonb not null,
        installed_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
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
        data_json jsonb not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create index if not exists plugin_records_resource_idx
        on plugin_records (plugin_id, resource_id, created_at desc);
    `,
  },
  {
    id: '006_plugin_permission_grants',
    // `granted_permissions_json` is already present in the `installed_plugins`
    // CREATE TABLE in migration 004. Tracked no-op that records the schema
    // version step without touching DDL (the column was added retrospectively to
    // 004 during schema consolidation).
    sql: `SELECT 1`,
  },
  {
    id: '007_plugin_lifecycle_status',
    sql: `
      alter table installed_plugins
        add column if not exists lifecycle_status text not null default 'installed',
        add column if not exists last_error text;
    `,
  },
  {
    id: '008_content_collection_route_base',
    // `route_base` is now created as part of the unified `data_tables`
    // table in migration 003. Tracked no-op that records the schema version
    // step without touching DDL.
    sql: `SELECT 1`,
  },
  {
    id: '009_content_entry_active_version_and_redirects',
    // `active_version_id` on `data_rows` and the `data_row_redirects` table
    // are now created as part of the unified migration 003. Tracked no-op.
    sql: `SELECT 1`,
  },
  {
    id: '010_content_collection_fields',
    // `fields_json` is now created as part of the unified `data_tables` in
    // migration 003. Tracked no-op — see note on 006 above.
    sql: `SELECT 1`,
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
        content_bytes bytea not null,
        created_at timestamptz not null default now()
      );

      create index if not exists published_runtime_assets_page_version_idx
        on published_runtime_assets (page_version_id);
    `,
  },
  {
    id: '012_plugin_settings',
    sql: `
      alter table installed_plugins
        add column if not exists settings_json jsonb not null default '{}'::jsonb;
    `,
  },
  {
    id: '013_auth_lockout',
    sql: `
      alter table users
        add column if not exists failed_login_count integer not null default 0;

      alter table users
        add column if not exists locked_until timestamptz;

      create table if not exists login_attempts (
        id text primary key,
        attempted_at timestamptz not null default now(),
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
        add column if not exists device_label text not null default '';

      alter table sessions
        add column if not exists mfa_passed_at timestamptz;

      alter table sessions
        add column if not exists step_up_expires_at timestamptz;

      create index if not exists sessions_user_active_idx
        on sessions (user_id, expires_at)
        where revoked_at is null;

      alter table users
        add column if not exists avatar_media_id text references media_assets(id) on delete set null;

      alter table users
        add column if not exists password_updated_at timestamptz;

      alter table users
        add column if not exists mfa_enabled boolean not null default false;

      alter table users
        add column if not exists mfa_enabled_at timestamptz;

      alter table users
        add column if not exists mfa_totp_secret text;

      alter table users
        add column if not exists mfa_recovery_code_hashes_json jsonb not null default '[]'::jsonb;
    `,
  },
  {
    id: '015_plugin_crash_events',
    sql: `
      create table if not exists plugin_crash_events (
        id text primary key,
        plugin_id text not null,
        occurred_at timestamptz not null default now(),
        reason text not null,
        stack text
      );

      create index if not exists plugin_crash_events_plugin_idx
        on plugin_crash_events (plugin_id, occurred_at desc);
    `,
  },
  {
    id: '016_media_assets_metadata',
    // Media page (docs/media-page.md) — extends media_assets with the metadata
    // fields the inspector edits (alt text, caption, title, tags, focal point),
    // image / video intrinsic dimensions populated on upload, a dominant_color
    // swatch, and the soft-delete + replace-file timestamps.
    sql: `
      alter table media_assets
        add column if not exists alt_text text not null default '';

      alter table media_assets
        add column if not exists caption text not null default '';

      alter table media_assets
        add column if not exists title text not null default '';

      alter table media_assets
        add column if not exists tags_json jsonb not null default '[]'::jsonb;

      alter table media_assets
        add column if not exists width integer;

      alter table media_assets
        add column if not exists height integer;

      alter table media_assets
        add column if not exists duration_ms integer;

      alter table media_assets
        add column if not exists focal_x real not null default 0.5;

      alter table media_assets
        add column if not exists focal_y real not null default 0.5;

      alter table media_assets
        add column if not exists dominant_color text;

      alter table media_assets
        add column if not exists deleted_at timestamptz;

      alter table media_assets
        add column if not exists replaced_at timestamptz;

      -- Responsive pipeline (docs/responsive-media.md) — BlurHash placeholder
      -- and the per-width WebP variant index produced at upload time. Variants
      -- are an array of {width, height, format, path, sizeBytes}; consumers
      -- pick the smallest variant ≥ their display width.
      alter table media_assets
        add column if not exists blur_hash text;

      alter table media_assets
        add column if not exists variants_json jsonb not null default '[]'::jsonb;

      -- Optional poster image generated from the first frame of an uploaded
      -- video. Reused as the <video poster> attribute on render and as the
      -- async-loading placeholder in admin previews.
      alter table media_assets
        add column if not exists poster_path text;

      create index if not exists media_assets_deleted_idx
        on media_assets (deleted_at);
    `,
  },
  {
    id: '017_media_folders',
    // Many-to-many folder model (HappyFiles-style) — an asset can live in
    // multiple folders. Slug is unique within its parent so users can have
    // two "Logos" folders under different roots.
    sql: `
      create table if not exists media_folders (
        id text primary key,
        parent_id text references media_folders(id) on delete cascade,
        name text not null,
        slug text not null,
        sort_order integer not null default 0,
        created_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now()
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
    // User-defined saved searches (recent, unused, missing alt text, …).
    // query_json is a TypeBox-validated filter; the server runs it as a
    // query at list time rather than materializing a stored list.
    sql: `
      create table if not exists media_smart_folders (
        id text primary key,
        name text not null,
        query_json jsonb not null,
        created_by_user_id text references users(id) on delete set null,
        created_at timestamptz not null default now()
      );
    `,
  },
  {
    id: '019_media_usage_refs',
    // Per-asset reverse index of where an asset is referenced (page, content
    // entry, user avatar, plugin). Populated by the publish pipeline so the
    // inspector can show "Used on N pages" without scanning every tree on
    // every load.
    sql: `
      create table if not exists media_usage_refs (
        asset_id text not null references media_assets(id) on delete cascade,
        ref_kind text not null,
        ref_id text not null,
        ref_path text not null default '',
        computed_at timestamptz not null default now(),
        primary key (asset_id, ref_kind, ref_id, ref_path)
      );

      create index if not exists media_usage_refs_asset_idx
        on media_usage_refs (asset_id);
    `,
  },
]
