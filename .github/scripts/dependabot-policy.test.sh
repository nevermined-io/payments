#!/usr/bin/env bash
#
# Exercises dependabot-policy.sh against fixture manifests.
#
# The policy runs only on Dependabot PRs, so nothing in an ordinary CI run
# reaches it: without this, deleting a guard leaves every check green and
# silently restores automatic approval. Run from `lint_build` on every push.
#
# Fixtures rather than the repo's own manifests on purpose — a test that reads
# package.json starts passing for the wrong reason the day a dependency moves
# between blocks.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLICY="$HERE/dependabot-policy.sh"
FIXTURES="$(mktemp -d)"
trap 'rm -rf "$FIXTURES"' EXIT

mkdir -p "$FIXTURES/cli" "$FIXTURES/openclaw"
cat > "$FIXTURES/package.json" <<'JSON'
{
  "dependencies": { "axios": "^1.0.0" },
  "devDependencies": { "jest": "^30.0.0", "@types/jest": "^30.0.0", "typescript": "^6.0.0", "@types/node": "^20.0.0" },
  "peerDependencies": { "@langchain/core": ">=0.3.0" }
}
JSON
cat > "$FIXTURES/cli/package.json" <<'JSON'
{
  "dependencies": { "inquirer": "^9.0.0" },
  "devDependencies": { "ts-morph": "^22.0.0" },
  "optionalDependencies": { "fsevents": "^2.3.0" }
}
JSON
cat > "$FIXTURES/openclaw/package.json" <<'JSON'
{ "devDependencies": { "jest": "^30.0.0" } }
JSON

pass=0
fail=0

check() {
  local label="$1" want_approve="$2" want_reason="$3" update_type="$4" names="$5" directory="$6"
  local out summary got_approve got_reason
  out="$(mktemp)"; summary="$(mktemp)"

  POLICY_ROOT="$FIXTURES" GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="$summary" \
    UPDATE_TYPE="$update_type" NAMES="$names" DIRECTORY="$directory" \
    bash "$POLICY" > /dev/null 2>&1

  got_approve="$(grep '^approve=' "$out" | cut -d= -f2)"
  got_reason="$(grep '^reason=' "$out" | cut -d= -f2-)"

  if [ "$got_approve" != "$want_approve" ]; then
    echo "FAIL $label: approve=$got_approve, expected $want_approve (reason: $got_reason)"
    fail=$((fail + 1)); rm -f "$out" "$summary"; return
  fi
  case "$got_reason" in
    *"$want_reason"*) ;;
    *) echo "FAIL $label: reason '$got_reason' does not mention '$want_reason'"
       fail=$((fail + 1)); rm -f "$out" "$summary"; return;;
  esac
  # a held PR must be visible to a human, not just in a step output
  if [ "$want_approve" = "false" ] && ! grep -q "Held for review" "$summary"; then
    echo "FAIL $label: held without a run-summary line"
    fail=$((fail + 1)); rm -f "$out" "$summary"; return
  fi
  pass=$((pass + 1))
  rm -f "$out" "$summary"
}

check "patch approves"                true  "patch or minor"     version-update:semver-patch "axios"             "/"
check "minor approves"                true  "patch or minor"     version-update:semver-minor "axios"             "/"
check "root dev-only major approves"  true  "every package dev"  version-update:semver-major "jest, @types/jest" "/"
check "typescript major holds"        false "toolchain"          version-update:semver-major "typescript"        "/"
check "@types/node major holds"       false "toolchain"          version-update:semver-major "@types/node"       "/"
check "toolchain in a group holds"    false "toolchain"          version-update:semver-major "jest, typescript"  "/"
check "cli major holds"               false "not a required"     version-update:semver-major "ts-morph"          "/cli"
check "openclaw major holds"          false "not a required"     version-update:semver-major "jest"              "/openclaw"
check "runtime major holds"           false "root/dependencies"  version-update:semver-major "axios"             "/"
check "peer major holds"              false "peerDependencies"   version-update:semver-major "@langchain/core"   "/"
check "optional major holds"          false "optionalDependencies" version-update:semver-major "fsevents"        "/"
check "undeclared major holds"        false "undeclared"         version-update:semver-major "nobody-declares-me" "/"
check "empty update-type holds"       false "not one this policy" ""                         "jest"              "/"
check "unknown update-type holds"     false "not one this policy" version-update:semver-weird "jest"             "/"
check "major with no names holds"     false "named no dependency" version-update:semver-major ""                 "/"
check "empty directory holds"         false "named no directory" version-update:semver-major "jest"              ""
check "name with trailing space"      true  "every package dev"  version-update:semver-major "jest , @types/jest" "/"

echo "dependabot-policy: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
