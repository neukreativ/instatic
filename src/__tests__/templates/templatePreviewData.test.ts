import { describe, expect, it } from 'bun:test'
import type { ContentEntry } from '@core/content/schemas'
import type { CmsMediaAsset } from '@core/persistence/cmsMedia'
import {
  contentEntryToLoopItem,
  selectLatestTemplatePreviewEntry,
} from '@core/templates/templatePreviewData'

function entry(overrides: Partial<ContentEntry>): ContentEntry {
  return {
    id: overrides.id ?? 'entry_1',
    collectionId: overrides.collectionId ?? 'posts',
    title: overrides.title ?? 'Post',
    slug: overrides.slug ?? 'post',
    status: overrides.status ?? 'draft',
    bodyMarkdown: overrides.bodyMarkdown ?? '',
    featuredMediaId: overrides.featuredMediaId ?? null,
    seoTitle: overrides.seoTitle ?? '',
    seoDescription: overrides.seoDescription ?? '',
    authorUserId: overrides.authorUserId ?? null,
    createdByUserId: overrides.createdByUserId ?? null,
    updatedByUserId: overrides.updatedByUserId ?? null,
    publishedByUserId: overrides.publishedByUserId ?? null,
    author: overrides.author ?? null,
    createdBy: overrides.createdBy ?? null,
    updatedBy: overrides.updatedBy ?? null,
    publishedBy: overrides.publishedBy ?? null,
    createdAt: overrides.createdAt ?? '2026-05-01T10:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-05-01T10:00:00.000Z',
    publishedAt: overrides.publishedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
  }
}

function mediaAsset(overrides: Partial<CmsMediaAsset>): CmsMediaAsset {
  return {
    id: overrides.id ?? 'media_1',
    filename: overrides.filename ?? 'cover.png',
    mimeType: overrides.mimeType ?? 'image/png',
    sizeBytes: overrides.sizeBytes ?? 1024,
    publicPath: overrides.publicPath ?? '/uploads/cover.png',
    uploadedByUserId: overrides.uploadedByUserId ?? null,
    createdAt: overrides.createdAt ?? '2026-05-01T10:00:00.000Z',
  }
}

describe('template preview data', () => {
  it('uses the latest content entry as the template preview entry', () => {
    const older = entry({
      id: 'older',
      title: 'Older Post',
      updatedAt: '2026-05-01T09:00:00.000Z',
    })
    const latest = entry({
      id: 'latest',
      title: 'Latest Post',
      updatedAt: '2026-05-01T11:00:00.000Z',
    })

    expect(selectLatestTemplatePreviewEntry([older, latest])?.id).toBe('latest')
  })

  it('maps an editable content entry into a LoopItem', () => {
    const item = contentEntryToLoopItem(entry({
      id: 'entry_2',
      title: 'Mapped Post',
      bodyMarkdown: 'Body',
    }))

    expect(item.id).toBe('entry_2')
    expect(item.fields).toMatchObject({
      id: 'entry_2',
      entryId: 'entry_2',
      collectionId: 'posts',
      collectionSlug: 'posts',
      collectionRouteBase: '/posts',
      title: 'Mapped Post',
      bodyMarkdown: 'Body',
    })
  })

  it('maps editable entry authorship into public template fields', () => {
    const item = contentEntryToLoopItem(entry({
      authorUserId: 'user_author',
      updatedByUserId: 'user_editor',
      publishedByUserId: 'user_publisher',
      author: {
        id: 'user_author',
        email: 'author@example.com',
        displayName: 'Author Name',
        roleSlug: 'editor',
        roleName: 'Editor',
      },
      updatedBy: {
        id: 'user_editor',
        email: 'editor@example.com',
        displayName: 'Editor Name',
        roleSlug: 'admin',
        roleName: 'Admin',
      },
      publishedBy: {
        id: 'user_publisher',
        email: 'publisher@example.com',
        displayName: 'Publisher Name',
        roleSlug: 'admin',
        roleName: 'Admin',
      },
    }))

    expect(item.fields).toMatchObject({
      author: {
        displayName: 'Author Name',
        roleSlug: 'editor',
        roleName: 'Editor',
      },
      authorName: 'Author Name',
      authorRoleName: 'Editor',
      authorRoleSlug: 'editor',
      updatedBy: {
        displayName: 'Editor Name',
        roleSlug: 'admin',
        roleName: 'Admin',
      },
      updatedByName: 'Editor Name',
      updatedByRoleName: 'Admin',
      publishedBy: {
        displayName: 'Publisher Name',
        roleSlug: 'admin',
        roleName: 'Admin',
      },
      publishedByName: 'Publisher Name',
      publishedByRoleName: 'Admin',
    })
    expect('authorUserId' in item.fields).toBe(false)
    expect('authorId' in item.fields).toBe(false)
    expect('updatedByUserId' in item.fields).toBe(false)
    expect('publishedByUserId' in item.fields).toBe(false)
    expect(JSON.stringify(item.fields)).not.toContain('@example.com')
  })

  it('resolves an editable entry featured media id to a preview media path', () => {
    const item = contentEntryToLoopItem(
      entry({
        featuredMediaId: 'media_cover',
      }),
      [
        mediaAsset({
          id: 'media_cover',
          publicPath: '/uploads/post-cover.png',
        }),
      ],
    )

    expect(item.fields.featuredMediaPath).toBe('/uploads/post-cover.png')
    // Aliases all resolve to the same path
    expect(item.fields.featuredMedia).toBe('/uploads/post-cover.png')
    expect(item.fields.featuredMediaUrl).toBe('/uploads/post-cover.png')
  })

  it('extracts the first inline body image as a preview field', () => {
    const item = contentEntryToLoopItem(entry({
      bodyMarkdown: [
        'Intro paragraph',
        '',
        '![Inline hero](/uploads/body-hero.png)',
        '',
        '![Second image](/uploads/second.png)',
      ].join('\n'),
    }))

    expect(item.fields.firstImagePath).toBe('/uploads/body-hero.png')
    expect(item.fields.firstImage).toBe('/uploads/body-hero.png')
  })
})
