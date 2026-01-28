# Nevermined Payments SDK Documentation

This directory contains the markdown documentation for the Nevermined Payments TypeScript SDK. The documentation is automatically generated and published to the [Nevermined Documentation](https://github.com/nevermined-io/docs_mintlify) repository.

## Documentation Files

1. **01-installation.mdx** - Installation guide and prerequisites
2. **02-initializing-the-library.mdx** - Initializing the Payments instance
3. **03-payment-plans.mdx** - Payment plans, pricing, and credits
4. **04-agents.mdx** - Agent registration and management
5. **05-publishing-static-resources.mdx** - Publishing static content agents
6. **06-payments-and-balance.mdx** - Making payments and checking balances
7. **07-querying-an-agent.mdx** - Generating tokens and querying agents
8. **08-validation-of-requests.mdx** - Validating and settling permissions
9. **09-mcp-integration.mdx** - Model Context Protocol integration
10. **10-a2a-integration.mdx** - Agent-to-Agent protocol integration
11. **11-x402.mdx** - X402 payment protocol specification

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

1. GitHub Actions copies `markdown/*.mdx` to `docs_mintlify/docs/api-reference/typescript/`
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

To verify all internal links work:

```bash
# Check for broken .mdx links
grep -r "\.mdx)" markdown/ | while read line; do
  file=$(echo "$line" | cut -d: -f1)
  link=$(echo "$line" | grep -o '[0-9][0-9]-[a-z-]*.mdx')
  if [ ! -f "markdown/$link" ]; then
    echo "Broken link in $file: $link"
  fi
done
```

## Contributing

When contributing documentation changes:

1. Follow the existing file structure and formatting
2. Source all code examples from working tests
3. Update the `MINTLIFY_API_REFERENCE.md` if adding new sections
4. Run `./scripts/generate-docs.sh` to validate
5. Test all code examples to ensure they work

## Resources

- **Source Code**: [nevermined-io/payments](https://github.com/nevermined-io/payments)
- **Published Docs**: [Nevermined Documentation](https://docs.nevermined.io)
- **Mintlify Docs**: [nevermined-io/docs_mintlify](https://github.com/nevermined-io/docs_mintlify)
- **Specification**: `MINTLIFY_API_REFERENCE.md`
