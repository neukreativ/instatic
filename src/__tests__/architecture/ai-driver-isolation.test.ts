/**
 * Architecture gate — AI driver SDK isolation.
 *
 * Drivers are the ONLY place provider SDKs (and Zod) may be imported.
 * Every other file in the repo — runtime, handlers, tools, repositories,
 * UI — talks to the `AiProvider` interface and never reaches into an
 * SDK directly.
 *
 * This replaces the legacy `no-anthropic-sdk.test.ts` gate, which only
 * scanned `src/` and predates the `server/ai/` module. The legacy gate
 * remains in place for the editor (the browser must never import any AI
 * SDK); this gate covers the server side.
 *
 * Permitted exceptions (case-by-case in the ALLOW_BY_PACKAGE map):
 *   - `@anthropic-ai/claude-agent-sdk` → driver + stream adapter
 *   - `@openai/agents`                  → openai driver
 *   - `zod`                              → driver + typebox→zod helper
 *
 * The PLAIN `@anthropic-ai/sdk` stays banned EVERYWHERE — the Agent SDK
 * covers all our needs, and the plain SDK has been documented as
 * dangerous in the legacy gate.
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { join, extname, relative } from 'path'

const REPO_ROOT = join(import.meta.dir, '../../../')
const SCAN_DIRS = ['src', 'server']

interface PackageRule {
  /** Display name in error messages. */
  label: string
  /** Regex matched against the file's content. */
  importRe: RegExp
  /**
   * Repo-relative file paths (forward slashes) that may import this
   * package. Anything outside this list violates the gate.
   */
  allowed: string[]
}

const RULES: PackageRule[] = [
  {
    label: '@anthropic-ai/claude-agent-sdk',
    importRe: /from\s+['"]@anthropic-ai\/claude-agent-sdk['"]|require\s*\(\s*['"]@anthropic-ai\/claude-agent-sdk['"]\s*\)/,
    allowed: [
      'server/ai/drivers/anthropic.ts',
    ],
  },
  {
    label: '@openai/agents',
    importRe: /from\s+['"]@openai\/agents['"]|require\s*\(\s*['"]@openai\/agents['"]\s*\)/,
    allowed: [
      'server/ai/drivers/openai.ts',
    ],
  },
  {
    label: 'zod',
    importRe: /from\s+['"]zod['"]|require\s*\(\s*['"]zod['"]\s*\)/,
    allowed: [
      'server/ai/drivers/anthropic.ts',
      'server/ai/drivers/typeboxToZod.ts',
    ],
  },
  {
    label: '@anthropic-ai/sdk',
    importRe: /from\s+['"]@anthropic-ai\/sdk['"]|require\s*\(\s*['"]@anthropic-ai\/sdk['"]\s*\)/,
    allowed: [
      // No allowed callers — the plain Anthropic SDK is banned repo-wide.
      // The Agent SDK covers ambient + apiKey paths via Options.env.
    ],
  },
]

function collectFiles(dir: string): string[] {
  const out: string[] = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    // Don't scan node_modules or build output.
    if (entry === 'node_modules' || entry === '.tmp' || entry === 'dist') continue
    const stat = statSync(full)
    if (stat.isDirectory()) {
      out.push(...collectFiles(full))
    } else if (['.ts', '.tsx', '.js', '.mts', '.mjs'].includes(extname(entry))) {
      // Skip every architecture-gate test file — gates routinely embed the
      // forbidden literals in their own scan regex.
      if (full.includes('/__tests__/architecture/')) continue
      out.push(full)
    }
  }
  return out
}

function repoRelative(absPath: string): string {
  return relative(REPO_ROOT, absPath).replaceAll('\\', '/')
}

describe('ai-driver-isolation gate', () => {
  const allFiles = SCAN_DIRS.flatMap((d) => collectFiles(join(REPO_ROOT, d)))

  for (const rule of RULES) {
    it(`${rule.label}: only allowed files import it`, () => {
      const violations: string[] = []
      for (const file of allFiles) {
        const rel = repoRelative(file)
        if (rule.allowed.includes(rel)) continue
        let content: string
        try { content = readFileSync(file, 'utf8') } catch { continue }
        if (rule.importRe.test(content)) {
          violations.push(rel)
        }
      }
      if (violations.length > 0) {
        throw new Error(
          `[ai-driver-isolation] ${rule.label} imported from disallowed locations:\n` +
          violations.map((v) => `  ${v}`).join('\n') +
          `\n\nAllowed: ${rule.allowed.length === 0 ? '<none — package is banned repo-wide>' : rule.allowed.join(', ')}`,
        )
      }
      expect(violations).toHaveLength(0)
    })
  }
})
