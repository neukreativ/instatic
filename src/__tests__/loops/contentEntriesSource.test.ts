import { describe, expect, it } from 'bun:test'
import { ContentEntriesSource } from '@core/loops/sources/contentEntries'

describe('content.entries loop source', () => {
  it('offers author display fields without exposing user ids as binding fields', () => {
    expect(ContentEntriesSource.fields).toContainEqual({
      id: 'authorName',
      label: 'Author name',
    })
    expect(ContentEntriesSource.fields).toContainEqual({
      id: 'authorRoleName',
      label: 'Author role',
    })
    expect(ContentEntriesSource.fields.map((field) => field.id)).not.toContain('authorUserId')
    expect(ContentEntriesSource.fields.map((field) => field.id)).not.toContain('publishedByUserId')
  })
})
