#!/usr/bin/env bash
# One sitting for the owner: everything on npm that needs a passkey. Run from the main repository root, IN A REAL
# TERMINAL: the first publish opens a passkey prompt that must be answered, so the script cannot run through an
# assistant that backgrounds long commands (Claude Code's `!` does after 120 s), nor unattended.
#
#   ./scripts/owner-npm-bootstrap.sh              # bootstrap every package name the current plan needs
#   ./scripts/owner-npm-bootstrap.sh --test-stage # first: a throwaway test of staged publishing (Phase 0 unknown)
#
# What it does, in order:
#   1. `npm whoami` (log in first with `npm login` if needed; sessions last 2 hours).
#   2. For each package name not yet on the registry: publish a 0.0.0 placeholder (the first publish prompts for your
#      passkey once; npmjs.com then offers "skip 2FA for 5 minutes", accept it so the rest of the loop runs unattended).
#   3. For each: `npm trust github ...` binding the name to adrian729/ducktape-assets, workflow publish.yml, environment
#      release, with publish allowed (configs created after 2026-09-03 default to stage-only without --allow-publish).
#   4. Triggers the publisher workflow (the trust config expires in 2 days if unused). No approval step since 2026-10-26.
#
# Flags of `npm trust` were taken from the npm docs on 2026-10-26; if the command rejects them, run `npm help trust` and
# adjust the two lines marked ADJUST. Nothing here is destructive: placeholders are 0.0.0 and are superseded by the first
# real publish; a wrong trust config can be revoked on npmjs.com.
set -euo pipefail
cd "$(dirname "$0")/.."

SCOPE="@ranx729"
REPO="adrian729/ducktape-assets"
WORKFLOW="publish.yml"
ENVIRONMENT="release"
PLACEHOLDER_DIR="$(mktemp -d)"

names=()
if [[ "${1:-}" == "--test-stage" ]]; then
  names=("$SCOPE/ducktape-assets-zz-stage-test")
else
  # Every package name a plan would publish for the registered sets, plus the index package.
  # sets.yaml lists one flow-style entry per line: `  - { id: <set>, status: active, ... }`. Parsed with sed so that this
  # script needs nothing installed.
  while IFS= read -r id; do
    [[ -n "$id" ]] && names+=("$SCOPE/ducktape-assets-$id" "$SCOPE/ducktape-assets-$id-masters")
  done < <(sed -n -E 's/^[[:space:]]*-[[:space:]]*\{[[:space:]]*id:[[:space:]]*([A-Za-z0-9-]+),[[:space:]]*status:[[:space:]]*active.*/\1/p' sets.yaml)
  [[ ${#names[@]} -ge 2 ]] || { echo "no active set found in sets.yaml; refusing to continue (run from the repository root)"; exit 1; }
  names+=("$SCOPE/ducktape-assets")
fi

me=$(npm whoami 2>/dev/null) || { echo "not logged in to npm (npm whoami failed); run 'npm login' first, then rerun this script"; exit 1; }
echo "logged in as: $me"
echo "packages: ${names[*]}"
echo

missing=()
for n in "${names[@]}"; do
  if npm view "$n" version >/dev/null 2>&1; then echo "exists: $n"; else missing+=("$n"); fi
done
echo "placeholders to publish: ${#missing[@]}"

if [[ "${1:-}" == "--test-stage" ]]; then
  # Phase 0 unknown: does `npm stage publish` create a placeholder for a brand-new name? Record the answer in Open questions.
  d="$PLACEHOLDER_DIR/stage"; mkdir -p "$d"
  printf '{"name":"%s","version":"0.0.1","description":"throwaway staged-publish test","license":"MIT","publishConfig":{"access":"public"}}\n' "${missing[0]}" > "$d/package.json"
  echo "# throwaway" > "$d/README.md"
  (cd "$d" && npm stage publish --access public) && echo "stage publish accepted for a new name" || echo "stage publish refused for a new name (expected by one source; placeholders must be published normally)"
  exit 0
fi

for n in "${missing[@]}"; do
  d="$PLACEHOLDER_DIR/$(echo "$n" | tr '/@' '__')"; mkdir -p "$d"
  printf '{"name":"%s","version":"0.0.0","description":"Placeholder; the first real release is published by %s","license":"MIT","repository":{"type":"git","url":"git+https://github.com/%s.git"},"publishConfig":{"access":"public"}}\n' "$n" "$REPO" "$REPO" > "$d/package.json"
  printf '# %s\n\nPlaceholder. See https://github.com/%s\n' "$n" "$REPO" > "$d/README.md"
  echo "publishing placeholder $n"
  # The public registry view can lag minutes behind a fresh publish, so a name published moments ago may still look
  # missing above; npm then answers "cannot publish over the previously published versions: 0.0.0", which means it exists.
  # Every other failure stops the script: an EOTP here means the passkey prompt could not be answered, which happens when
  # the script runs without a terminal (for example through an assistant that backgrounds long commands).
  out=$(cd "$d" && npm publish --access public 2>&1) && echo "$out" | tail -2 || {
    if grep -q "cannot publish over" <<< "$out"; then echo "  (placeholder already published for $n; continuing)";
    else echo "$out" | tail -12; echo; echo "publish of $n failed; nothing was dispatched. Run this script in an interactive terminal (the passkey prompt must be answered), then rerun."; exit 1; fi; }
  sleep 2
done

# Trust every name, not only the new ones: a name that already exists may still lack its trust config (an earlier run
# that stopped early, or a placeholder published by hand). npm refuses a duplicate config, which is harmless here.
trust_failed=0
for n in "${names[@]}"; do
  echo "trusting $n"
  out=$(npm trust github "$n" --repo "$REPO" --file "$WORKFLOW" --env "$ENVIRONMENT" --allow-publish --yes 2>&1) && echo "$out" | tail -1 || {
    if grep -qE "E409|already exists" <<< "$out"; then echo "  (trust config exists already for $n)";
    else echo "$out" | tail -6; echo "  trust config NOT created for $n"; trust_failed=$((trust_failed + 1)); fi; }
  sleep 2
done
if [[ $trust_failed -gt 0 ]]; then
  echo; echo "$trust_failed trust config(s) failed (see above); not dispatching the publisher. Fix the cause (usually: not logged in, or the passkey prompt could not be answered) and rerun."; exit 1
fi

echo
echo "Trust configs expire in 2 days if unused. Triggering the publisher now (no approval step since 2026-10-26):"
gh workflow run publish.yml --repo "$REPO" && gh run list --repo "$REPO" --workflow publish.yml --limit 1
