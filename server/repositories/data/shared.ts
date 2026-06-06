/**
 * Shared mapper helpers for the data-row repositories.
 *
 * `userRefAt` extracts a `DataUserReference` from a row for one of the four
 * user-ref joins (author / created_by / updated_by / published_by). Each prefix
 * has its own accessor reading the concrete named columns, so the column access
 * is type-checked and an unknown prefix is a compile error. `toIso` coerces DB
 * date columns to ISO strings regardless of whether the adapter returned a
 * `Date` (PG, test fakes) or a `string` (SQLite).
 */

import type { DataUserReference } from '@core/data/schemas'

export type UserJoinPrefix = 'author' | 'created_by' | 'updated_by' | 'published_by'

/**
 * Every column produced by a "<prefix>_*" user-ref join. The hydrated SELECT
 * (`mapper.ts`) emits all of these via LEFT JOINs, so each is always present —
 * `null` when the join found no user, never absent.
 */
export interface UserJoinColumns {
  author_user_id: string | null
  author_email: string | null
  author_display_name: string | null
  author_role_slug: string | null
  author_role_name: string | null
  created_by_user_id: string | null
  created_by_email: string | null
  created_by_display_name: string | null
  created_by_role_slug: string | null
  created_by_role_name: string | null
  updated_by_user_id: string | null
  updated_by_email: string | null
  updated_by_display_name: string | null
  updated_by_role_slug: string | null
  updated_by_role_name: string | null
  published_by_user_id: string | null
  published_by_email: string | null
  published_by_display_name: string | null
  published_by_role_slug: string | null
  published_by_role_name: string | null
}

export function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString()
}

export function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return toIso(value)
}

/** Build a `DataUserReference` from one join's already-resolved columns. */
function buildUserRef(
  userId: string | null,
  email: string | null,
  displayName: string | null,
  roleSlug: string | null,
  roleName: string | null,
): DataUserReference | null {
  if (!userId) return null
  const resolvedEmail = email ?? ''
  return {
    id: userId,
    email: resolvedEmail,
    displayName: displayName ?? resolvedEmail ?? userId,
    roleSlug: roleSlug ?? null,
    roleName: roleName ?? null,
  }
}

/**
 * One accessor per join prefix, each reading the concrete named columns. The
 * `Record<UserJoinPrefix, …>` key set makes an unknown prefix a compile error
 * and the explicit column reads are type-checked against `UserJoinColumns`.
 */
const userRefAccessors: Record<
  UserJoinPrefix,
  (row: UserJoinColumns) => DataUserReference | null
> = {
  author: (row) =>
    buildUserRef(
      row.author_user_id,
      row.author_email,
      row.author_display_name,
      row.author_role_slug,
      row.author_role_name,
    ),
  created_by: (row) =>
    buildUserRef(
      row.created_by_user_id,
      row.created_by_email,
      row.created_by_display_name,
      row.created_by_role_slug,
      row.created_by_role_name,
    ),
  updated_by: (row) =>
    buildUserRef(
      row.updated_by_user_id,
      row.updated_by_email,
      row.updated_by_display_name,
      row.updated_by_role_slug,
      row.updated_by_role_name,
    ),
  published_by: (row) =>
    buildUserRef(
      row.published_by_user_id,
      row.published_by_email,
      row.published_by_display_name,
      row.published_by_role_slug,
      row.published_by_role_name,
    ),
}

export function userRefAt(
  row: UserJoinColumns,
  prefix: UserJoinPrefix,
): DataUserReference | null {
  return userRefAccessors[prefix](row)
}
