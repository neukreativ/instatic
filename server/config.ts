export interface ServerConfig {
  port: number
  databaseUrl: string
  uploadsDir: string
  staticDir: string
}

export function readServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  return {
    port: Number(env.PORT ?? 3001),
    databaseUrl: env.DATABASE_URL ?? 'postgres://page_builder:page_builder@localhost:5432/page_builder',
    uploadsDir: env.UPLOADS_DIR ?? './uploads',
    staticDir: env.STATIC_DIR ?? './dist',
  }
}
