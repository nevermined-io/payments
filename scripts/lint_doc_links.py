#!/usr/bin/env python3
"""Deterministic, network-free escaping-link lint for ``markdown/**``.

TypeScript sibling of payments-py's ``scripts/lint_doc_links.py`` (same intent;
here the docs sync is a verbatim flat copy of ``markdown/*.md`` into the docs
site at ``docs/api-reference/typescript/``, so there is no converter mapping —
the valid same-dir page slugs are derived from ``markdown/**`` itself).

A link that resolves fine inside this repo can be dead once these files are
synced to the docs site, because the synced tree has no parent directories and
no repo source. This class broke the docs-site sync once (nevermined-io/docs#234,
the Python sibling's v1.15.0 sync of ``a2a-module.mdx``).

A markdown link in ``markdown/**`` is a VIOLATION when its destination is a
repo-relative path that would not resolve on the site:

  - escaping relative links: ``](../foo)`` (any path that leaves the synced dir)
  - links to repo source / non-page targets: ``](src/foo.ts)``, ``](foo.json)``
  - same-dir links to a name that is not another synced page

It is NOT a violation (always fine) when the destination is:

  - a same-dir sibling page: ``](./agents)``, ``](agents)``, ``](agents.md)``
  - an in-page anchor: ``](#section)``
  - a site-relative path: ``](/api-reference/cli)``
  - an absolute URL: ``](https://…)``, ``](mailto:…)``  (this is the recommended
    way to link repo source — see CONTRIBUTING.md)

Runs in milliseconds, never hits the network, never flakes — the first and
always-on hard gate.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

MARKDOWN_DIR = Path(__file__).resolve().parent.parent / "markdown"

# Inline markdown link: [text](destination). Captures the raw destination,
# which may carry an optional "title" we discard.
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")

# Fenced code blocks open/close with ``` or ~~~ (optionally indented). Links
# inside fences are code samples, not navigation — skip them.
FENCE_RE = re.compile(r"^\s*(```|~~~)")

# Destinations that are NOT repo-relative and therefore always fine.
NON_RELATIVE_PREFIXES = ("/", "#", "http://", "https://", "mailto:", "tel:")


def synced_page_slugs() -> set[str]:
    """Slugs of pages that exist on the site (every markdown/*.md but README).

    The release sync copies markdown/*.md verbatim and drops README.md, so a
    same-dir link is valid iff it targets one of these slugs (with or without a
    .md extension).
    """
    return {
        p.stem
        for p in MARKDOWN_DIR.glob("*.md")
        if p.name.lower() != "readme.md"
    }


def is_violation(destination: str, page_slugs: set[str]) -> bool:
    """Return True if a link destination would be dead on the docs site."""
    # Drop an optional link title: [x](path "Title") -> "path".
    parts = destination.strip().split()
    if not parts:  # whitespace-only destination — not a real link, ignore.
        return False
    target = parts[0]

    if target.startswith(NON_RELATIVE_PREFIXES):
        return False

    # Normalise: strip a single leading "./" and any "#anchor" fragment.
    if target.startswith("./"):
        target = target[2:]
    target = target.split("#", 1)[0]

    if not target:  # was a bare "#anchor" — same-page link, fine.
        return False

    # Anything with a path separator escapes the flat synced dir (../, src/, …).
    if "/" in target:
        return True

    # Same-dir link: valid iff it names another synced page (slug, with or
    # without a .md extension). Anything else (e.g. a .ts file, a typo) is dead.
    slug = target[:-3] if target.endswith(".md") else target
    return slug not in page_slugs


def check_file(path: Path, page_slugs: set[str]) -> list[tuple[int, str]]:
    """Return [(line_number, destination), ...] for each violating link."""
    violations: list[tuple[int, str]] = []
    in_fence = False
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for match in LINK_RE.finditer(line):
            destination = match.group(1)
            if is_violation(destination, page_slugs):
                violations.append((lineno, destination.strip().split()[0]))
    return violations


def main() -> int:
    if not MARKDOWN_DIR.is_dir():
        print(f"Error: markdown directory not found at {MARKDOWN_DIR}", file=sys.stderr)
        return 1

    page_slugs = synced_page_slugs()

    # README.md is dropped during sync, so it is exempt from the synced-tree rules.
    files = sorted(p for p in MARKDOWN_DIR.glob("*.md") if p.name.lower() != "readme.md")

    # Fail closed: a zero-file pass would be a silent green (e.g. the dir was
    # moved/renamed). The synced set is non-empty by construction.
    if not files:
        print(f"Error: no markdown pages found to lint in {MARKDOWN_DIR}", file=sys.stderr)
        return 1

    violations: list[tuple[Path, int, str]] = []
    for path in files:
        for lineno, dest in check_file(path, page_slugs):
            violations.append((path, lineno, dest))

    if violations:
        rel_root = MARKDOWN_DIR.parent
        for path, lineno, dest in violations:
            print(f"  ✗ {path.relative_to(rel_root)}:{lineno} — dead-on-site link: {dest}")
        print(
            f"\n✗ Found {len(violations)} escaping/repo-source link(s) in markdown/**.\n\n"
            "Synced docs (markdown/**) are copied verbatim to the docs site under\n"
            "  docs/api-reference/typescript/. Relative links that escape that directory\n"
            "  (../…), point at repo source (.ts, src/, …), or name a non-page resolve\n"
            "  in-repo but are dead on the site. Use a same-dir sibling link (./other-page),\n"
            "  a site-relative path, or an absolute https://github.com/… URL instead.\n"
            "  See CONTRIBUTING.md → \"Documentation link conventions\".",
            file=sys.stderr,
        )
        return 1

    print(f"✓ markdown/** ({len(files)} pages) has no escaping or repo-source links.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
