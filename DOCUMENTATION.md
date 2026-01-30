# Documentation Automation Guide

This guide explains the automated documentation system for the Nevermined Payments SDK.

## Overview

The documentation system consists of:
- **Markdown Files**: LLM-friendly documentation in `markdown/` directory
- **Automated Updates**: GitHub Actions workflow that updates docs on push
- **Automated Publishing**: GitHub Actions workflow that publishes docs on tag
- **Manual Tools**: Scripts for local documentation management

## Documentation Structure

```
markdown/
├── installation.md
├── initializing-the-library.md
├── payment-plans.md
├── agents.md
├── publishing-static-resources.md
├── payments-and-balance.md
├── querying-an-agent.md
├── validation-of-requests.md
├── mcp-integration.md
├── a2a-integration.md
├── x402.md
└── README.md
```

## Automated Workflows

### 1. Update Documentation (on Push)

**Trigger**: Push to `main` or `develop` when source files change

**What It Does**:
- Validates all documentation files exist
- Creates a pull request with documentation updates
- Enables auto-merge for automatic merging when checks pass

**Configuration**: `.github/workflows/update-docs.yml`

**When It Runs**:
```bash
# Any push that changes these paths:
src/**                     # Source code changes
tests/**                   # Test changes (new examples)
package.json               # Version updates
MINTLIFY_API_REFERENCE.md  # Documentation spec
```

**Manual Trigger**:
```bash
# Via GitHub CLI
gh workflow run update-docs.yml

# Via GitHub UI
Actions → Update Documentation → Run workflow
```

### 2. Publish Documentation (on Tag)

**Trigger**: Creating a new version tag (e.g., `v1.0.2`)

**What It Does**:
- Copies all `.md` files from `markdown/` to `docs_mintlify` repository
- Creates a pull request in the docs repository
- Enables auto-merge for automatic merging when checks pass
- Includes version info, change summary, and automated labels

**Configuration**: `.github/workflows/publish-docs.yml`

**When It Runs**:
```bash
# Create and push a version tag
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2
```

**Manual Trigger**:
```bash
# Via GitHub CLI
gh workflow run publish-docs.yml -f version=v1.0.2

# Via script
./scripts/publish-docs.sh
```

## Manual Documentation Management

### Validate Documentation

Check that all documentation files are present and valid:

```bash
./scripts/generate-docs.sh
```

This script:
- Verifies all 11 `.md` files exist
- Checks source files are present
- Adds/updates version metadata
- Reports any issues

### Publish Documentation

Manually publish documentation to the docs repository:

```bash
./scripts/publish-docs.sh
```

This script provides two options:
1. **Trigger GitHub Actions** (recommended) - Uses the automated workflow
2. **Manual Publication** - Clones docs repo and creates PR locally

## Setting Up GitHub Secrets

For the automation to work, you need to configure GitHub secrets:

### Navigate to Repository Settings

```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

### Add Required Secrets

```bash
# For documentation publishing
DOCS_REPO_TOKEN=<github-personal-access-token>
```

### Creating DOCS_REPO_TOKEN

1. Go to GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Create new token with:
   - **Repository access**: Only `nevermined-io/docs_mintlify`
   - **Permissions**:
     - Contents: Read and write
     - Pull requests: Read and write
3. Copy token and add as `DOCS_REPO_TOKEN` secret

## Release Process

### Standard Release (Automated)

```bash
# 1. Update version in package.json
npm version patch  # or minor, major

# 2. Commit and push
git add package.json
git commit -m "chore: release v1.0.2"
git push origin main

# 3. Create and push tag (triggers publication)
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2

# 4. GitHub Actions will:
#    - Update docs metadata (update-docs workflow)
#    - Publish to docs_mintlify (publish-docs workflow)
#    - Create PR in docs repository

# 5. Review and merge the PR in docs_mintlify
```

### Manual Release (No Tag)

If you want to publish documentation without creating a tag:

```bash
# Option 1: Trigger workflow manually (to main branch)
gh workflow run publish-docs.yml -f version=v1.0.2

# Option 2: Trigger workflow to test/preview branch (for testing)
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=preview

# Option 3: Use publish script
./scripts/publish-docs.sh
# Select option 1 or 2
```

### Testing Documentation Before Production

To preview documentation in Mintlify before publishing to production:

```bash
# 1. Create a preview branch in docs_mintlify (if it doesn't exist)
cd ../docs_mintlify
git checkout -b preview
git push origin preview

# 2. Publish documentation to preview branch
cd ../payments
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=preview

# 3. Review PR in docs_mintlify targeting preview branch

# 4. Merge PR and check Mintlify preview deployment

