#!/usr/bin/env bash
# Cases for .claude/e2e-merge-gate.sh — run from the repo root after changing it. Builds a
# throwaway repo with one branch per answer and checks the dry-run decision for each.
gate="$PWD/.claude/e2e-merge-gate.sh"
repo=$(mktemp -d)
trap 'rm -rf "$repo"' EXIT
g() { git -C "$repo" "$@" >/dev/null 2>&1; }
commit() { mkdir -p "$repo/$(dirname "$1")"; echo "$RANDOM" >>"$repo/$1"; g add -A; g commit -m "$2"; }

g init -b main
commit NOTES.md "start"
g switch -c docs-only && commit NOTES.md "docs" && g switch main
g switch -c app-no-spec && commit src/Sidebar.tsx "app" && g switch main
g switch -c app-trailer && commit src-tauri/src/poll.rs $'refactor\n\nE2E: none — below what the app shows' && g switch main
g switch -c app-spec && commit src/Sidebar.tsx "app" && commit e2e/sidebar.spec.ts "spec" && g switch main
g switch -c app-green && commit src/App.tsx "app" && commit e2e/other.spec.ts "spec" && g switch main
git -C "$repo" rev-parse "app-green^{tree}" >>"$repo/.git/e2e-green"

t() { # <command> <cwd> <want> <label>
  input=$(jq -nc --arg c "$1" --arg d "$2" '{tool_name:"Bash",tool_input:{command:$c},cwd:$d}')
  got=$(E2E_GATE_DRY=1 bash "$gate" <<<"$input" 2>/dev/null)
  [ "$got" = "$3" ] && ok=ok || ok=FAIL
  echo "$ok '$got' (want '$3') ← $4"
}
t "git merge docs-only" "$repo" "allow: no app code changed" "docs only"
t "git merge app-no-spec" "$repo" "block: app changed, no spec" "app, no spec"
t "git merge --no-ff -m 'Merge app-no-spec' app-no-spec" "$repo" "block: app changed, no spec" "flags and a quoted message"
t "git merge app-trailer" "$repo" "block: not green" "trailer, not green"
t "git merge app-spec" "$repo" "block: not green" "spec, not green"
t "git merge app-green" "$repo" "allow: this tree passed" "spec, green"
t "git -C '$repo' merge app-no-spec" "/" "block: app changed, no spec" "-C names the checkout, not cwd"
t "cargo test && git merge app-no-spec" "$repo" "block: app changed, no spec" "after a separator"
t "git commit -m 'git merge app-no-spec'" "$repo" "" "named inside a message"
t "git merge --abort" "$repo" "" "abort"
t "git merge no-such-branch" "$repo" "" "unknown ref"
g switch app-spec
t "git merge app-no-spec" "$repo" "" "not on main"
