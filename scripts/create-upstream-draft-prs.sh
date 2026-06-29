#!/usr/bin/env bash
# Open all editor-feature draft PRs (run ONLY after manual QA on each branch).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

run() { "$ROOT/scripts/open-upstream-draft-pr.sh" "$@"; }

run feat/preserve-style-search-across-selectors \
  "feat(editor): preserve style search when switching selector pills" \
  - <<'EOF'
## Summary
- Style search query persists when switching selector pills on the same element.
- Auto-focuses the selector pill that already sets a matching property.

## Test plan
- [x] `bun test src/__tests__/panels/styleQueryUtils.test.ts`
- [ ] Manual QA complete
EOF

run feat/editor-canvas-text-click-selects-content \
  "feat(editor): select text module when clicking canvas text" \
  - <<'EOF'
## Summary
- Clicks on visible text select the inner text module instead of an outer container.

## Test plan
- [x] `bun test src/__tests__/canvas/canvasEventTarget.test.ts src/__tests__/canvas/textNodeClickSelection.test.tsx`
- [ ] Manual QA complete
EOF

run fix/editor-breakpoint-style-cascade-panel \
  "fix(editor): show breakpoint style cascade in properties panel" \
  - <<'EOF'
## Summary
- Properties panel shows effective styles like CSS cascade across breakpoints.

## Test plan
- [x] `bun test src/__tests__/panels/breakpointStyleCascade.test.ts`
- [ ] Manual QA complete
EOF

run feat/editor-active-expanded-property-sections \
  "feat(editor): active expanded property sections mode" \
  - <<'EOF'
## Summary
- Preference expanded / collapsed / active; smart section + selector defaults.

## Test plan
- [x] `bun test src/__tests__/panels/styleSelectionUtils.test.ts`
- [ ] Manual QA complete

**Note:** Rebase onto merged style-search PR before marking ready.
EOF

echo "All draft PRs opened from neukreativ/instatic."
