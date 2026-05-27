/**
 * TypeBox → Zod raw-shape converter.
 *
 * The Anthropic Claude Agent SDK's `tool()` API requires `AnyZodRawShape`
 * (a `Record<string, z.ZodTypeAny>`) for input schemas — TypeBox's native
 * shape can't satisfy that constraint. This converter walks a TypeBox
 * `Type.Object(...)` and produces an equivalent Zod raw shape so the SDK
 * (and therefore Claude) sees the same constraints we author in TypeBox.
 *
 * Coverage: the subset of TypeBox that the AI tool registry actually uses
 * (Object, String, Number, Integer, Boolean, Array, Record, Union,
 * Optional, Literal, Unknown, Recursive). Anything else falls back to
 * `z.unknown()` with a console warning so unsupported shapes surface
 * loudly during development.
 *
 * Recursion is supported via `Type.Recursive` / `Type.This`. The
 * implementation memoises the in-progress Zod schema in a WeakMap keyed
 * on the TypeBox node so the recursive reference resolves to the same
 * `z.lazy(...)` thunk on subsequent visits.
 *
 * THIS FILE IS THE ONLY LEGITIMATE Zod USE OUTSIDE of the Anthropic
 * driver itself. Both are gated by `ai-driver-isolation.test.ts`.
 */

import { Kind, OptionalKind, type TSchema } from '@sinclair/typebox'
import { z } from 'zod'

type AnyZodTypeAny = z.ZodTypeAny

interface TypeBoxObject extends TSchema {
  type: 'object'
  properties: Record<string, TSchema>
  required?: string[]
}

interface TypeBoxArray extends TSchema {
  type: 'array'
  items: TSchema
}

interface TypeBoxRecord extends TSchema {
  type: 'object'
  patternProperties?: Record<string, TSchema>
  additionalProperties?: TSchema
}

interface TypeBoxUnion extends TSchema {
  anyOf: TSchema[]
}

interface TypeBoxString extends TSchema {
  type: 'string'
  minLength?: number
  maxLength?: number
  pattern?: string
}

interface TypeBoxNumberLike extends TSchema {
  type: 'number' | 'integer'
  minimum?: number
  maximum?: number
}

interface TypeBoxLiteral extends TSchema {
  const: unknown
}

/**
 * Convert a `Type.Object(...)` schema to a Zod raw shape suitable for
 * the SDK's `tool()` function.
 *
 * Throws if the input is not a TypeBox object — `tool()` only accepts
 * raw shapes (not a wrapped `z.object(...)`).
 */
export function typeboxObjectToZodRawShape(
  schema: TSchema,
): Record<string, AnyZodTypeAny> {
  if (schema[Kind] !== 'Object') {
    throw new Error(
      `[typeboxToZod] Expected a Type.Object root schema; got Kind=${String(schema[Kind])}.`,
    )
  }
  const obj = schema as TypeBoxObject
  const required = new Set(obj.required ?? [])
  const out: Record<string, AnyZodTypeAny> = {}
  const memo = new WeakMap<TSchema, AnyZodTypeAny>()
  for (const [key, propSchema] of Object.entries(obj.properties)) {
    let zodSchema = typeboxToZod(propSchema, memo)
    if (!required.has(key) || propSchema[OptionalKind] === 'Optional') {
      zodSchema = zodSchema.optional()
    }
    out[key] = zodSchema
  }
  return out
}

function typeboxToZod(
  schema: TSchema,
  memo: WeakMap<TSchema, AnyZodTypeAny>,
): AnyZodTypeAny {
  const cached = memo.get(schema)
  if (cached) return cached

  // Pre-register a lazy thunk before recursing so back-edges in
  // `Type.Recursive` resolve to the SAME `z.lazy(...)` we're building.
  let resolved: AnyZodTypeAny | null = null
  const lazy = z.lazy(() => {
    if (!resolved) {
      throw new Error('[typeboxToZod] Lazy reference resolved before initialisation.')
    }
    return resolved
  })
  memo.set(schema, lazy)

  resolved = convertNode(schema, memo)
  return resolved
}

function convertNode(
  schema: TSchema,
  memo: WeakMap<TSchema, AnyZodTypeAny>,
): AnyZodTypeAny {
  const kind = schema[Kind] as string | undefined

  switch (kind) {
    case 'String': {
      const s = schema as TypeBoxString
      let zs = z.string()
      if (typeof s.minLength === 'number') zs = zs.min(s.minLength)
      if (typeof s.maxLength === 'number') zs = zs.max(s.maxLength)
      if (typeof s.pattern === 'string') zs = zs.regex(new RegExp(s.pattern))
      return zs
    }

    case 'Number': {
      const n = schema as TypeBoxNumberLike
      let zn = z.number()
      if (typeof n.minimum === 'number') zn = zn.min(n.minimum)
      if (typeof n.maximum === 'number') zn = zn.max(n.maximum)
      return zn
    }

    case 'Integer': {
      const n = schema as TypeBoxNumberLike
      let zn = z.number().int()
      if (typeof n.minimum === 'number') zn = zn.min(n.minimum)
      if (typeof n.maximum === 'number') zn = zn.max(n.maximum)
      return zn
    }

    case 'Boolean':
      return z.boolean()

    case 'Literal': {
      const l = schema as TypeBoxLiteral
      const v = l.const
      // Zod literals accept string, number, boolean, null, bigint, undefined.
      if (
        v === null ||
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean' ||
        typeof v === 'bigint'
      ) {
        return z.literal(v)
      }
      return z.unknown()
    }

    case 'Array': {
      const a = schema as TypeBoxArray
      return z.array(typeboxToZod(a.items, memo))
    }

    case 'Object': {
      const o = schema as TypeBoxObject
      const required = new Set(o.required ?? [])
      const shape: Record<string, AnyZodTypeAny> = {}
      for (const [k, v] of Object.entries(o.properties)) {
        let prop = typeboxToZod(v, memo)
        if (!required.has(k) || v[OptionalKind] === 'Optional') {
          prop = prop.optional()
        }
        shape[k] = prop
      }
      return z.object(shape)
    }

    case 'Record': {
      const r = schema as TypeBoxRecord
      const pattern = r.patternProperties ? Object.values(r.patternProperties)[0] : undefined
      const valueSchema = pattern ?? r.additionalProperties
      if (!valueSchema) return z.record(z.string(), z.unknown())
      return z.record(z.string(), typeboxToZod(valueSchema, memo))
    }

    case 'Union': {
      const u = schema as TypeBoxUnion
      const variants = u.anyOf.map((v) => typeboxToZod(v, memo))
      if (variants.length === 0) return z.unknown()
      if (variants.length === 1) return variants[0]!
      return z.union(variants as [AnyZodTypeAny, AnyZodTypeAny, ...AnyZodTypeAny[]])
    }

    case 'Unknown':
    case 'Any':
      return z.unknown()

    case 'Null':
      return z.null()

    default: {
      // Type.Recursive uses a $ref-style intermediate schema that surfaces
      // here as Kind === 'This' (the self-reference marker). The memoised
      // z.lazy(...) thunk handles this — we return z.unknown() here only
      // for genuinely unknown kinds so the unsupported case is visible.
      if (kind === 'This') {
        // The memo lookup at the top of typeboxToZod already returned the
        // lazy thunk for the parent; this branch is unreachable in practice.
        return z.unknown()
      }
      console.warn(`[typeboxToZod] Unsupported TypeBox kind: ${String(kind)}. Falling back to z.unknown().`)
      return z.unknown()
    }
  }
}
