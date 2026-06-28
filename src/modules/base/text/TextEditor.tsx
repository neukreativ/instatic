/**
 * base.text editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration. Per Constraint #309, this file MUST NOT
 * export non-component values — `normalizeTag` and the tag vocabulary live in
 * the shared `./tags` module that both this file and `index.ts` import.
 *
 * Text renders through `dangerouslySetInnerHTML` (escaped value with `\n` →
 * `<br>`) so the canvas shows the same hard breaks the published page does.
 *
 * Inline editing (double-click): when `inlineEdit` is present, THIS element
 * IS the editor — it becomes `contentEditable` and the canvas reads the text
 * back out of it. There is no overlay, so the editing surface is byte-identical
 * to the published element.
 */
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'
import { htmlAttributesForReact } from '@modules/base/shared/htmlAttributes'
import { inlineEditableElementProps, rawTextToBreakHtml } from '@modules/base/shared/inlineText'
import { normalizeTag } from './tags'
import type { TextStoredProps } from './props'

export const TextEditor: React.FC<ModuleComponentProps<TextStoredProps>> = ({
  props,
  mcClassName,
  nodeWrapperProps,
  inlineEdit,
}) => {
  const tag = normalizeTag(props.tag)

  // Editing: the element becomes the contentEditable surface (content seeded
  // from the frozen initial HTML inside inlineEditableElementProps). `tag: none`
  // has no published element, but an active edit session still needs a host —
  // a `<span>` is the minimal one.
  if (inlineEdit) {
    const EditTag = (tag === 'none' ? 'span' : tag) as React.ElementType
    return React.createElement(EditTag, {
      ...nodeWrapperProps,
      ...(tag === 'none' ? {} : htmlAttributesForReact(props.htmlAttributes)),
      className: mcClassName,
      ...inlineEditableElementProps(inlineEdit),
    })
  }

  // Display: `tag: none` publishes bare text with no wrapper element. The canvas
  // still needs a host for selection/hover/inline-edit, so wrap the fragment in
  // a canvas-only inline span that carries the module's editor attributes.
  if (tag === 'none') {
    return (
      <span
        {...nodeWrapperProps}
        className={mcClassName}
        data-instatic-canvas-text-host=""
      >
        <BareText text={props.text ?? ''} />
      </span>
    )
  }

  // Display: escaped text with newlines as <br>, matching the publisher.
  const html = rawTextToBreakHtml(props.text || 'Text')
  const Tag = tag as React.ElementType
  return React.createElement(Tag, {
    ...nodeWrapperProps,
    ...htmlAttributesForReact(props.htmlAttributes),
    className: mcClassName,
    dangerouslySetInnerHTML: { __html: html },
  })
}

/**
 * Bare text with `\n` → `<br>` breaks and NO wrapping element — a fragment, so
 * it adds no host element to the canvas DOM. Mirrors the publisher's
 * `textToBreakHtml` output for `tag: none` (bare text + `<br>`); React escapes
 * each text segment, matching the publisher's pre-escaped output.
 */
const BareText: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split('\n').map((segment, i) => (
      <React.Fragment key={i}>
        {i > 0 ? <br /> : null}
        {segment}
      </React.Fragment>
    ))}
  </>
)
