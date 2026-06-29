#!/usr/bin/env bash
# Open ONE draft PR from neukreativ/instatic → CoreBunch/instatic.
# Usage: ./scripts/open-upstream-draft-pr.sh <branch> "<title>" "<body-file-or->"
#
# Only run after you tested the branch locally (bun test + manual QA).
set -euo pipefail

UPSTREAM="corebunch/instatic"
FORK="neukreativ"

if ! gh auth status >/dev/null 2>&1; then
  echo "gh nicht eingeloggt: gh auth login" >&2
  exit 1
fi

branch="${1:?branch name required}"
title="${2:?PR title required}"
body_source="${3:-}"

if [[ -z "$body_source" || "$body_source" == "-" ]]; then
  body="$(cat)"
else
  body="$(cat "$body_source")"
fi

# Ensure branch exists on GitHub fork
git push -u origin "$branch"

gh pr create \
  --repo "$UPSTREAM" \
  --head "${FORK}:${branch}" \
  --base main \
  --draft \
  --title "$title" \
  --body "$body"

echo "Draft PR opened: ${UPSTREAM} ← ${FORK}:${branch}"
