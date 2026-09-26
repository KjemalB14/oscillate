#!/usr/bin/env bash
# Cases for .claude/e2e-spec-lock.sh — run from the repo root after changing it. Kept in a
# file because a command line naming a spec path is exactly what the lock reads.
S=spec.ts
t() { echo "$1" | bash .claude/e2e-spec-lock.sh >/dev/null 2>&1; r=$?; [ "$r" = "$2" ] && ok=ok || ok=FAIL; echo "$ok $r (want $2) ← $3"; }
t '{"tool_name":"Write","tool_input":{"file_path":"/x/e2e/a.'$S'"}}' 2 "main write spec"
t '{"agent_type":"e2e-author","tool_name":"Write","tool_input":{"file_path":"/x/e2e/a.'$S'"}}' 0 "author write spec"
t '{"agent_type":"general-purpose","tool_name":"Edit","tool_input":{"file_path":"/x/e2e/a.'$S'"}}' 2 "other subagent edit"
t '{"tool_name":"Write","tool_input":{"file_path":"/x/e2e/helpers/app.ts"}}' 0 "main write helper"
t '{"tool_name":"Bash","tool_input":{"command":"npx wdio run e2e/wdio.conf.ts --spec e2e/a.'$S'"}}' 0 "run spec"
t '{"tool_name":"Bash","tool_input":{"command":"npx wdio run e2e/wdio.conf.ts --spec e2e/a.'$S' 2>&1 | tail -3"}}' 0 "run spec 2>&1"
t '{"tool_name":"Bash","tool_input":{"command":"cat e2e/a.'$S' >/dev/null"}}' 0 "cat to devnull"
t '{"tool_name":"Bash","tool_input":{"command":"sed -i \"\" s/a/b/ e2e/a.'$S'"}}' 2 "sed -i spec"
t '{"tool_name":"Bash","tool_input":{"command":"echo x > e2e/a.'$S'"}}' 2 "redirect into spec"
t '{"tool_name":"Bash","tool_input":{"command":"echo x 2>&1 > e2e/a.'$S'"}}' 2 "plumbing plus redirect"
t '{"tool_name":"Bash","tool_input":{"command":"rm e2e/a.'$S'"}}' 2 "rm spec"
t '{"tool_name":"Bash","tool_input":{"command":"tee e2e/a.'$S' < x"}}' 2 "tee into spec"
t '{"tool_name":"Bash","tool_input":{"command":"cp /tmp/x e2e/a.'$S'"}}' 2 "cp onto spec"
t '{"tool_name":"Bash","tool_input":{"command":"python3 - <<EOF\\ns = \\"e2e/a.'$S' is temporary\\"\\nopen(\\"NOTES.md\\",\\"w\\")\\nEOF"}}' 0 "python writing prose that names a spec"
t '{"tool_name":"Bash","tool_input":{"command":"cat > NOTES.md <<EOF\\nsee e2e/a.'$S'\\nEOF"}}' 0 "heredoc into NOTES naming a spec"
t '{"tool_name":"Bash","tool_input":{"command":"sed -i \"\" s/a/b/ e2e/helpers/app.ts && head -3 e2e/a.'$S'"}}' 0 "sed -i helper, then read a spec"
t '{"tool_name":"Bash","tool_input":{"command":"sed -i \"\" s/a/b/ e2e/helpers/app.ts e2e/a.'$S'"}}' 2 "sed -i helper and spec"
t '{"tool_name":"Write","tool_input":{"file_path":"/x/e2e/harness.check.ts"}}' 0 "main write harness check"
t '{"tool_name":"Bash","tool_input":{"command":"npm run e2e -- --spec e2e/a.'$S' 2>&1 | tail -3"}}' 0 "npm run e2e one spec"
