/**
 * base.list editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration. Per Constraint #309, this file MUST NOT
 * export non-component values — `parseItems` is duplicated in `index.ts`
 * for the publisher render path.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import styles from './list.module.css'
import type { ListStoredProps } from './index'

function parseItems(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export const ListEditor: React.FC<ModuleComponentProps<ListStoredProps>> = ({ props, mcClassName, nodeWrapperProps }) => {
  const items = parseItems(props.items || '')
  const Tag = props.listType === 'ordered' ? 'ol' : 'ul'
  return React.createElement(
    Tag,
    { ...nodeWrapperProps, className: mcClassName },
    items.length > 0
      ? items.map((item, i) => React.createElement('li', { key: i }, item))
      : React.createElement('li', { className: styles.placeholder, 'data-instatic-list-placeholder': '' }, 'List item 1'),
  )
}
