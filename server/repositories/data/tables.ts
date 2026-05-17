/**
 * CRUD for data tables.
 *
 *   listDataTables       — read every non-deleted table
 *   getDataTable         — read a single table by id (or null)
 *   createDataTable      — insert a new table
 *   updateDataTable      — partial update (all fields optional)
 *   softDeleteDataTable  — set deleted_at; refuses if rows exist or if the
 *                          table is the seeded `posts` post-type
 */
import { nanoid } from 'nanoid'
import type { DbClient } from '../../db/client'
import { normalizeRouteBase } from '@core/templates/templateMatching'
import { normalizeDataTableFields } from '@core/data/fields'
import type {
  DataField,
  DataTable,
  DataTableKind,
} from '@core/data/schemas'

interface CreateDataTableInput {
  id?: string
  name: string
  slug: string
  kind?: DataTableKind
  routeBase?: string
  singularLabel: string
  pluralLabel: string
  primaryFieldId?: string
  fields?: DataField[]
  createdByUserId?: string | null
  updatedByUserId?: string | null
}

interface UpdateDataTableInput {
  name?: string
  slug?: string
  routeBase?: string
  singularLabel?: string
  pluralLabel?: string
  primaryFieldId?: string
  fields?: DataField[]
  updatedByUserId?: string | null
}

interface DataTableRow {
  id: string
  name: string
  slug: string
  kind: DataTableKind
  route_base: string
  singular_label: string
  plural_label: string
  primary_field_id: string
  fields_json?: unknown
  created_by_user_id: string | null
  updated_by_user_id: string | null
  /**
   * Adapters normalize: PG returns Date, SQLite returns ISO string, test fakes
   * may return either. The mapper coerces both via `toIso` below.
   */
  created_at: string | Date
  updated_at: string | Date
}

const toIso = (value: string | Date): string =>
  typeof value === 'string' ? value : value.toISOString()

function mapTable(row: DataTableRow): DataTable {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    kind: row.kind,
    routeBase: row.route_base ? normalizeRouteBase(row.route_base) : normalizeRouteBase(row.slug),
    singularLabel: row.singular_label,
    pluralLabel: row.plural_label,
    primaryFieldId: row.primary_field_id,
    fields: normalizeDataTableFields(row.fields_json),
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

export async function listDataTables(db: DbClient): Promise<DataTable[]> {
  const { rows } = await db<DataTableRow>`
    select id, name, slug, kind, route_base, singular_label, plural_label,
           primary_field_id, fields_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at
    from data_tables
    where deleted_at is null
    order by created_at asc
  `
  return rows.map(mapTable)
}

export async function getDataTable(db: DbClient, tableId: string): Promise<DataTable | null> {
  const { rows } = await db<DataTableRow>`
    select id, name, slug, kind, route_base, singular_label, plural_label,
           primary_field_id, fields_json,
           created_by_user_id, updated_by_user_id, created_at, updated_at
    from data_tables
    where id = ${tableId}
      and deleted_at is null
    limit 1
  `
  return rows[0] ? mapTable(rows[0]) : null
}

export async function createDataTable(
  db: DbClient,
  input: CreateDataTableInput,
): Promise<DataTable> {
  const fields = normalizeDataTableFields(input.fields ?? [])
  const { rows } = await db<DataTableRow>`
    insert into data_tables (
      id,
      name,
      slug,
      kind,
      route_base,
      singular_label,
      plural_label,
      primary_field_id,
      fields_json,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      ${input.id ?? nanoid()},
      ${input.name},
      ${input.slug},
      ${input.kind ?? 'data'},
      ${normalizeRouteBase(input.routeBase ?? input.slug)},
      ${input.singularLabel},
      ${input.pluralLabel},
      ${input.primaryFieldId ?? 'title'},
      ${fields},
      ${input.createdByUserId ?? null},
      ${input.updatedByUserId ?? input.createdByUserId ?? null}
    )
    returning id, name, slug, kind, route_base, singular_label, plural_label,
              primary_field_id, fields_json,
              created_by_user_id, updated_by_user_id, created_at, updated_at
  `
  return mapTable(rows[0])
}

export async function updateDataTable(
  db: DbClient,
  tableId: string,
  input: UpdateDataTableInput,
): Promise<DataTable | null> {
  const fields = input.fields === undefined ? null : normalizeDataTableFields(input.fields)
  const routeBase = input.routeBase === undefined ? null : normalizeRouteBase(input.routeBase)
  const { rows } = await db<DataTableRow>`
    update data_tables
    set name = coalesce(${input.name ?? null}, name),
        slug = coalesce(${input.slug ?? null}, slug),
        route_base = coalesce(${routeBase}, route_base),
        singular_label = coalesce(${input.singularLabel ?? null}, singular_label),
        plural_label = coalesce(${input.pluralLabel ?? null}, plural_label),
        primary_field_id = coalesce(${input.primaryFieldId ?? null}, primary_field_id),
        fields_json = coalesce(${fields}, fields_json),
        updated_by_user_id = coalesce(${input.updatedByUserId ?? null}, updated_by_user_id),
        updated_at = current_timestamp
    where id = ${tableId}
      and deleted_at is null
    returning id, name, slug, kind, route_base, singular_label, plural_label,
              primary_field_id, fields_json,
              created_by_user_id, updated_by_user_id, created_at, updated_at
  `
  return rows[0] ? mapTable(rows[0]) : null
}

/**
 * Refuses to delete the seeded `posts` table or any table that still has
 * non-deleted rows. Both guards live in the repository so other callers
 * (CLI tools, future migrations) inherit the safety check.
 */
export async function softDeleteDataTable(
  db: DbClient,
  tableId: string,
  actorUserId: string | null = null,
): Promise<DataTable | null> {
  if (tableId === 'posts') return null

  const { rows: countRows } = await db<{ count: number }>`
    select count(*) as count
    from data_rows
    where table_id = ${tableId}
      and deleted_at is null
  `
  if (Number(countRows[0]?.count ?? 0) > 0) return null

  const { rows } = await db<DataTableRow>`
    update data_tables
    set deleted_at = current_timestamp,
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${tableId}
      and deleted_at is null
    returning id, name, slug, kind, route_base, singular_label, plural_label,
              primary_field_id, fields_json,
              created_by_user_id, updated_by_user_id, created_at, updated_at
  `
  return rows[0] ? mapTable(rows[0]) : null
}
