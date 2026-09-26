#!/usr/bin/env bash
# PreToolUse guard: e2e specs are written by the e2e-author agent, never by the agent
# that wrote the code under test — an agent that writes both can write a test that
# agrees with its own misreading. PLAN-sessions.md → *Chosen* has the decision (ported from clipped).
#
# A subagent's hook input carries `agent_type`; the main session's does not. This is a
# guard against accidents, not a sandbox: it catches the ordinary ways of writing a
# spec, and a determined shell command could still get past it.

input=$(cat)
agent=$(jq -r '.agent_type // ""' <<<"$input")
[ "$agent" = "e2e-author" ] && exit 0

tool=$(jq -r '.tool_name // ""' <<<"$input")
# One path: `.*` here once ran from a helper's path across `&&` to a spec that was only
# being read, and refused an in-place edit of the helper.
spec='e2e/[^[:space:]|;&]*\.spec\.ts'

case "$tool" in
  Edit | Write | MultiEdit)
    path=$(jq -r '.tool_input.file_path // ""' <<<"$input")
    grep -Eq "$spec\$" <<<"$path" || exit 0
    ;;
  Bash)
    cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
    # Refuse only when a spec is the *target* — of a redirect or tee, an in-place edit, or
    # rm/mv/cp. Merely naming one is fine: running a spec, reading one, and writing prose
    # that mentions one (a heredoc into NOTES.md) all name a spec path next to words that
    # look like writes, and refusing those taught nothing but workarounds.
    target="['\"]?[^[:space:]'\"|;&]*$spec"
    grep -Eq "(>>?|\btee\b( -a)?)[[:space:]]*$target|\b(sed|perl)\b[^|;&]*[[:space:]]-i[^|;&]*$spec|\b(rm|mv|cp)\b[^|;&]*$spec" <<<"$cmd" || exit 0
    ;;
  *) exit 0 ;;
esac

echo "e2e specs are written by the e2e-author agent. Send it the change (the criterion, and what the failure brief says) instead of editing the spec." >&2
exit 2
