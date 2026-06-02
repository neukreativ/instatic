import { jsx as _jsx } from "react/jsx-runtime";
// Authored in-house: vertical companion to `more-horizontal-solid`. Three
// plus-cross "dots" stacked vertically, centered horizontally. Used by
// the content editor's gutter "block options" button — the menu mixes
// turn-into / insert / duplicate / delete, so a 3-dots (more) glyph
// reads more honestly than a "+" (which implies insert-only).
export function MoreVerticalSolidIcon({ size = 24, color = 'currentColor', className, style }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: color, xmlns: "http://www.w3.org/2000/svg", className: className, style: style, children: _jsx("path", { d: "M12 3h2v2h-2v2h-2v-2H8v-2h2V1h2v2Zm0 8h2v2h-2v2h-2v-2H8v-2h2V9h2v2Zm0 8h2v2h-2v2h-2v-2H8v-2h2v-2h2v2Z" }) }));
}
