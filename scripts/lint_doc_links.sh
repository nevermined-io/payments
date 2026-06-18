#!/usr/bin/env bash
#
# lint_doc_links.sh — cheap, deterministic, network-free escaping-link lint.
# (TypeScript sibling of payments-py's scripts/lint_doc_links.py — same intent,
#  mirrored gate; here the sync is a verbatim flat copy so there is no converter
#  mapping to drive off, the rules are encoded directly.)
#
# The release pipeline (release.yml, publish-documentation job) syncs
# markdown/*.md (except README.md) VERBATIM into the docs site at
# docs/api-reference/typescript/<name>.md. A link that resolves fine *inside this
# repo* — e.g. `](../../src/foo.ts)` — is dead once synced, because the synced
# tree has no parent dirs and no source files. This class broke the docs-site
# sync once (nevermined-io/docs#234, the Python sibling's v1.15.0 PR).
#
# This lint rejects exactly that class:
#   - escaping relative links: `](../...)`  (one or more `../`)
#   - links to repo source: targets ending in code/source extensions
#     (.ts/.tsx/.js/.mjs/.cjs/.json/.py/.yml/.yaml/.lock) or pointing into
#     known repo dirs (src/, cli/, openclaw/, tests/, scripts/).
#
# It intentionally ALLOWS:
#   - same-dir sibling links `](./other-page)` — these resolve on the site
#   - in-page anchors `](#section)`
#   - absolute external URLs `](https://…)` / `](http://…)` / `](mailto:…)`
#
# Runs in milliseconds, never hits the network, never flakes — the first and
# always-on hard gate (see CONTRIBUTING.md → "Documentation link conventions").
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKDOWN_DIR="$PROJECT_ROOT/markdown"

if [ ! -d "$MARKDOWN_DIR" ]; then
  echo "Error: markdown directory not found at $MARKDOWN_DIR" >&2
  exit 1
fi

# Markdown link targets that point at repo source rather than a synced page.
# (case-insensitive match against the inline-link destination)
SOURCE_LINK_RE='\]\((\.{1,2}/)*(src|cli|openclaw|tests|scripts)/|\]\([^)]*\.(ts|tsx|js|mjs|cjs|json|py|yml|yaml|lock)([)#?])'

# Escaping relative links: one or more `../` after the opening `](`.
ESCAPING_LINK_RE='\]\(\.\./'

violations=0

# README.md is dropped during sync, so it is exempt from the synced-tree rules.
while IFS= read -r -d '' file; do
  rel="${file#"$PROJECT_ROOT"/}"

  while IFS=: read -r lineno line; do
    [ -n "$lineno" ] || continue
    echo "  ✗ $rel:$lineno — escaping relative link (../) is dead once synced to the docs site"
    echo "      $line"
    violations=$((violations + 1))
  done < <(grep -nE "$ESCAPING_LINK_RE" "$file" || true)

  while IFS=: read -r lineno line; do
    [ -n "$lineno" ] || continue
    echo "  ✗ $rel:$lineno — link points at repo source (won't exist on the docs site)"
    echo "      $line"
    violations=$((violations + 1))
  done < <(grep -niE "$SOURCE_LINK_RE" "$file" || true)
done < <(find "$MARKDOWN_DIR" -name '*.md' ! -name 'README.md' -print0)

if [ "$violations" -gt 0 ]; then
  echo ""
  echo "✗ Found $violations escaping/source link(s) in markdown/**."
  echo ""
  echo "Synced docs (markdown/**) are copied verbatim to the docs site under"
  echo "  docs/api-reference/typescript/. Relative links that escape that directory"
  echo "  (../…) or point at repo source (.ts, src/, …) resolve in-repo but are dead"
  echo "  on the site. Use a same-dir sibling link (./other-page), a site-relative"
  echo "  path, or an absolute https://github.com/… URL instead."
  echo "  See CONTRIBUTING.md → \"Documentation link conventions\"."
  exit 1
fi

echo "✓ markdown/** has no escaping or repo-source links."
