/**
 * Server-side render of the agent's posted tree into the HTML read surface.
 *
 * `renderAgentPage` produces exactly the artifacts the token benchmark proved
 * cheaper than the JSON snapshot: the annotated `<body>` (each element tagged
 * `uid="<nodeId>"`) plus the page's `<style>` bundle (framework tokens +
 * utilities + module CSS, class rules with `@media` breakpoint blocks, and
 * page-scoped user stylesheets). Reset CSS is omitted — it is page-independent
 * browser-normalisation boilerplate the agent never reasons about.
 *
 * Same `publishPage` + `buildSiteCssBundle` path that
 * `server/publish/publicRenderer.ts` runs in-process; here we ask for
 * `annotateNodeIds` and slice the body out of the full document.
 */

import { registry } from '@core/module-engine'
import type {
  AnyModuleDefinition,
  PropertyControl,
  PropertySchema,
} from '@core/module-engine'
import { publishPage } from '@core/publisher'
import { describeFrameworkTokens } from '@core/framework'
import { describeFontTokens } from '@core/fonts'
import type { SiteDocument } from '@core/page-tree'
import type { SiteAgentSnapshot } from '@site/agent/siteAgentSnapshot'
import { buildSiteCssBundle } from '../../../publish/siteCssBundle'
import type { ModuleInfo, ModulePropInfo, ModuleStyleInfo, SnapshotTokens } from './snapshot'
import type { TokenFamily } from './snapshotHelpers'

export interface AgentPageRender {
  /** Annotated inner <body> HTML (uid="<nodeId>" on each element). */
  html: string
  /** The page's CSS wrapped in a <style> block; '' when the page has no CSS. */
  css: string
}

/** Extract the inner `<body>` HTML from a full published document. */
function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/)
  return m ? m[1] : html
}

export function renderAgentPage(snap: SiteAgentSnapshot): AgentPageRender {
  const { page, site } = snap
  const { html: fullDocument } = publishPage(page, site, registry, {
    annotateNodeIds: true,
  })
  const html = extractBody(fullDocument)

  const bundle = buildSiteCssBundle(site, registry, page)
  const cssBody = [bundle.framework.content, bundle.style.content, bundle.userStyles.content]
    .filter(Boolean)
    .join('\n\n')
  const css = cssBody ? `<style>\n${cssBody}\n</style>` : ''

  return { html, css }
}

// ---------------------------------------------------------------------------
// Catalog derivations — the module/token surface the agent's catalog tools
// (`list_modules`, `list_tokens`) return. Sourced from the server registry +
// the posted site, replacing the old browser-flattened snapshot fields.
// ---------------------------------------------------------------------------

/** Describe every insertable module from the registry (excludes `base.body`). */
export function describeAgentModules(): ModuleInfo[] {
  return registry
    .list()
    .filter((mod) => mod.id !== 'base.body')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(moduleDefinitionToModuleInfo)
}

/** Describe the site's design tokens (framework colors/typography/spacing + fonts). */
export function describeAgentTokens(site: SiteDocument): SnapshotTokens {
  return {
    ...describeFrameworkTokens(site.settings.framework),
    fonts: describeFontTokens(site.settings.fonts),
  }
}

/**
 * Narrow a token digest to one family, leaving the others empty so the shape
 * stays stable. Returns the full digest when no family is given.
 */
export function filterTokenFamily(tokens: SnapshotTokens, family?: TokenFamily): SnapshotTokens {
  if (!family) return tokens
  return {
    colors: family === 'colors' ? tokens.colors : [],
    typography: family === 'typography' ? tokens.typography : [],
    spacing: family === 'spacing' ? tokens.spacing : [],
    fonts: family === 'fonts' ? tokens.fonts : [],
  }
}

function moduleDefinitionToModuleInfo(mod: AnyModuleDefinition): ModuleInfo {
  return {
    id: mod.id,
    name: mod.name,
    description: mod.description,
    category: mod.category,
    canHaveChildren: mod.canHaveChildren,
    defaults: toSerializableRecord(mod.defaults ?? {}),
    props: schemaToModuleProps(mod.schema, mod.defaults ?? {}),
    styles: genericStyleHintsForModule(mod),
  }
}

function genericStyleHintsForModule(mod: AnyModuleDefinition): ModuleStyleInfo[] {
  if (mod.id === 'base.text' || mod.category.toLowerCase() === 'typography') {
    return [
      { key: 'fontFamily', type: 'text', label: 'Font family', defaultValue: 'inherit', cssProperties: ['fontFamily'] },
      { key: 'fontSize', type: 'text', label: 'Font size', defaultValue: '16px', cssProperties: ['fontSize'] },
      { key: 'fontWeight', type: 'select', label: 'Font weight', defaultValue: '400', cssProperties: ['fontWeight'], options: [
        { label: 'Regular', value: '400' },
        { label: 'Medium', value: '500' },
        { label: 'Semi bold', value: '600' },
        { label: 'Bold', value: '700' },
        { label: 'Black', value: '900' },
      ] },
      { key: 'lineHeight', type: 'text', label: 'Line height', defaultValue: '1.4', cssProperties: ['lineHeight'] },
      { key: 'letterSpacing', type: 'text', label: 'Letter spacing', defaultValue: '0px', cssProperties: ['letterSpacing'] },
      { key: 'color', type: 'color', label: 'Text color', defaultValue: 'inherit', cssProperties: ['color'] },
      { key: 'textAlign', type: 'select', label: 'Text align', defaultValue: 'left', cssProperties: ['textAlign'], options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
        { label: 'Justify', value: 'justify' },
      ] },
      { key: 'marginBottom', type: 'text', label: 'Bottom margin', defaultValue: '0px', cssProperties: ['marginBottom'] },
    ]
  }

  return []
}

function schemaToModuleProps(
  schema: PropertySchema,
  defaults: Record<string, unknown>,
): ModulePropInfo[] {
  const props: ModulePropInfo[] = []

  for (const [key, control] of Object.entries(schema)) {
    if (control.type === 'group') {
      props.push(...schemaToModuleProps(control.children, defaults))
      continue
    }
    props.push(controlToModuleProp(key, control, defaults[key]))
  }

  return props
}

function controlToModuleProp(
  key: string,
  control: Exclude<PropertyControl, { type: 'group' }>,
  defaultValue: unknown,
): ModulePropInfo {
  const prop: ModulePropInfo = {
    key,
    type: control.type,
    label: control.label,
    description: control.description,
    defaultValue: toSerializableValue(defaultValue),
  }

  if (control.breakpointOverridable === true) {
    prop.breakpointOverridable = true
  }

  if (control.type === 'select') {
    prop.options = control.options.map((option) => ({
      label: option.label,
      value: toSerializableValue(option.value),
    }))
  }

  return prop
}

function toSerializableRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = toSerializableValue(value)
  }
  return result
}

function toSerializableValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) return value.map(toSerializableValue)

  if (typeof value === 'object' && value) {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toSerializableValue(nestedValue)
    }
    return result
  }

  return String(value)
}
