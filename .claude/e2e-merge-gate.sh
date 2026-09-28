#!/usr/bin/env bash
# PreToolUse gate: a slice is not merged into main until the end-to-end suite has passed
# on exactly the code being merged. NOTES.md → *Chapter 2 closed* has the decision; it is
# clipped's push gate moved to the merge, because Oscillate has no remote.
#
# Three answers, in order, for `git merge <branch>` run while `main` is checked out:
#   1. Nothing the app is made of changes: allow.
#   2. App code changes with no e2e spec added or changed, and no commit on the branch
#      says `E2E: none — <reason>`: refuse. Whether a change can be seen in the app is a
#      judgment, and the trailer is where that judgment is written down.
#   3. Otherwise the branch's tree must be recorded green: a full `npm run e2e` on a
#      clean checkout of that commit appends its tree to <git-common-dir>/e2e-green.
#      Unlike clipped's gate, this one doesn't run the suite itself: at merge time the
#      checkout is main, and a suite run there would test main's code, not the branch's.
#
# It judges the checkout the command runs in (`git -C <dir>`, else the hook's cwd), never
# $CLAUDE_PROJECT_DIR, which in clipped let a worktree's push through as docs-only.
#
# E2E_GATE_DRY=1 prints the decision instead of blocking; the cases file uses it.
# Blocking is exit 2 with the reason on stderr, as the spec lock does.

input=$(cat)
[ "$(jq -r '.tool_name // ""' <<<"$input")" = "Bash" ] || exit 0
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
cwd=$(jq -r '.cwd // ""' <<<"$input")

# `git merge` as a command, at the start of a line or after a separator, not merely named
# in a commit message or prose. python's shlex reads the quoting; bash can't safely.
parsed=$(CMD="$cmd" python3 - <<'EOF'
import os, re, shlex
cmd = os.environ["CMD"]
for part in re.split(r"&&|\|\||;|\n", cmd):
    try:
        words = shlex.split(part)
    except ValueError:
        continue
    if len(words) < 2 or words[0] != "git":
        continue
    rest, where = words[1:], ""
    if rest[:1] == ["-C"] and len(rest) > 2:
        where, rest = rest[1], rest[2:]
    if rest[:1] != ["merge"]:
        continue
    args, refs, skip = rest[1:], [], False
    for a in args:
        if skip:
            skip = False
        elif a in ("-m", "-F", "-s", "-X", "--strategy", "--strategy-option", "--file"):
            skip = True
        elif a in ("--abort", "--continue", "--quit"):
            refs = []
            break
        elif not a.startswith("-"):
            refs.append(a)
    if refs:
        print(where)
        print(refs[-1])
        break
EOF
)
[ -n "$parsed" ] || exit 0
where=$(sed -n 1p <<<"$parsed")
branch=$(sed -n 2p <<<"$parsed")

dir=${where:-$cwd}
[ -n "$dir" ] && cd "$dir" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
[ "$(git branch --show-current)" = "main" ] || exit 0
git rev-parse --verify -q "$branch^{commit}" >/dev/null || exit 0

decide() {
  if [ -n "${E2E_GATE_DRY:-}" ]; then
    echo "$1"
    exit 0
  fi
}

changed=$(git diff --name-only "HEAD...$branch")
app='^(src/|src-tauri/src/|src-tauri/Cargo\.(toml|lock)$|src-tauri/tauri[^/]*\.json$|src-tauri/capabilities/|e2e/|package(-lock)?\.json$|index\.html$|vite\.config\.ts$)'
grep -Eq "$app" <<<"$changed" || {
  decide "allow: no app code changed"
  exit 0
}

if ! grep -Eq '^e2e/.*\.spec\.ts$' <<<"$changed" &&
  ! git log "HEAD..$branch" --format=%B | grep -Eqi '^E2E:[[:space:]]*none'; then
  decide "block: app changed, no spec"
  cat >&2 <<EOF
$branch changes the app and adds or changes no e2e spec. If the change can be seen in the
running app, quote its criterion from the PLAN to e2e-author and get a spec. If it cannot
(a refactor, a build script, something below what the app shows), say so in a commit
trailer on the branch — \`E2E: none — <why>\` — and merge again.
EOF
  exit 2
fi

tree=$(git rev-parse "$branch^{tree}")
green="$(git rev-parse --path-format=absolute --git-common-dir)/e2e-green"
grep -qx "$tree" "$green" 2>/dev/null && {
  decide "allow: this tree passed"
  exit 0
}
decide "block: not green"
cat >&2 <<EOF
$branch's code has no green e2e run on record. Check out $branch, commit everything, and
run \`npm run e2e\` — a green run of the whole suite on a clean checkout records the tree.
Then merge again. On red, read e2e/.results/brief.md and nothing else from the run.
EOF
exit 2
