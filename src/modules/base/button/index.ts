/**
 * base.button — content/behavior module.
 *
 * Emits a bare semantic `<button>` (or `<a>` when `href` is set) with no
 * default class or default CSS. Visual styling is opt-in via user classes
 * (mcClassName / multi-class system).
 */
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { CursorClickSolidIcon } from 'pixel-art-icons/icons/cursor-click-solid'
import { safeUrl } from '@modules/base/utils/escape'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { ButtonEditor } from './ButtonEditor'

const ButtonPropsSchema = Type.Object({
  label: Type.String({ default: 'Get Started' }),
  href: Type.String({ default: '' }),
  target: Type.Union(
    [Type.Literal('_self'), Type.Literal('_blank'), Type.Literal('_parent')],
    { default: '_self' },
  ),
  disabled: Type.Boolean({ default: false }),
})

export type ButtonStoredProps = Static<typeof ButtonPropsSchema>

export const ButtonModule: ModuleDefinition<ButtonStoredProps> = {
  id: 'base.button',
  name: 'Button',
  description: 'A button or call-to-action link.',
  category: 'Interactive',
  version: '2.0.0',
  icon: CursorClickSolidIcon,
  trusted: true,
  canHaveChildren: false,

  schema: {
    label: { type: 'text', label: 'Label', placeholder: 'Button text...' },
    href: { type: 'url', label: 'Link URL' },
    target: {
      type: 'select',
      label: 'Link target',
      // Choosing how a button opens its link is a content decision, not a
      // structural one — exposed to the Client role.
      category: 'content',
      condition: { field: 'href', notEq: '' },
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
        { label: 'Parent', value: '_parent' },
      ],
    },
    disabled: { type: 'toggle', label: 'Disabled' },
  },

  propsSchema: ButtonPropsSchema,

  defaults: Value.Create(ButtonPropsSchema),

  component: ButtonEditor,

  htmlTag: (props) => {
    const href = safeUrl(props.href)
    return href && href !== '#' ? 'a' : 'button'
  },

  render: (props) => {
    const href = safeUrl(props.href)
    const label = String(props.label ?? '')
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    if (href && href !== '#') {
      return { html: `<a href="${href}" target="${String(props.target)}"${rel}>${label}</a>` }
    }
    const disabledAttr = props.disabled ? ' disabled aria-disabled="true"' : ''
    return { html: `<button type="button"${disabledAttr}>${label}</button>` }
  },
}

registry.registerOrReplace(ButtonModule)
