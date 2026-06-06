/**
 * base.button editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration.
 *
 * The label is edited via the Properties panel only. The canvas-side
 * inline (double-click contentEditable) editing was removed — the
 * iframe-per-frame canvas made cross-frame focus/selection unreliable;
 * a clean replacement will be designed separately.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import type { ButtonStoredProps } from './index'

export const ButtonEditor: React.FC<ModuleComponentProps<ButtonStoredProps>> = ({
  props,
  mcClassName,
  nodeWrapperProps,
}) => {
  const label = props.label || 'Button'
  if (props.href) {
    const rel = props.target === '_blank' ? 'noopener noreferrer' : undefined
    return (
      <a
        {...nodeWrapperProps}
        href={props.href}
        target={props.target}
        rel={rel}
        className={mcClassName}
      >
        {label}
      </a>
    )
  }
  return (
    <button {...nodeWrapperProps} type="button" className={mcClassName} disabled={props.disabled}>
      {label}
    </button>
  )
}
