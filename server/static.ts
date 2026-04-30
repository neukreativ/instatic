import { extname, resolve, sep } from 'node:path'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

function contentType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function resolveStaticPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const rootPath = resolve(root)
  const filePath = resolve(rootPath, `.${decoded}`)
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) return null
  return filePath
}

export async function serveStaticFile(
  staticDir: string,
  pathname: string,
): Promise<Response | null> {
  const filePath = resolveStaticPath(staticDir, pathname)
  if (!filePath) return null

  const file = Bun.file(filePath)
  if (!(await file.exists())) return null

  return new Response(await file.arrayBuffer(), {
    headers: {
      'content-type': contentType(filePath),
      'cache-control': pathname.startsWith('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
    },
  })
}

export function serveAdminApp(staticDir: string): Promise<Response | null> {
  return serveStaticFile(staticDir, '/index.html')
}
