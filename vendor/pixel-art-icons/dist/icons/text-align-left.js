import { jsx as _jsx } from "react/jsx-runtime";
// Authored in-house: four horizontal bars with rows 2 and 4 shorter and
// flush-left, the universal "align left" glyph. Matches the existing
// pixel-art style (2 px tall bars on the 24×24 grid).
export function TextAlignLeftIcon({ size = 24, color = 'currentColor', className, style }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: color, xmlns: "http://www.w3.org/2000/svg", className: className, style: style, children: _jsx("path", { d: "M21 7H3V5h18v2ZM15 11H3V9h12v2Zm6 4H3v-2h18v2ZM13 19H3v-2h10v2Z" }) }));
}
