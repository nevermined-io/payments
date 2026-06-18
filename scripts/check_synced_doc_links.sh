#!/usr/bin/env bash
#
# check_synced_doc_links.sh — replicate the docs-site sync, then run the real
# Mintlify link checker against the staged site.
# (TypeScript sibling of payments-py's scripts/check_synced_doc_links.sh — same
#  intent, same whole-site-clone + scoped-parse approach; here the sync is a
#  verbatim flat copy of *.md, not an mdx conversion.)
#
# Why staged against the real site, not in-repo: the release pipeline
# (release.yml, publish-documentation job) copies markdown/*.md (except
# README.md) VERBATIM into the docs site at docs/api-reference/typescript/. A
# plain in-repo link check would PASS and miss site-only breakage, because
# relative links resolve differently once the files live under
# api-reference/typescript/ (this class broke nevermined-io/docs#234).
#
# Why the WHOLE site (mirroring the payments-py sibling): staging against the
# real site keeps both SDK gates consistent and is robust if a TS page ever adds
# a cross-section site-relative link (`/docs/...`) — those resolve only against
# the whole site, where a self-contained mini-site would false-positive.
#
# Hard-gates INTERNAL links only: `mintlify broken-links` checks internal links
# by default and only pings external URLs with --check-external (NOT passed —
# external liveness is network-flaky and must not block a release).
#
# Scoped to OUR breakage: the whole site may carry pre-existing broken links we
# don't own. We replace ALL typescript pages with the freshly-synced ones, so
# any broken link whose SOURCE file is under docs/api-reference/typescript/ is
# breakage introduced by these staged pages. We parse the checker output and
# fail ONLY on typescript-sourced broken links — pre-existing breakage elsewhere
# on the site does not fail this gate. (See the scoped-parse step at the end.)
#
# Env knobs (all optional):
#   DOCS_REPO        default nevermined-io/docs
#   DOCS_REF         default main
#   MINTLIFY_VERSION default 4.2.629 (pin; the docs repo tracks latest)
#   DOCS_CHECKOUT    pre-cloned docs repo to reuse instead of cloning
#   SCOPE_PREFIX     site path whose broken links we own (default the TS tree)
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
# Broken links whose source file starts with this site path are ours to fix.
SCOPE_PREFIX="${SCOPE_PREFIX:-docs/api-reference/typescript/}"

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

# Fail closed: `mintlify broken-links` no-ops to a green "no broken links found"
# when run outside a Mintlify project (no docs.json/mint.json at the site root).
# Assert the config exists so a moved/renamed config can't silently pass the gate.
if [ ! -f "$DOCS_DIR/docs.json" ] && [ ! -f "$DOCS_DIR/mint.json" ]; then
  echo "Error: no docs.json/mint.json at $DOCS_DIR root — not a Mintlify project; broken-links would no-op green." >&2
  exit 1
fi

# 2. Replicate the release.yml sync transform: flat copy markdown/*.md into
#    docs/api-reference/typescript/, dropping README.md. Other sections stay so
#    any site-relative links resolve.
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

# Capture the full report (strip ANSI/spinner CRs; normalise the U+00A0
# non-breaking spaces mintlify pads each broken-link line with, so the parser
# matches on plain spaces rather than relying on \s also covering U+00A0), then
# scope to our pages. Do not let mintlify's own non-zero exit abort the script —
# we decide pass/fail from the SCOPED parse, since pre-existing site breakage
# must not fail us.
REPORT="$WORK_DIR/broken-links.txt"
set +e
"${MINTLIFY[@]}" broken-links 2>&1 \
  | sed 's/\x1b\[[0-9;]*[A-Za-z]//g' \
  | tr -d '\r' \
  | sed 's/\xc2\xa0/ /g' > "$REPORT"
set -e

cat "$REPORT"
echo ""

# Parse the report and fail ONLY on broken links sourced from our staged pages.
# Output shape (one source block per file with broken links):
#   docs/api-reference/typescript/x402.md
#    ⎿  ../../payments_py/x402/README.md
SCOPE_PREFIX="$SCOPE_PREFIX" python3 - "$REPORT" <<'PY'
import os, re, sys

prefix = os.environ["SCOPE_PREFIX"]
# A source line is a docs-site page path. The synced TS pages are .md; the rest
# of the site is .mdx — match BOTH so `total` counts every broken link (the
# false-green guard depends on it), while `scoped` filters by SCOPE_PREFIX.
source_re = re.compile(r"^(\S+\.mdx?)\s*$")
broken_re = re.compile(r"^\s*⎿\s+(.+?)\s*$")
# Header the checker prints, e.g. "found 2 broken links in 2 files".
header_re = re.compile(r"found\s+(\d+)\s+broken\s+links?\b")

reported = None  # broken-link count from the checker's own summary line
total = 0  # broken links our parser attributed to ANY source file
scoped, current = [], None
with open(sys.argv[1], encoding="utf-8") as fh:
    for line in fh:
        line = line.rstrip("\n")
        h = header_re.search(line)
        if h:
            reported = int(h.group(1))
            continue
        m = source_re.match(line)
        if m:
            current = m.group(1)
            continue
        b = broken_re.match(line)
        if b and current:
            total += 1
            if current.startswith(prefix):
                scoped.append((current, b.group(1)))

# False-green guard: the checker reported broken links but our parser attributed
# none to any source — the output format drifted (e.g. a mintlify bump changed
# the glyph/layout). Fail loudly rather than pass silently on an unparsed report.
if reported and reported > 0 and total == 0:
    print(
        "✗ mintlify reported broken links but this script parsed none — the "
        "broken-links output format has likely changed. Update the parser in "
        "scripts/check_synced_doc_links.sh (the source/⎿ line patterns).",
        file=sys.stderr,
    )
    sys.exit(2)

if scoped:
    print(f"✗ {len(scoped)} broken internal link(s) introduced by the staged "
          f"pages ({prefix}):")
    for src, target in scoped:
        print(f"  {src} -> {target}")
    print("\nThese links resolve in-repo but are dead on the docs site. Use a "
          "same-dir sibling link (./other-page), a site-relative /docs/... path, "
          "or an absolute https://github.com/... URL. See CONTRIBUTING.md.")
    sys.exit(1)

print(f"✓ No broken internal links sourced from the staged pages ({prefix}).")
PY
