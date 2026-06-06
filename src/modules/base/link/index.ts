/**
 * base.link — anchor element.
 *
 * Emits a bare `<a>` with no default class or default CSS.
 * Visual styling is opt-in via user classes (mcClassName / multi-class system).
 */
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { safeUrl } from '@modules/base/utils/escape'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { LinkEditor } from './LinkEditor'

const LinkPropsSchema = Type.Object({
  href: Type.String({ default: '#' }),
  text: Type.String({ default: 'Click here' }),
  target: Type.Union(
    [Type.Literal('_self'), Type.Literal('_blank'), Type.Literal('_parent')],
    { default: '_self' },
  ),
})

export type LinkStoredProps = Static<typeof LinkPropsSchema>

export const LinkModule: ModuleDefinition<LinkStoredProps> = {
  id: 'base.link',
  name: 'Link',
  description: 'An anchor element.',
  category: 'Interactive',
  version: '2.0.0',
  icon: LinkIcon,
  trusted: true,
  canHaveChildren: true,

  schema: {
    href: { type: 'url', label: 'URL' },
    text: { type: 'text', label: 'Link text', placeholder: 'Displayed when no children' },
    target: {
      type: 'select',
      label: 'Target',
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
        { label: 'Parent', value: '_parent' },
      ],
    },
  },

  propsSchema: LinkPropsSchema,

  defaults: Value.Create(LinkPropsSchema),

  component: LinkEditor,

  htmlTag: 'a',

  render: (props, renderedChildren) => {
    const href = safeUrl(props.href)
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    const targetAttr = ` target="${String(props.target)}"`
    const content = renderedChildren.length > 0 ? renderedChildren.join('') : String(props.text ?? '')
    return {
      html: `<a href="${href}"${targetAttr}${rel}>${content}</a>`,
    }
  },
}

registry.registerOrReplace(LinkModule)
