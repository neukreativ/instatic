/**
 * Cell-value helpers — typed accessors over a `DataRowCells` payload.
 *
 * `cells_json` is `Record<string, unknown>` at the persistence boundary. To
 * keep callers honest, every read goes through one of these helpers, which
 * narrow the unknown to the field's expected runtime type and fall back to
 * a sensible default when the cell is missing or malformed.
 */

import type { DataRowCells } from './schemas'

export function readStringCell(cells: DataRowCells, fieldId: string, fallback = ''): string {
  const value = cells[fieldId]
  return typeof value === 'string' ? value : fallback
}

export function readNullableStringCell(cells: DataRowCells, fieldId: string): string | null {
  const value = cells[fieldId]
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function readNumberCell(cells: DataRowCells, fieldId: string): number | null {
  const value = cells[fieldId]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function readBooleanCell(cells: DataRowCells, fieldId: string): boolean {
  const value = cells[fieldId]
  return typeof value === 'boolean' ? value : false
}

export function readStringArrayCell(cells: DataRowCells, fieldId: string): string[] {
  const value = cells[fieldId]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * Convenience for the post-type built-in field ids. These are read often
 * enough that giving them a named accessor avoids string-literal sprawl.
 */
export function readTitleCell(cells: DataRowCells): string {
  return readStringCell(cells, 'title')
}

export function readSlugCell(cells: DataRowCells): string {
  return readStringCell(cells, 'slug')
}

export function readBodyCell(cells: DataRowCells): string {
  return readStringCell(cells, 'body')
}

export function readFeaturedMediaCell(cells: DataRowCells): string | null {
  return readNullableStringCell(cells, 'featuredMedia')
}

export function readSeoTitleCell(cells: DataRowCells): string {
  return readStringCell(cells, 'seoTitle')
}

export function readSeoDescriptionCell(cells: DataRowCells): string {
  return readStringCell(cells, 'seoDescription')
}
