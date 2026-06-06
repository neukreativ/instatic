/**
 * base.link editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration.
 *
 * Children-vs-text fallback MUST mirror the publisher (`render()` in
 * `index.ts`). The publisher emits `props.text` whenever the node has no
 * rendered children. `??` alone is wrong here because `NodeRenderer` always
 * passes `node.children.map(...)` — an empty array is NOT nullish, so a
 * `children ?? props.text` short-circuit would render an empty link in the
 * canvas while the published page renders the text.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import type { LinkStoredProps } from './index'

export const LinkEditor: React.FC<ModuleComponentProps<LinkStoredProps>> = ({ props, children, mcClassName, nodeWrapperProps }) => {
  const rel = props.target === '_blank' ? 'noopener noreferrer' : undefined
  const hasChildren = Array.isArray(children) ? children.length > 0 : children != null
  const content = hasChildren ? children : (props.text ?? 'Link text')
  return React.createElement(
    'a',
    {
      ...nodeWrapperProps,
      href: props.href || '#',
      target: props.target,
      rel,
      className: mcClassName,
    },
    content,
  )
}
