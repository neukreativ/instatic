/**
 * mimeTypes — lightweight extension-to-MIME mapping for the asset pipeline.
 *
 * Used when a FileMap entry has no MIME type (e.g. from a zip with no
 * metadata). Returns `'application/octet-stream'` as a safe fallback.
 */

const EXT_TO_MIME: Record<string, string> = {
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  ico: 'image/x-icon',
  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  // Documents / data
  pdf: 'application/pdf',
  zip: 'application/zip',
  csv: 'text/csv',
  txt: 'text/plain',
  json: 'application/json',
  // Web
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
}

/** Return a MIME type for the given file path based on its extension. */
export function guessMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  return (ext && EXT_TO_MIME[ext]) ?? 'application/octet-stream'
}
