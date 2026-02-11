# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is the Nevermined Payments TypeScript SDK - a library for integrating AI agent payment functionality using the Nevermined Protocol. It enables AI builders to register agents with payment plans, and subscribers to purchase access and query agents.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture, flow diagrams, and integration patterns.

## Build and Development Commands

```bash
# Install dependencies
yarn

# Build the project
yarn build

# Run all tests
yarn test

# Run specific test types
yarn test:unit              # Unit tests only
yarn test:integration       # Integration tests only
yarn test:e2e               # E2E tests (runs sequentially with --runInBand)

# Run a single test file
yarn test -- tests/unit/payments.test.ts

# Lint and format
yarn lint                   # ESLint
yarn format                 # Prettier check

# Generate TypeDoc API documentation (HTML)
yarn doc

# Validate markdown documentation
./scripts/generate-docs.sh

# Publish markdown documentation (manual)
./scripts/publish-docs.sh
```

## Quick Reference

### Initialization

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: process.env.NVM_ENVIRONMENT as EnvironmentName,
})
```

### Main APIs

| API | Purpose |
|-----|---------|
| `payments.plans` | Register and manage payment plans |
| `payments.agents` | Register AI agents with payment plans |
| `payments.mcp` | MCP server with OAuth 2.1 authentication |
| `payments.a2a` | A2A protocol server with payments |
| `payments.x402` | X402 access token generation |
| `payments.facilitator` | Verify/settle permissions (credit burning) |

## Important Conventions

### BigInt Handling

The SDK uses `BigInt` for plan configuration fields (`durationSecs`, `minAmount`, `maxAmount`, `amount`, `price`, `amountOfCredits`). When comparing these fields, always wrap with `BigInt()` to tolerate both `number` and `bigint` inputs from callers (e.g., `BigInt(creditsConfig.durationSecs) === 0n` instead of `creditsConfig.durationSecs === 0n`).

The CLI has BigInt-aware JSON parsing (reviver in `cli/src/base-command.ts`) and serialization (replacer in `cli/src/utils/output-formatter.ts`) to handle these fields correctly across the JSON boundary.

### Environment Naming

The SDK and CLI support four environment values: `sandbox`, `live`, `staging_sandbox`, and `staging_live`. The `staging_*` variants are for **internal development only** and must never appear in public-facing documentation. All docs, examples, and SKILL files must use only `sandbox` and `live`. The CLI defaults to `sandbox` when no environment is set.

### x402 Protocol and Documentation Standards

When writing examples or documentation:
- **Headers**: Always use `payment-signature` (client → server). Never use the deprecated `X-402` header name.
- **Validation API**: Always use `payments.facilitator.verifyPermissions()` / `payments.facilitator.settlePermissions()`. Never use the deprecated `payments.requests.isValidRequest()`.
- **Framework middleware**: Prefer `paymentMiddleware` (Express.js) or `PaymentMiddleware` (FastAPI) over manual verify/settle in examples.

## Validating Changes

**IMPORTANT**: Always run tests after any code change to ensure nothing is broken.

Before submitting changes, run these checks:

```bash
yarn build && yarn lint && yarn test:unit
```

For full validation including integration tests:

```bash
yarn build && yarn lint && yarn test:unit && yarn test:integration && yarn test:e2e
```

### After Modifying Source Files

When you modify source files, especially:
- Token handling code (`src/a2a/`, `src/mcp/core/auth.ts`, `src/x402/`)
- API interfaces or types
- Authentication/authorization logic

You MUST:
1. Run `yarn build` to verify TypeScript compilation
2. Run `yarn test:unit` to verify unit tests pass
3. If modifying E2E-related code, run `yarn test:e2e`
4. If changing public interfaces (function signatures, options, types, response fields), update the corresponding documentation in `markdown/` to reflect the changes. These are manually maintained guides — not auto-generated. Validate with `./scripts/generate-docs.sh`

### Updating Mock Tokens in Tests

When updating code that changes token structure (e.g., x402 spec alignment), update mock tokens in test files to match the new structure. The x402-compliant token structure is:

```typescript
{
  x402Version: 2,
  accepted: {
    scheme: 'nvm:erc4337',
    network: 'eip155:84532',
    planId: 'plan-id',
    extra: { version: '1' },
  },
  payload: {
    signature: '0x...',
    authorization: {
      from: '0xsubscriberAddress',  // subscriberAddress location
      sessionKeysProvider: 'zerodev',
      sessionKeys: [],
    },
  },
  extensions: {},
}
```

Test files with mock tokens that may need updating:

**Unit tests:**
- `tests/unit/mcp.test.ts`
- `tests/unit/mcp/auth_extract_header.test.ts`
- `tests/unit/mcp/auth_http_url_fallback.test.ts`
- `tests/unit/a2a/payments-request-handler.test.ts`

**Integration tests:**
- `tests/integration/mcp-integration.test.ts`
- `tests/integration/mcp/mcp_paywall_invalid_token_flow.test.ts`
- `tests/integration/mcp/mcp_handler_auth_header_propagation.test.ts`
- `tests/integration/a2a/complete-message-send-flow.test.ts`
- `tests/integration/a2a/payments-server.test.ts`

## Continuous Integration

CI is configured in `.github/workflows/testing.yml` and runs on every push:

| Job | Description | Depends On |
|-----|-------------|------------|
| `lint_build` | Install, build, lint | - |
| `unit_integration` | Unit + integration tests | lint_build |
| `e2e` | End-to-end tests | unit_integration |

**Required secrets:**
- `TEST_SUBSCRIBER_API_KEY` - API key for subscriber account
- `TEST_BUILDER_API_KEY` - API key for builder account
- `TEST_ENVIRONMENT` - Target environment

## Test Structure

- `tests/unit/` - Unit tests (mocked dependencies)
- `tests/integration/` - Integration tests (real API calls)
- `tests/e2e/` - End-to-end tests (full flows, sequential)
- `tests/utils.ts` - Utilities: `retryWithBackoff`, `waitForCondition`

See [TESTING.md](./TESTING.md) for testing patterns when building applications with this library.

### E2E Tests and Staging

E2E tests run directly against the **staging environment**. When making changes:

1. Ensure E2E tests pass after code changes: `yarn test:e2e`
2. If E2E tests fail after backend API changes (in `nvm-monorepo`), the staging environment may need to be redeployed with those changes before the SDK E2E tests will pass
3. E2E test failures due to pending backend deployments are expected - coordinate with the team to deploy backend changes to staging first

## Running Agents

See [RUN.md](./RUN.md) for complete examples:
- MCP Server with OAuth 2.1
- A2A Server with payment integration
- HTTP Agent with manual X402 verification

## Module System

ESM-only (`"type": "module"`). Import paths use `.js` extensions:

```typescript
import { foo } from './bar.js'
```

## Package Exports

- `@nevermined-io/payments` - Main SDK
- `@nevermined-io/payments/mcp` - MCP-specific exports

## Documentation

The SDK has two types of documentation:

### 1. Markdown Documentation (LLM-Friendly)

Located in `markdown/` directory with 11 comprehensive guides:

- **Installation & Setup**: Getting started with the SDK
- **Payment Plans & Agents**: Core API usage
- **Static Resources**: Publishing static content
- **Payments & Balance**: Making payments and checking credits
- **Querying Agents**: Using X402 access tokens
- **Request Validation**: Verifying and settling permissions
- **MCP Integration**: Model Context Protocol setup
- **A2A Integration**: Agent-to-Agent protocol setup
- **X402 Protocol**: Complete payment protocol specification

**Automated Updates:**
- Documentation is automatically updated on push to main/develop
- Published to [nevermined-io/docs_mintlify](https://github.com/nevermined-io/docs_mintlify) on tag

**Commands:**
```bash
# Validate documentation
./scripts/generate-docs.sh

# Publish documentation (manual)
./scripts/publish-docs.sh

# Check workflow status
gh run list --workflow=update-docs.yml
gh run list --workflow=publish-docs.yml
```

**Full Documentation:**
- See [DOCUMENTATION.md](./DOCUMENTATION.md) for complete automation guide
- See [markdown/README.md](./markdown/README.md) for documentation overview
- See [MINTLIFY_API_REFERENCE.md](./MINTLIFY_API_REFERENCE.md) for specification

### 2. TypeDoc API Documentation (HTML)

Located in `docs/` directory - auto-generated HTML documentation:

```bash
# Generate TypeDoc documentation
yarn doc
```

The HTML documentation is generated from TypeScript source code comments and provides:
- Complete API reference
- Class and interface documentation
- Type definitions
- Method signatures and parameters

**Note**: TypeDoc generation requires all dependencies to be installed and the project to build successfully.
