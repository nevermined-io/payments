#!/usr/bin/env bash
#
# check_synced_doc_links.sh — replicate the docs-site sync, then run the real
# Mintlify link checker against the staged tree.
# (TypeScript sibling of payments-py's scripts/check_synced_doc_links.sh — same
#  intent; the implementations legitimately differ, see "Why minimal" below.)
#
# Why staged, not in-repo: the release pipeline (release.yml,
# publish-documentation job) copies markdown/*.md (except README.md) VERBATIM
# into the docs site at docs/api-reference/typescript/<name>.md. A plain in-repo
# link check would PASS and miss site-only breakage, because relative links
# resolve differently once the files live under api-reference/typescript/ (this
# class broke nevermined-io/docs#234). So we stage the files into that exact
# layout under a minimal Mintlify project and run `mintlify broken-links` — the
# same checker the docs repo uses — against it.
#
# Why minimal (and not a full docs-site clone, unlike the payments-py sibling):
# the TS pages link ONLY to same-directory siblings (e.g. `[Agents](./agents)`)
# — they have NO cross-tree site-relative links (`/docs/...` outside the synced
# dir). So a self-contained mini-site of just the synced TS pages resolves every
# internal link those pages contain; cloning the whole docs site would be
# over-engineering and adds a network dependency for no coverage gain. The PY
# sibling DOES use cross-tree site-relative links, so #241 must clone the whole
# site — that is the intentional difference, not a divergence by mistake.
#
# UPGRADE PATH: if future TS pages add cross-tree site-relative links
# (e.g. `[CLI](/api-reference/cli)`), this minimal mini-site will report them as
# broken. At that point, switch to cloning nevermined-io/docs and staging into
# docs/api-reference/typescript/ so the rest of the site resolves — exactly what
# payments-py's check_synced_doc_links.sh already does; mirror it.
#
# Hard-gates INTERNAL links only: `mintlify broken-links` checks internal links
# by default and only pings external URLs with --check-external (NOT passed —
# external liveness is network-flaky and must not block a release).
#
# Env knobs (optional):
#   MINTLIFY_VERSION  default 4.2.629 (pin; the docs repo tracks latest)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKDOWN_DIR="$PROJECT_ROOT/markdown"

# Pin Mintlify for reproducibility. The docs repo itself installs floating
# latest (npm i -g mintlify); bump this when that materially changes. Keep in
# sync with the payments-py sibling.
MINTLIFY_VERSION="${MINTLIFY_VERSION:-4.2.629}"

if [ ! -d "$MARKDOWN_DIR" ]; then
  echo "Error: markdown directory not found at $MARKDOWN_DIR" >&2
  exit 1
fi

# Resolve a runnable, pinned mintlify. Use the globally-installed CLI when it
# already matches the pin; otherwise fall back to a pinned npx invocation.
if command -v mintlify >/dev/null 2>&1 \
   && [ "$(mintlify --version 2>/dev/null)" = "$MINTLIFY_VERSION" ]; then
  MINTLIFY=(mintlify)
else
  MINTLIFY=(npx --yes "mintlify@$MINTLIFY_VERSION")
fi

STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

# Replicate the release.yml sync transform: flat copy markdown/*.md into
# docs/api-reference/typescript/, dropping README.md.
TS_DIR="$STAGE_DIR/docs/api-reference/typescript"
mkdir -p "$TS_DIR"
cp "$MARKDOWN_DIR"/*.md "$TS_DIR/"
rm -f "$TS_DIR/README.md"

# Minimal docs.json listing every staged page so Mintlify can resolve the
# nav-relative internal links between them (matches the docs repo's
# api-reference/typescript/<name> entries).
PAGES_JSON="$(
  cd "$TS_DIR" &&
  for f in *.md; do printf '"api-reference/typescript/%s",' "${f%.md}"; done |
  sed 's/,$//'
)"

cat > "$STAGE_DIR/docs.json" <<JSON
{
  "\$schema": "https://mintlify.com/docs.json",
  "name": "payments-docs-linkcheck",
  "theme": "mint",
  "colors": { "primary": "#000000" },
  "navigation": {
    "pages": [ ${PAGES_JSON} ]
  }
}
JSON

echo "Staged $(find "$TS_DIR" -name '*.md' | wc -l) page(s) into $TS_DIR"
echo "Running mintlify@$MINTLIFY_VERSION broken-links (internal links only) …"
echo ""

cd "$STAGE_DIR"
# Exits non-zero when it finds broken internal links.
"${MINTLIFY[@]}" broken-links
