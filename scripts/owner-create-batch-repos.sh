#!/usr/bin/env bash
# Creates the GitHub repositories for locally prepared set repos and pushes them. Usage: scripts/owner-create-batch-repos.sh tmp/wave2
# Each directory must already be a git repository on branch main with its import commit (an agent prepares that part).
set -euo pipefail
parent=${1:?parent directory holding ducktape-assets-<set> repos}
for d in "$parent"/ducktape-assets-*; do
  n=$(basename "$d")
  if gh repo view "adrian729/$n" >/dev/null 2>&1; then echo "$n: exists"; (cd "$d" && git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/adrian729/$n.git"; git push -q -u origin main); continue; fi
  (cd "$d" && gh repo create "adrian729/$n" --public --source . --push --description "Ducktape Assets set ${n#ducktape-assets-}" >/dev/null && echo "$n: created and pushed")
done
