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

### 2. `cli-sync-and-test.yml` - CLI Auto-Sync
**Trigger:** Push or PR to `main`/`develop` with SDK code changes

**Purpose:** Automatically sync CLI with SDK changes and validate

**Process:**
1. Detects SDK code changes (`src/**`, `package.json`, etc.)
2. Regenerates CLI commands from SDK API (`yarn generate`)
3. Builds CLI (`yarn build:manifest`)
4. Runs all CLI tests (unit + integration)
5. If changes detected, commits to the same branch/PR
6. Comments on PR with sync status

---

### 3. `release.yml` - Consolidated Release
**Trigger:** New version tag (`v*.*.*`)

**Purpose:** Single workflow that handles the entire release pipeline

**Jobs:**
1. **build** - Build SDK + CLI and run CLI tests (gate)
2. **publish-sdk** - Publish `@nevermined-io/payments` to npm
3. **publish-cli** - Publish `@nevermined-io/cli` to npm, pack tarballs
4. **github-release** - Create GitHub Release with SDK .tgz and CLI tarballs
5. **publish-documentation** - Create PR in docs_mintlify with SDK + CLI docs (skipped for pre-release tags like `-rc`, `-alpha`, `-beta`)

**Required Secrets:**
- `NPM_TOKEN` - npm authentication token
- `API_TOKEN_GITHUB` - Token with write access to docs repository

---

### 4. `finalize-release.yml` - Tag Creation
**Trigger:** PR merged from `release/*` branch into `main`

**Purpose:** Create and push the version tag, which triggers `release.yml`

**Process:**
1. Detects merged PR from `release/*` branch
2. Reads version from `package.json`
3. Creates and pushes `v*.*.*` tag
4. Tag push triggers `release.yml` for the full release pipeline

---

### 5. `prepare-release.yml` - Manual Release Preparation
**Trigger:** Manual dispatch

**Purpose:** Create release branch and PR with version bump

---

## Version Strategy

**Synchronized Versions:** CLI version exactly matches SDK version
- SDK: `v1.0.4` -> CLI: `v1.0.4`
- Single source of truth from git tags
- CLI version auto-updated by workflow

---

## Release Flow

```
PR merged (release/* -> main)
        |
        v
finalize-release.yml --> creates tag v*.*.*
        |
        v (tag push)
release.yml
  |-> build (test gate)
  |-> publish-sdk (npm)
  |-> publish-cli (npm + tarballs)
  |-> github-release (GH Release with artifacts)
  |-> publish-documentation (docs PR in mintlify)
```

---

## Required Repository Secrets

| Secret | Description | Used By |
|--------|-------------|---------|
| `NPM_TOKEN` | npm authentication token | `release.yml` |
| `API_TOKEN_GITHUB` | GitHub token for docs repo and tag pushing | `release.yml`, `finalize-release.yml` |
| `TEST_SUBSCRIBER_API_KEY` | Test subscriber API key | `testing.yml`, `cli-sync-and-test.yml` |
| `TEST_BUILDER_API_KEY` | Test builder API key | `testing.yml`, `cli-sync-and-test.yml` |
| `TEST_ENVIRONMENT` | Test environment name | `testing.yml` |

---

**Last Updated:** 2026-02-10
