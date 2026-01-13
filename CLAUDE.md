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

# Generate documentation
yarn doc
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

## Validating Changes

Before submitting changes, run these checks:

```bash
yarn build && yarn lint && yarn test:unit
```

For full validation including integration tests:

```bash
yarn build && yarn lint && yarn test:unit && yarn test:integration && yarn test:e2e
```

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
