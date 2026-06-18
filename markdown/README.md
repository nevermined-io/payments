# Nevermined Payments SDK Documentation

This directory contains the markdown documentation for the Nevermined Payments TypeScript SDK. The documentation is automatically generated and published to the [Nevermined Documentation](https://github.com/nevermined-io/docs_mintlify) repository.

## Documentation Files

1. **installation.md** - Installation guide and prerequisites
2. **initializing-the-library.md** - Initializing the Payments instance
3. **payment-plans.md** - Payment plans, pricing, and credits
4. **agents.md** - Agent registration and management
5. **publishing-static-resources.md** - Publishing static content agents
6. **payments-and-balance.md** - Making payments and checking balances
7. **querying-an-agent.md** - Generating tokens and querying agents
8. **validation-of-requests.md** - Validating and settling permissions
9. **mcp-integration.md** - Model Context Protocol integration
10. **a2a-integration.md** - Agent-to-Agent protocol integration
11. **x402.md** - X402 payment protocol specification
12. **cli-card-setup.md** - White-labeled card enrolment + delegation for CLI / top-level integrators

## Automation Workflows

### Update Documentation (Push)

**Trigger**: Push to `main` or `develop` branches when source files change

**Workflow**: `.github/workflows/update-docs.yml`

This workflow:
- Validates existing documentation files
- Adds version metadata to each file
- Commits any changes back to the repository

### Publish Documentation (Tag)

**Trigger**: Creating a new version tag (e.g., `v1.0.2`)

**Workflow**: `.github/workflows/publish-docs.yml`

This workflow:
- Copies documentation from `markdown/` to `nevermined-io/docs_mintlify`
- Creates a pull request in the docs repository
- Includes version metadata and change summary

## Manual Documentation Update

To manually update the documentation:

```bash
# Run the validation script
./scripts/generate-docs.sh

# Review changes
git diff markdown/

# Commit changes
git add markdown/
git commit -m "docs: update documentation"
```

## Full Documentation Regeneration

For complete documentation regeneration (when adding new sections or major changes):

1. Review the documentation specification in `MINTLIFY_API_REFERENCE.md`
2. Use Claude Code to regenerate all files following the specification
3. Verify all code examples are from tested code
4. Ensure consistent formatting across all files

## Documentation Guidelines

### LLM-Friendly Principles

- **Clear Language**: Simple, concise explanations
- **Code-First**: Show working examples before explaining
- **Tested Examples**: All code from `tests/` directory
- **Progressive Structure**: Basic → Usage → Advanced
- **Consistent Format**: Every file follows the same template

### File Structure

Each file follows this structure:

```markdown
# [Title]

[2-3 sentence overview]

## [Section 1]

[Explanation]

### Example

[Code block with comments]

[Expected outcome]

## Related Documentation

- [Link to related file 1]
- [Link to related file 2]

---

**Source References**:
- `src/path/to/file.ts`
- `tests/path/to/test.ts` (lines X-Y)
```

### Code Formatting

- Always use TypeScript syntax
- Include imports explicitly
- Use environment variables for sensitive data
- Show complete, runnable examples
- Use bigint literals (`1n`, `10n`, `100n`)

## Publication Process

When a new version is tagged:

1. GitHub Actions copies `markdown/*.md` to `docs_mintlify/docs/api-reference/typescript/`
2. A pull request is created in the docs repository
3. After PR approval and merge, documentation is published via Mintlify
4. Documentation becomes available via MCP for LLM consumption

## Troubleshooting

### Missing Documentation Files

If the validation script reports missing files:

```bash
# Check which files are missing
ls -la markdown/

# Regenerate missing files using Claude Code
# Ask: "Regenerate missing documentation files following MINTLIFY_API_REFERENCE.md"
```

### Version Metadata Issues

If version metadata is incorrect:

```bash
# Run the validation script to update metadata
./scripts/generate-docs.sh
```

### Broken Links

Internal links are validated in CI (see
[Link Checks](../CONTRIBUTING.md#link-checks) in `CONTRIBUTING.md`). To reproduce
the checks locally:

```bash
# Fast, network-free lint: rejects escaping (../) and repo-source links
pnpm docs:lint-links

# Full check: stages the files into the docs-site layout and runs the same
# `mintlify broken-links` the docs repo uses (internal links only)
pnpm docs:check-links
```

## Contributing

When contributing documentation changes:

1. Follow the existing file structure and formatting
2. Source all code examples from working tests
3. Update the `MINTLIFY_API_REFERENCE.md` if adding new sections
4. Run `./scripts/generate-docs.sh` to validate
5. Test all code examples to ensure they work
6. Use only allowed link styles — these files are synced verbatim to the docs
   site, so a link that works in-repo can be dead on the site. See the
   [Documentation link conventions](../CONTRIBUTING.md#documentation-link-conventions)
   in `CONTRIBUTING.md`; CI ([Link Checks](#link-checks)) rejects escaping
   (`](../…)`) and repo-source links.

## Resources

- **Source Code**: [nevermined-io/payments](https://github.com/nevermined-io/payments)
- **Published Docs**: [Nevermined Documentation](https://nevermined.ai/docs)
- **Mintlify Docs**: [nevermined-io/docs_mintlify](https://github.com/nevermined-io/docs_mintlify)
- **Specification**: `MINTLIFY_API_REFERENCE.md`
