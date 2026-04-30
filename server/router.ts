import { handleAgentRequest } from './agentHandler'
import { handleCmsRequest } from './cms/handlers'
import type { DbClient } from './cms/db'
import { jsonResponse } from './http'
import { serveAdminApp, serveStaticFile } from './static'

export interface ServerRuntime {
  db: DbClient
  staticDir?: string
}

export async function handleServerRequest(
  req: Request,
  runtime: ServerRuntime,
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', ts: Date.now() })
  }

  if (url.pathname.startsWith('/api/cms/')) {
    return handleCmsRequest(req, runtime.db)
  }

  if (url.pathname === '/api/agent') {
    return handleAgentRequest(req)
  }

  if (runtime.staticDir && url.pathname.startsWith('/assets/')) {
    const asset = await serveStaticFile(runtime.staticDir, url.pathname)
    if (asset) return asset
  }

  if (
    runtime.staticDir &&
    (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
  ) {
    const adminApp = await serveAdminApp(runtime.staticDir)
    if (adminApp) return adminApp
  }

  return jsonResponse({ error: 'Not found' }, { status: 404 })
}