# 5. If satisfied, publish to main branch
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=main
```

## Full Documentation Regeneration

When you need to completely regenerate the documentation (rare):

1. **Review Specification**
   ```bash
   cat MINTLIFY_API_REFERENCE.md
   ```

2. **Use Claude Code**
   ```
   Ask Claude Code:
   "Regenerate all markdown documentation following the specification
   in MINTLIFY_API_REFERENCE.md. Use tested code examples from the
   tests/ directory."
   ```

3. **Validate Changes**
   ```bash
   ./scripts/generate-docs.sh
   git diff markdown/
   ```

4. **Commit Changes**
   ```bash
   git add markdown/
   git commit -m "docs: regenerate markdown documentation"
   git push
   ```

## Troubleshooting

### Documentation Not Updated After Push

**Problem**: Pushed code changes but docs weren't updated

**Check**:
```bash
# View recent workflow runs
gh run list --workflow=update-docs.yml

# View specific run logs
gh run view <run-id> --log
```

**Common Causes**:
- Commit message contains `[skip ci]`
- Changes not in watched paths (`src/`, `tests/`, etc.)
- Workflow file has syntax errors

### Documentation Publishing Failed

**Problem**: Tagged release but PR wasn't created in docs repository

**Check**:
```bash
# View publish workflow runs
gh run list --workflow=publish-docs.yml

# View specific run logs
gh run view <run-id> --log
```

**Common Causes**:
- `DOCS_REPO_TOKEN` is invalid or expired
- Documentation files are missing or invalid
- Target repository structure changed
- Network issues during checkout

**Solution**:
```bash
# Validate docs locally
./scripts/generate-docs.sh

# Re-trigger workflow
gh workflow run publish-docs.yml -f version=v1.0.2

# Or publish manually
./scripts/publish-docs.sh
```

### Pull Request Not Created

**Problem**: Workflow succeeded but no PR in docs repository

**Check**:
1. DOCS_REPO_TOKEN has PR creation permissions
2. No existing PR for the same branch exists
3. No merge conflicts in target repository

**Solution**:
```bash
# Check PRs in docs repository
gh pr list --repo nevermined-io/docs_mintlify

# If branch exists but no PR, create manually
cd ../docs_mintlify
gh pr create --title "docs: Update TypeScript SDK Documentation (v1.0.2)"
```

### Version Metadata Incorrect

**Problem**: Documentation shows wrong version number

**Solution**:
```bash
# Update version in package.json
npm version <new-version>

# Run validation script
./scripts/generate-docs.sh

# Commit changes
git add package.json markdown/
git commit -m "chore: update version to <new-version>"
git push
```

## Documentation Guidelines

### When to Update Documentation

Update documentation when:
- ✅ Adding new API methods or classes
- ✅ Changing method signatures
- ✅ Adding new integration patterns (MCP, A2A, etc.)
- ✅ Updating examples in tests
- ✅ Fixing bugs that affect API usage
- ✅ Major version releases

Don't update for:
- ❌ Internal refactoring (no API changes)
- ❌ Test-only changes
- ❌ Documentation typo fixes (edit markdown directly)

### Documentation Quality Standards

All documentation must:
- ✅ Use TypeScript code examples
- ✅ Source examples from working tests
- ✅ Include clear, simple explanations
- ✅ Follow consistent formatting
- ✅ Link to related documentation
- ✅ Include source references

### Code Example Requirements

Every code example should:
- Be complete and runnable
- Use environment variables for sensitive data
- Include necessary imports
- Show expected output or next steps
- Follow the project's coding style

## Monitoring Workflows

### GitHub Actions Dashboard

View all workflow runs:
```
Repository → Actions tab
```

### Via GitHub CLI

```bash
# List recent runs
gh run list

# View specific workflow
gh run list --workflow=update-docs.yml
gh run list --workflow=publish-docs.yml

# View logs for a run
gh run view <run-id> --log

# Watch a running workflow
gh run watch <run-id>
```

### Notifications

Configure GitHub notifications for workflow failures:
```
Settings → Notifications → Actions → Enable workflow notifications
```

## FAQ

### Q: How often does documentation update?

**A**: Automatically on every push to `main`/`develop` that changes source files. The workflow typically runs in 2-3 minutes.

### Q: Can I publish docs without tagging?

**A**: Yes, use the manual trigger:
```bash
gh workflow run publish-docs.yml -f version=v1.0.2
```

### Q: What if I need to unpublish documentation?

**A**: Close the PR in the docs repository or revert the merge commit. Documentation updates are not automatically deleted.

### Q: How do I test workflow changes?

**A**: Use [act](https://github.com/nektos/act) to run workflows locally:
```bash
brew install act
act push -W .github/workflows/update-docs.yml
```

### Q: Can I customize the PR template?

**A**: Yes, edit the `body` section in `.github/workflows/publish-docs.yml` under the "Create Pull Request" step.

### Q: What happens if two releases are published simultaneously?

**A**: Each release creates a separate branch and PR. Both can coexist and be merged independently.

## Resources

- **GitHub Actions**: https://docs.github.com/en/actions
- **Mintlify Documentation**: https://mintlify.com/docs
- **Nevermined Docs**: https://github.com/nevermined-io/docs_mintlify
- **Workflow README**: `.github/workflows/README.md`
- **Documentation README**: `markdown/README.md`
