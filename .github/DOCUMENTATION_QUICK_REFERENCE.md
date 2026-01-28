# Documentation Quick Reference

Quick reference for the Nevermined Payments SDK documentation automation.

## 📁 Documentation Files

```
markdown/
├── installation.mdx                   # Setup guide
├── initializing-the-library.mdx      # Getting started
├── payment-plans.mdx                 # Plans API
├── agents.mdx                        # Agents API
├── publishing-static-resources.mdx   # Static content
├── payments-and-balance.mdx          # Payments
├── querying-an-agent.mdx             # X402 tokens
├── validation-of-requests.mdx        # Validation
├── mcp-integration.mdx               # MCP protocol
├── a2a-integration.mdx               # A2A protocol
└── x402.mdx                          # X402 spec
```

## 🤖 Automated Workflows

### Update Documentation (Push)

**Triggers on**: Push to `main`/`develop` when source files change

```bash
# Automatic
git push origin main

# Manual
gh workflow run update-docs.yml
```

**What it does**:
- ✅ Validates all documentation files
- ✅ Updates version metadata
- ✅ Commits changes (with [skip ci])

### Publish Documentation (Tag)

**Triggers on**: Creating a version tag

```bash
# Automatic (publishes to main branch)
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2

# Manual - main branch (production)
gh workflow run publish-docs.yml -f version=v1.0.2

# Manual - preview branch (testing)
gh workflow run publish-docs.yml -f version=v1.0.2 -f target_branch=preview

# Manual - using script
./scripts/publish-docs.sh
```

**What it does**:
- ✅ Copies docs to docs_mintlify repo
- ✅ Creates pull request
- ✅ Adds version metadata

## 🛠️ Manual Commands

### Validate Documentation

```bash
./scripts/generate-docs.sh
```

Checks:
- ✓ All 11 files exist
- ✓ Source files present
- ✓ Version metadata current

### Publish Documentation

```bash
./scripts/publish-docs.sh
```

Options:
1. Trigger GitHub Actions (recommended)
2. Manual local publication

### Check Workflow Status

```bash
# List recent runs
gh run list

# View specific workflow
gh run list --workflow=update-docs.yml
gh run list --workflow=publish-docs.yml

# View logs
gh run view <run-id> --log

# Watch running workflow
gh run watch
```

## 🔑 Required Secrets

### DOCS_REPO_TOKEN

**Purpose**: Publish documentation to docs_mintlify repository

**Permissions**:
- Repository: `nevermined-io/docs_mintlify`
- Contents: Read and write
- Pull requests: Read and write

**Setup**:
1. GitHub Settings → Developer settings → Personal access tokens
2. Create fine-grained token with above permissions
3. Add to repository: Settings → Secrets → Actions → `DOCS_REPO_TOKEN`

## 🚀 Release Process

### Standard Release

```bash
# 1. Update version
npm version patch  # or minor, major

# 2. Commit
git add package.json
git commit -m "chore: release v1.0.2"
git push

# 3. Tag (triggers publication)
git tag -a v1.0.2 -m "Release v1.0.2"
git push origin v1.0.2

# 4. Wait for workflows
gh run watch

# 5. Merge PR in docs_mintlify
```

### Manual Publication

```bash
# Option 1: GitHub Actions
gh workflow run publish-docs.yml -f version=v1.0.2

# Option 2: Helper script
./scripts/publish-docs.sh

# Option 3: Manual copy
cd ../docs_mintlify
git checkout -b update-typescript-docs-v1.0.2
cp ../payments/markdown/*.mdx docs/api-reference/typescript/
git add . && git commit -m "docs: update TypeScript SDK v1.0.2"
gh pr create
```

## 🔍 Troubleshooting

### Documentation Not Updated

```bash
# Check workflow runs
gh run list --workflow=update-docs.yml

# View logs
gh run view --workflow=update-docs.yml --log

# Manually trigger
gh workflow run update-docs.yml
```

### Publication Failed

```bash
# Check publish runs
gh run list --workflow=publish-docs.yml

# View logs
gh run view --workflow=publish-docs.yml --log

# Validate docs
./scripts/generate-docs.sh

# Re-trigger
gh workflow run publish-docs.yml -f version=v1.0.2
```

### Token Issues

```bash
# Check token expiration
gh api user  # Should work with valid token

# Regenerate token
# GitHub → Settings → Developer settings → Personal access tokens
# Update: Repository → Settings → Secrets → DOCS_REPO_TOKEN
```

### Missing Files

```bash
# Check markdown directory
ls -la markdown/*.mdx

# Should show 11 files
# If missing, regenerate with Claude Code
```

## 📊 Monitoring

### GitHub Actions UI

```
Repository → Actions
```

### Status Badges

Add to README:

```markdown
![Update Docs](https://github.com/nevermined-io/payments/actions/workflows/update-docs.yml/badge.svg)
![Publish Docs](https://github.com/nevermined-io/payments/actions/workflows/publish-docs.yml/badge.svg)
```

### Notifications

```
Settings → Notifications → Actions → Enable workflow notifications
```

## 📚 Resources

- **Full Guide**: [DOCUMENTATION.md](../DOCUMENTATION.md)
- **Markdown README**: [markdown/README.md](../markdown/README.md)
- **Workflows README**: [.github/workflows/README.md](workflows/README.md)
- **Docs Repository**: https://github.com/nevermined-io/docs_mintlify

## ⚡ Quick Tips

- **Always validate** before pushing: `./scripts/generate-docs.sh`
- **Use annotated tags**: `git tag -a v1.0.2 -m "Release v1.0.2"`
- **Check workflow status**: `gh run watch` after push/tag
- **Review PRs** in docs_mintlify before merging
- **Test locally** with `act` before pushing workflow changes

## 🔄 Workflow Files

| File | Purpose | Trigger |
|------|---------|---------|
| `update-docs.yml` | Update doc metadata | Push to main/develop |
| `publish-docs.yml` | Publish to docs repo | Tag push (v*.*.*) |

## 📝 Documentation Standards

- ✅ TypeScript code examples only
- ✅ Source examples from tests/
- ✅ Include clear explanations
- ✅ Link to related docs
- ✅ Add source references
- ✅ Use consistent formatting

## ⏱️ Typical Workflow Times

| Operation | Duration |
|-----------|----------|
| Update docs workflow | 2-3 minutes |
| Publish docs workflow | 3-5 minutes |
| PR review & merge | Manual |
| Mintlify build | 2-3 minutes |
| Total (tag → published) | ~10-15 minutes |
