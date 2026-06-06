/**
 * styleRule slice — create + update of style rules and their per-context
 * style bags: createClass, createAmbientRule, updateClassStyles,
 * setClassContextStyles.
 */

import { nanoid } from 'nanoid'
import type { StyleRule } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'
import { isGeneratedClassLocked } from '@core/page-tree'
import { assertValidCssClassName } from '@core/page-tree'
import { isValidCssSelector } from '../../styleRuleRename'
import type { SiteSliceHelpers } from '../site/types'
import type { StyleRuleSlice } from './types'
import { nextRuleOrder, hasStylePatchChanges } from './helpers'

export type CrudActions = Pick<
  StyleRuleSlice,
  'createClass' | 'createAmbientRule' | 'updateClassStyles' | 'setClassContextStyles'
>

export function createCrudActions({ get, mutateSite }: SiteSliceHelpers): CrudActions {
  return {
    createClass(name, styles = {}) {
      const { site } = get()
      if (!site) throw new Error('[styleRuleSlice] Site document is not initialized')
      assertValidCssClassName(name)

      // Uniqueness check
      const existing = Object.values(site.styleRules).find((c) => c.name === name)
      if (existing) throw new Error(`[styleRuleSlice] A class named "${name}" already exists`)

      const now = Date.now()
      const newClass: StyleRule = {
        id: nanoid(),
        name,
        kind: 'class',
        selector: classKindSelector(name),
        order: nextRuleOrder(site.styleRules),
        styles,
        contextStyles: {},
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((site) => {
        site.styleRules[newClass.id] = newClass
        return true
      })

      return newClass
    },

    createAmbientRule(input) {
      const { site } = get()
      if (!site) throw new Error('[styleRuleSlice] Site document is not initialized')

      const selector = input.selector.trim()
      if (selector.length === 0) {
        throw new Error('[styleRuleSlice] Ambient selector cannot be empty')
      }
      if (!isValidCssSelector(selector)) {
        throw new Error(`[styleRuleSlice] Invalid CSS selector: ${selector}`)
      }

      // Default display name to the selector text. Unlike class-kind rules,
      // ambient rule names are not required to be globally unique — multiple
      // rules can share a selector (cascade resolves by `order`).
      const name = (input.name && input.name.trim().length > 0) ? input.name.trim() : selector

      const now = Date.now()
      const newRule: StyleRule = {
        id: nanoid(),
        name,
        kind: 'ambient',
        selector,
        order: nextRuleOrder(site.styleRules),
        styles: input.styles ?? {},
        contextStyles: input.contextStyles ?? {},
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((site) => {
        site.styleRules[newRule.id] = newRule
        return true
      })

      return newRule
    },

    updateClassStyles(classId, patch) {
      const { site } = get()
      const cls = site?.styleRules[classId]
      if (!cls) return
      if (isGeneratedClassLocked(cls)) return
      if (!hasStylePatchChanges(cls.styles, patch)) return

      mutateSite((site) => {
        const draftClass = site.styleRules[classId]
        if (!draftClass) return false
        Object.assign(draftClass.styles, patch)
        // Remove keys explicitly set to undefined/null (allow clearing a property)
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.styles[k]
          }
        }
        draftClass.updatedAt = Date.now()
        return true
      })
    },

    setClassContextStyles(classId, contextId, patch) {
      const { site } = get()
      const cls = site?.styleRules[classId]
      if (!cls) return
      if (isGeneratedClassLocked(cls)) return
      const currentStyles = cls.contextStyles[contextId] ?? {}
      if (!hasStylePatchChanges(currentStyles, patch)) return

      mutateSite((site) => {
        const draftClass = site.styleRules[classId]
        if (!draftClass) return false
        if (!draftClass.contextStyles[contextId]) {
          draftClass.contextStyles[contextId] = {}
        }
        Object.assign(draftClass.contextStyles[contextId], patch)
        // Remove keys explicitly set to undefined/null
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.contextStyles[contextId][k]
          }
        }
        draftClass.updatedAt = Date.now()
        return true
      })
    },
  }
}
