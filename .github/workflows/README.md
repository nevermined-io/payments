# GitHub Actions Workflows

This directory contains automated workflows for the Nevermined Payments SDK.

## Workflows

### 1. Testing (`testing.yml`)

**Trigger**: Push to any branch, pull requests

Runs the complete test suite:
- Linting and building
- Unit tests
- Integration tests
- End-to-end tests

**Required Secrets**:
- `TEST_SUBSCRIBER_API_KEY` - Subscriber account API key
- `TEST_BUILDER_API_KEY` - Builder account API key
- `TEST_ENVIRONMENT` - Test environment (sandbox/staging)

### 2. Update Documentation (`update-docs.yml`)

**Trigger**: Push to `main` or `develop` when source files change

Automatically updates documentation:
- Validates all markdown files exist
- Adds version metadata to each file
- Commits changes if documentation was updated

**Paths Watched**:
- `src/**` - Source code changes
- `tests/**` - Test changes (may contain new examples)
- `package.json` - Version changes
- `MINTLIFY_API_REFERENCE.md` - Documentation spec changes

**Manual Trigger**: Can be run manually with workflow_dispatch

### 3. Publish Documentation (`publish-docs.yml`)

**Trigger**: Push of version tags (e.g., `v1.0.2`)

Publishes documentation to the docs repository:
- Copies `markdown/*.md` to `nevermined-io/docs_mintlify`
- Creates a pull request with:
  - Version information
  - Change summary
  - Automated labels and reviewers

**Required Secrets**:
- `DOCS_REPO_TOKEN` - GitHub token with repo access to `nevermined-io/docs_mintlify`

**Manual Trigger**: Can be run manually by specifying:
- `version` - Version tag to publish (e.g., v1.0.2)
- `target_branch` - Target branch in docs_mintlify (default: main)

**Testing**: Use a test branch (e.g., `preview` or `test`) to preview documentation in Mintlify before merging to main

## Setting Up Secrets

### For Repository Owner

Navigate to: **Settings → Secrets and variables → Actions → New repository secret**

Add the following secrets:

```bash
# Testing secrets
TEST_SUBSCRIBER_API_KEY=<subscriber-api-key-from-nevermined.app>
TEST_BUILDER_API_KEY=<builder-api-key-from-nevermined.app>
TEST_ENVIRONMENT=sandbox

# Documentation publishing secret
DOCS_REPO_TOKEN=<github-personal-access-token>
```

### DOCS_REPO_TOKEN Setup

The `DOCS_REPO_TOKEN` requires a GitHub Personal Access Token (PAT) with the following permissions:

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create a new token with:
   - **Repository access**: Only select `nevermined-io/docs_mintlify`
   - **Permissions**:
     - Contents: Read and write
     - Pull requests: Read and write
3. Copy the token and add it as `DOCS_REPO_TOKEN` secret

Alternatively, use a classic PAT with `repo` scope.

## Workflow Behaviors

### update-docs.yml

**On Source Changes**:
```
Push → Validate docs → Create PR → Enable auto-merge
```

The workflow creates a PR to the same branch that triggered it, with auto-merge enabled. This ensures all changes go through PR review process while allowing automatic merging when checks pass.

**When to Trigger**:
- Source code changes that affect API
- New test examples added
- Documentation spec updated
- Manual version bump

**Auto-Merge**:
- PRs are created with auto-merge enabled
- Will merge automatically when all checks pass
- Requires repository settings to allow auto-merge

### publish-docs.yml

**On Tag Push**:
```
Tag created → Validate docs → Checkout docs repo → Copy files → Create PR → Enable auto-merge
```

The workflow creates a PR in the docs_mintlify repository with auto-merge enabled, allowing automatic merging when Mintlify checks pass.

**What Gets Published**:
- All 11 `.md` files from `markdown/`
- Version metadata included in files
- Copies to `docs/api-reference/typescript/` in docs_mintlify

**Auto-Merge**:
- PRs are created with auto-merge enabled in docs_mintlify
- Will merge automatically when all checks pass
- Requires docs_mintlify repository to allow auto-merge

**Manual Workflow**:
```bash
# Trigger for main branch (production)
gh workflow run publish-docs.yml -f version=v1.0.2

# Trigger for test/preview branch (testing)
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=preview

# Trigger for custom branch
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=test
```

## Troubleshooting

### Documentation Update Not Triggered

**Check**:
1. Did source files actually change?
2. Are changes in watched paths (`src/`, `tests/`, etc.)?
3. Was commit message tagged with `[skip ci]`?

**Solution**:
```bash
# Manually trigger workflow
gh workflow run update-docs.yml
```

### Publish Documentation Failed

**Common Issues**:

1. **DOCS_REPO_TOKEN invalid or expired**
   - Regenerate token with correct permissions
   - Update secret in repository settings

2. **Target directory doesn't exist**
   - Workflow creates it automatically
   - Check docs_mintlify repository structure

3. **Markdown files missing**
   - Ensure all 11 `.md` files exist in `markdown/`
   - Run `./scripts/generate-docs.sh` to validate

**Manual Debugging**:
```bash
# Check if tag exists
git tag -l "v*"

# Manually trigger for specific tag
gh workflow run publish-docs.yml -f version=v1.0.2

# Check workflow runs
gh run list --workflow=publish-docs.yml
```

### Pull Request Not Created

**Check**:
1. DOCS_REPO_TOKEN has PR permissions
2. No existing PR for the same branch
3. No merge conflicts in target repository

**Solution**:
```bash
# View workflow logs
gh run view <run-id> --log

# Check for errors in PR creation step
gh run view <run-id> --log | grep "Create Pull Request"
```

## Manual Operations

### Validate Documentation Locally

```bash
# Run validation script
./scripts/generate-docs.sh

# Check for issues
echo $?  # Should be 0 for success
```

### Test Workflows Locally

Using [act](https://github.com/nektos/act):

```bash
# Install act
brew install act  # macOS
# or download from releases

# Test update-docs workflow
act push -W .github/workflows/update-docs.yml

# Test publish-docs workflow (requires secrets)
act push -W .github/workflows/publish-docs.yml --secret-file .secrets
```

### Manual Documentation Publication

```bash
# 1. Checkout both repositories
git clone https://github.com/nevermined-io/payments.git
git clone https://github.com/nevermined-io/docs_mintlify.git

# 2. Copy files
cp payments/markdown/*.md docs_mintlify/docs/api-reference/typescript/

# 3. Create branch and PR
cd docs_mintlify
git checkout -b update-typescript-docs-v1.0.2
git add docs/api-reference/typescript/
git commit -m "docs: update TypeScript SDK documentation for v1.0.2"
git push origin update-typescript-docs-v1.0.2

# 4. Create PR via GitHub UI or CLI
gh pr create --title "docs: Update TypeScript SDK Documentation (v1.0.2)" \
  --body "Automated documentation update for SDK v1.0.2"
```

## Best Practices

1. **Tagging Releases**
   - Always tag releases with semantic versioning: `v1.0.2`
   - Create annotated tags: `git tag -a v1.0.2 -m "Release v1.0.2"`
   - Push tags: `git push origin v1.0.2`

2. **Documentation Changes**
   - Review generated PRs in docs_mintlify before merging
   - Verify all code examples are correct
   - Check internal links work

3. **Workflow Modifications**
   - Test changes locally with `act` before pushing
   - Always check workflow status after commits
   - Monitor GitHub Actions tab for failures

## Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [peter-evans/create-pull-request Action](https://github.com/peter-evans/create-pull-request)
