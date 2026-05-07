export interface PublicContentUserReference {
  displayName: string
  roleSlug: string | null
  roleName: string | null
}

interface ContentUserLike {
  displayName: string | null
  roleSlug?: string | null
  roleName?: string | null
}

export function publicContentUserReference(
  user: ContentUserLike | null | undefined,
): PublicContentUserReference | null {
  if (!user) return null
  const displayName = user.displayName?.trim()
  if (!displayName) return null
  return {
    displayName,
    roleSlug: user.roleSlug ?? null,
    roleName: user.roleName ?? null,
  }
}

export function publicContentUserFromParts(
  displayName: string | null | undefined,
  roleSlug: string | null | undefined,
  roleName: string | null | undefined,
): PublicContentUserReference | null {
  return publicContentUserReference({
    displayName: displayName ?? null,
    roleSlug: roleSlug ?? null,
    roleName: roleName ?? null,
  })
}
