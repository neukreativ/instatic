/**
 * Shared mapper helpers for the data-row repositories.
 *
 * `userRefAt` extracts a `DataUserReference` from a row using the column-prefix
 * convention shared by all four user-ref joins (author / created_by /
 * updated_by / published_by). `toIso` coerces DB date columns to ISO strings
 * regardless of whether the adapter returned a `Date` (PG, test fakes) or a
 * `string` (SQLite).
 */

import type { DataUserReference } from '@core/data/schemas'

export type UserJoinPrefix = 'author' | 'created_by' | 'updated_by' | 'published_by'

/** Every column produced by a "<prefix>_*" user-ref join. */
export interface UserJoinColumns {
  author_user_id?: string | null
  author_email?: string | null
  author_display_name?: string | null
  author_role_slug?: string | null
  author_role_name?: string | null
  created_by_user_id?: string | null
  created_by_email?: string | null
  created_by_display_name?: string | null
  created_by_role_slug?: string | null
  created_by_role_name?: string | null
  updated_by_user_id?: string | null
  updated_by_email?: string | null
  updated_by_display_name?: string | null
  updated_by_role_slug?: string | null
  updated_by_role_name?: string | null
  published_by_user_id?: string | null
  published_by_email?: string | null
  published_by_display_name?: string | null
  published_by_role_slug?: string | null
  published_by_role_name?: string | null
}

export function toIso(value: string | Date): string {
  return typeof value === 'string' ? value : value.toISOString()
}

export function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null
  return toIso(value)
}

export function userRefAt(
  row: UserJoinColumns,
  prefix: UserJoinPrefix,
): DataUserReference | null {
  const userId = row[`${prefix}_user_id`]
  if (!userId) return null
  const email = row[`${prefix}_email`] ?? ''
  return {
    id: userId,
    email,
    displayName: row[`${prefix}_display_name`] ?? email ?? userId,
    roleSlug: row[`${prefix}_role_slug`] ?? null,
    roleName: row[`${prefix}_role_name`] ?? null,
  }
}
