#!/usr/bin/env bash
# Sync main from Core, rebase each neukreativ feature branch onto it, run bun test.
#
# Usage:
#   ./scripts/check-core-compat.sh              # rebase + test (default)
#   ./scripts/check-core-compat.sh --dry-run    # sync main only, report merge conflicts without rebasing
#   ./scripts/check-core-compat.sh --push     # after success, force-push rebased branches to origin
#
# Agent shorthand: "Hol die neue Version von Core und prüfe ob unsere Features kompatibel sind"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FEATURE_BRANCHES=(
  feat/preserve-style-search-across-selectors
  feat/editor-canvas-text-click-selects-content
  fix/editor-breakpoint-style-cascade-panel
  feat/editor-active-expanded-property-sections
)

DRY_RUN=false
PUSH=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --push) PUSH=true ;;
    -h|--help)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

"$ROOT/scripts/sync-upstream.sh"

FAILURES=()
REBASED=()
START_BRANCH="$(git branch --show-current)"

for branch in "${FEATURE_BRANCHES[@]}"; do
  echo ""
  echo "=== ${branch} ==="

  if ! git show-ref --verify --quiet "refs/heads/${branch}"; then
    git fetch origin "${branch}:${branch}" 2>/dev/null || true
  fi
  if ! git show-ref --verify --quiet "refs/heads/${branch}"; then
    echo "SKIP: ${branch} (not found locally or on origin)"
    continue
  fi

  if $DRY_RUN; then
    base="$(git merge-base main "${branch}")"
    tree_out="$(git merge-tree "${base}" main "${branch}" 2>&1 || true)"
    if echo "${tree_out}" | grep -q '<<<<<<<'; then
      FAILURES+=("${branch} (would conflict with main)")
      echo "CONFLICT (dry-run)"
    else
      echo "OK (dry-run — no conflict markers)"
    fi
    continue
  fi

  git checkout "${branch}"
  before="$(git rev-parse HEAD)"
  if git rebase main; then
    if bun test; then
      echo "OK: ${branch}"
      REBASED+=("${branch}")
      if $PUSH; then
        git push --force-with-lease origin "${branch}"
        echo "Pushed: origin/${branch}"
      fi
    else
      FAILURES+=("${branch} (tests failed after rebase)")
      git reset --hard "${before}"
    fi
  else
    FAILURES+=("${branch} (rebase conflict — resolve manually)")
    git rebase --abort 2>/dev/null || git reset --hard "${before}"
  fi
done

git checkout "${START_BRANCH}" 2>/dev/null || git checkout main

echo ""
echo "Core: $(git rev-parse --short main) ($(git log -1 --format='%s' main))"

if ((${#FAILURES[@]})); then
  echo ""
  echo "FAILED (${#FAILURES[@]}):"
  printf '  - %s\n' "${FAILURES[@]}"
  exit 1
fi

if $DRY_RUN; then
  echo "Dry-run complete — no branches modified."
elif ((${#REBASED[@]})); then
  echo "All ${#REBASED[@]} feature branch(es) rebased onto core and passed bun test."
  if ! $PUSH; then
    echo "Rebased locally only. Push with: ./scripts/check-core-compat.sh --push"
  fi
else
  echo "No feature branches checked."
fi
