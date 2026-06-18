#!/usr/bin/env bash
#
# check_synced_doc_links.sh — replicate the docs-site sync, then run the real
# Mintlify link checker against the staged site.
# (TypeScript sibling of payments-py's scripts/check_synced_doc_links.sh — same
#  intent and structure; here the sync is a verbatim flat copy, not an mdx
#  conversion.)
#
# Why staged against the real site, not in-repo: the release pipeline
# (release.yml, publish-documentation job) copies markdown/*.md (except
# README.md) VERBATIM into the docs site at docs/api-reference/typescript/. A
# plain in-repo link check would PASS and miss site-only breakage, because
# relative links resolve differently once the files live under
# api-reference/typescript/ (this class broke nevermined-io/docs#234).
#
# We clone the real (public) nevermined-io/docs, drop the staged TS pages into
# docs/api-reference/typescript/, and run `mintlify broken-links` on the WHOLE
# site (matching the sibling) so that any site-relative links these pages might
# use in the future still resolve against the rest of the site.
#
# Hard-gates INTERNAL links only: `mintlify broken-links` checks internal links
# by default and only pings external URLs with --check-external (NOT passed —
# external liveness is network-flaky and must not block a release).
#
# Env knobs (all optional):
#   DOCS_REPO        default nevermined-io/docs
#   DOCS_REF         default main
#   MINTLIFY_VERSION default 4.2.629 (pin; the docs repo tracks latest)
#   DOCS_CHECKOUT    pre-cloned docs repo to reuse instead of cloning
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKDOWN_DIR="$PROJECT_ROOT/markdown"

DOCS_REPO="${DOCS_REPO:-nevermined-io/docs}"
DOCS_REF="${DOCS_REF:-main}"
# Pin Mintlify for reproducibility. The docs repo itself installs floating
# latest (npm i -g mintlify); bump this when that materially changes. Keep in
# sync with the payments-py sibling.
MINTLIFY_VERSION="${MINTLIFY_VERSION:-4.2.629}"

if [ ! -d "$MARKDOWN_DIR" ]; then
  echo "Error: markdown directory not found at $MARKDOWN_DIR" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

# 1. Obtain the docs site (clone the public repo, or reuse a provided checkout).
if [ -n "${DOCS_CHECKOUT:-}" ]; then
  echo "Reusing docs checkout at $DOCS_CHECKOUT"
  DOCS_DIR="$WORK_DIR/docs-site"
  cp -r "$DOCS_CHECKOUT" "$DOCS_DIR"
else
  DOCS_DIR="$WORK_DIR/docs-site"
  echo "Cloning $DOCS_REPO@$DOCS_REF (shallow) …"
  git clone --depth 1 --branch "$DOCS_REF" \
    "https://github.com/$DOCS_REPO.git" "$DOCS_DIR"
fi

TARGET_DIR="$DOCS_DIR/docs/api-reference/typescript"
if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: $DOCS_REPO has no docs/api-reference/typescript — site layout changed?" >&2
  exit 1
fi

# 2. Replicate the release.yml sync transform: flat copy markdown/*.md into
#    docs/api-reference/typescript/, dropping README.md. Other sections stay so
#    site-relative links resolve.
rm -f "$TARGET_DIR"/*.md
cp "$MARKDOWN_DIR"/*.md "$TARGET_DIR/"
rm -f "$TARGET_DIR/README.md"
echo "Staged $(find "$TARGET_DIR" -name '*.md' | wc -l) TypeScript page(s) into the site."

# 3. Resolve a runnable, pinned mintlify. CI uses the globally-installed CLI when
#    it already matches the pin; otherwise fall back to a pinned npx invocation.
if command -v mintlify >/dev/null 2>&1 \
   && [ "$(mintlify --version 2>/dev/null)" = "$MINTLIFY_VERSION" ]; then
  MINTLIFY=(mintlify)
else
  MINTLIFY=(npx --yes "mintlify@$MINTLIFY_VERSION")
fi

echo "Running mintlify@$MINTLIFY_VERSION broken-links (internal links only) on the staged site …"
echo ""
cd "$DOCS_DIR"
# Exits non-zero when it finds broken internal links.
"${MINTLIFY[@]}" broken-links
