# GitHub Actions Workflows

This directory contains automated workflows for the Nevermined Payments SDK and CLI.

## Active Workflows

### 1. `testing.yml` - SDK Testing
**Trigger:** Every push and pull request

**Purpose:** Run comprehensive tests for the Payments SDK

**Jobs:**
- `lint_build` - Lint and build the SDK
- `unit_integration` - Run unit and integration tests
- `e2e` - Run end-to-end tests

**Required Secrets:**
- `TEST_SUBSCRIBER_API_KEY` - Subscriber account API key
- `TEST_BUILDER_API_KEY` - Builder account API key
- `TEST_ENVIRONMENT` - Target environment

---

### 2. `cli-sync-and-test.yml` - CLI Auto-Sync ⭐ NEW
**Trigger:** Push or PR to `main`/`develop` with SDK code changes

**Purpose:** Automatically sync CLI with SDK changes and validate

**Process:**
1. Detects SDK code changes (`src/**`, `package.json`, etc.)
2. Regenerates CLI commands from SDK API (`yarn generate`)
3. Builds CLI (`yarn build:manifest`)
4. Runs all CLI tests (unit + integration)
5. If changes detected → commits to the same branch/PR
6. Comments on PR with sync status

**Key Features:**
- ✅ Auto-commits CLI updates to PRs
- ✅ Ensures CLI stays in sync with SDK
- ✅ Blocks merge if tests fail
- ✅ No manual intervention required

---

### 3. `cli-publish.yml` - CLI Publishing ⭐ NEW
**Trigger:** New version tag (`v*.*.*`) or manual dispatch

**Purpose:** Publish CLI to npm and update documentation

**Jobs:**
1. **publish-cli** - Builds, tests, and publishes CLI to npm
2. **update-documentation** - Updates docs in mintlify repository

**Required Secrets:**
- `NPM_TOKEN` - npm authentication token
- `API_TOKEN_GITHUB` - Token with write access to docs repository

**CLI Documentation Structure:**
```
docs/products/cli/      ← CLI docs (NEW location)
docs/api-reference/typescript/   ← SDK docs (existing)
```

---

## Version Strategy

**Synchronized Versions:** CLI version exactly matches SDK version
- SDK: `v1.0.4` → CLI: `v1.0.4`
- Single source of truth from git tags
- CLI version auto-updated by workflow

---

## Required Repository Secrets

| Secret | Description | Used By |
|--------|-------------|---------|
| `NPM_TOKEN` | npm authentication token | `release-npm.yml`, `cli-publish.yml` |
| `API_TOKEN_GITHUB` | GitHub token for docs repo | `cli-publish.yml`, `publish-docs.yml` |
| `TEST_SUBSCRIBER_API_KEY` | Test subscriber API key | `testing.yml`, `cli-sync-and-test.yml` |
| `TEST_BUILDER_API_KEY` | Test builder API key | `testing.yml`, `cli-sync-and-test.yml` |
| `TEST_ENVIRONMENT` | Test environment name | `testing.yml` |

---

**Last Updated:** 2026-02-01
