#!/usr/bin/env bash
# Mirror origin/main to CoreBunch/instatic (upstream). Does not touch feature branches.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git fetch upstream

git checkout main
git reset --hard upstream/main
git push origin main --force-with-lease

echo "main = upstream/main ($(git rev-parse --short main)) → pushed to origin"
