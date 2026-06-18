# Contributing to @nevermined-io/payments

Thanks for contributing to the Nevermined Payments TypeScript SDK. This guide
covers conventions that CI enforces; see [`CLAUDE.md`](./CLAUDE.md) for the full
development workflow (build, lint, tests, releases) and
[`ARCHITECTURE.md`](./ARCHITECTURE.md) for design details.

## Quick start

```bash
pnpm install
pnpm build && pnpm lint && pnpm test:unit   # the pre-PR check
```

## Documentation

User-facing SDK docs are hand-written under [`markdown/`](./markdown/). On
release, the `publish-documentation` job in
[`.github/workflows/release.yml`](./.github/workflows/release.yml) copies them
**verbatim** into the docs site (`nevermined-io/docs`) at
`docs/api-reference/typescript/<name>`, and opens a PR there.

When you change a public API, update the matching file in `markdown/` (see
[`markdown/README.md`](./markdown/README.md) for which files map to which APIs)
and validate with `./scripts/generate-docs.sh`.

### Documentation link conventions

Because these files are **copied verbatim and republished on the docs site**, a
relative link that resolves fine inside this repo can be **dead on the site** —
the synced tree has no parent directories and no repo source. This exact class of
link once broke a docs-site sync PR (`nevermined-io/docs#234`, the Python
sibling's v1.15.0 sync of `../../payments_py/x402/README.md`).

In `markdown/**`, use only:

- ✅ **Same-directory sibling links** to other synced pages, no extension —
  `[Payment Plans](./payment-plans)`. These resolve on the site, where every
  page lives in the same `api-reference/typescript/` directory.
- ✅ **Site-relative links** to other docs-site pages —
  `[CLI](/api-reference/cli)`.
- ✅ **In-page anchors** — `[Reuse a delegation](#reusing-existing-delegations)`.
- ✅ **Absolute GitHub URLs** for anything in the repo (source, tests, READMEs,
  other directories) —
  `[token.ts](https://github.com/nevermined-io/payments/blob/main/src/x402/token.ts)`.
- ❌ **Escaping relative links** (`](../…)`) and **links to repo source**
  (`.ts`, `src/`, `cli/`, `tests/`, …) — these resolve in-repo but 404 on the
  site. CI rejects them.

### Link checks

Two gates run in CI
([`.github/workflows/docs-link-check.yml`](./.github/workflows/docs-link-check.yml))
on changes to `markdown/**`, plus a release-time backstop in `release.yml`.
Reproduce them locally:

```bash
# Fast, network-free lint — rejects escaping (../) / repo-source links.
# Hard gate; runs in milliseconds, never flakes.
pnpm docs:lint-links

# Full check — clones the docs site, stages the synced files into it, and runs
# the same `mintlify broken-links` the docs repo uses (internal links only),
# failing only on breakage sourced from these pages. Needs network + Node/npx.
pnpm docs:check-links
```

Both are blocking gates. The lint is deterministic and never flakes; the staged
Mintlify check fails only on broken links sourced from the synced pages
(`docs/api-reference/typescript/`), so pre-existing site breakage never fails it.
The release pipeline runs the staged check as its own backstop. Only **internal**
links are gated; external-URL liveness is not (it is network-flaky).
