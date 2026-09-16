#!/usr/bin/env bash
#
# Decides whether a Dependabot PR may be approved and queued automatically.
#
# Reads (all from dependabot/fetch-metadata, except POLICY_ROOT):
#   UPDATE_TYPE   version-update:semver-{patch,minor,major}
#   NAMES         comma-separated dependency-names
#   DIRECTORY     the manifest directory the PR updates ("/" for the root)
#   POLICY_ROOT   where to read manifests from (default "."), for tests
#
# Writes `approve=` and `reason=` to $GITHUB_OUTPUT, and surfaces a held PR
# as an ::notice plus a run-summary line. Lives here rather than inline in the
# workflow so it can be exercised by dependabot-policy.test.sh on every push —
# the guards below are only worth having if deleting one fails a check.
set -euo pipefail

ROOT="${POLICY_ROOT:-.}"
OUT="${GITHUB_OUTPUT:-/dev/null}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

approve() {
  echo "reason=$1" >> "$OUT"
  echo "approve=true" >> "$OUT"
  exit 0
}

# A held PR is the case a person has to pick up, and nothing else in the run
# says so: the job is green either way and a step output is not somewhere
# people look.
hold() {
  echo "reason=$1" >> "$OUT"
  echo "approve=false" >> "$OUT"
  echo "::notice title=Dependabot PR held for review::$1"
  echo "**Held for review:** $1" >> "$SUMMARY"
  exit 0
}

case "${UPDATE_TYPE:-}" in
  version-update:semver-patch|version-update:semver-minor)
    approve "patch or minor";;
  version-update:semver-major)
    ;;
  *)
    hold "update-type '${UPDATE_TYPE:-<empty>}' is not one this policy recognises";;
esac

# Branch protection requires exactly three contexts — E2E, Lint & Build and
# Unit & Integration — and all three run against the root package. CLI Sync
# Check and OpenClaw Plugin Check are NOT required, so a major in /cli or
# /openclaw would auto-merge on root-only green, with the suites that actually
# exercise it gating nothing.
case "${DIRECTORY:-/}" in
  /|"") ;;
  *) hold "major in ${DIRECTORY} — its suite is not a required check, so a human decides";;
esac

[ -z "${NAMES:-}" ] && hold "major, and fetch-metadata named no dependency"

# Runtime means any of dependencies / peerDependencies / optionalDependencies,
# in any manifest: a peer or optional major changes what a consumer resolves
# just as surely as a direct one. Absent everywhere counts as runtime too —
# the safe reading of "unknown" is "not dev".
runtime=""
IFS=','
for name in $NAMES; do
  name="${name#"${name%%[![:space:]]*}"}"
  [ -z "$name" ] && continue
  seen=0
  for manifest in "$ROOT/package.json" "$ROOT/cli/package.json" "$ROOT/openclaw/package.json"; do
    [ -f "$manifest" ] || continue
    for block in dependencies peerDependencies optionalDependencies; do
      if jq -e --arg n "$name" --arg b "$block" '.[$b] // {} | has($n)' "$manifest" >/dev/null; then
        runtime="$runtime $name($(basename "$(dirname "$manifest")")/$block)"
        seen=1
      fi
    done
    if jq -e --arg n "$name" '.devDependencies // {} | has($n)' "$manifest" >/dev/null; then
      seen=1
    fi
  done
  [ "$seen" = "0" ] && runtime="$runtime $name(undeclared)"
done
unset IFS

[ -n "$runtime" ] && hold "major touching runtime or undeclared packages:$runtime"

# Two devDependencies that are not like the others: `typescript` is the
# compiler every workspace builds and type-checks with, and `@types/node`
# types the runtime surface the published .d.ts files are emitted against. A
# major in either changes what ships even though neither ships itself — #326
# needed a moduleResolution change to take TypeScript 6, and ts-jest's peer
# range still excludes 7.
toolchain=""
IFS=','
for name in $NAMES; do
  name="${name#"${name%%[![:space:]]*}"}"
  case "$name" in
    typescript|@types/node) toolchain="$toolchain $name";;
  esac
done
unset IFS

[ -n "$toolchain" ] && hold "major on the toolchain:$toolchain"

approve "major in the root, every package dev-only"
