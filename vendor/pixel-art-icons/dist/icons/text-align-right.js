import { jsx as _jsx } from "react/jsx-runtime";
// Authored in-house: four horizontal bars with rows 2 and 4 shorter and
// flush-right, the universal "align right" glyph.
export function TextAlignRightIcon({ size = 24, color = 'currentColor', className, style }) {
    return (_jsx("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: color, xmlns: "http://www.w3.org/2000/svg", className: className, style: style, children: _jsx("path", { d: "M21 7H3V5h18v2Zm0 4H9V9h12v2Zm0 4H3v-2h18v2Zm0 4H11v-2h10v2Z" }) }));
}
