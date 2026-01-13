# CLAUDE.md

Project-specific instructions for Claude Code when working with the Nevermined Payments TypeScript SDK.

## Package Manager

This project uses **yarn**. Always use yarn commands:

```bash
yarn install          # Install dependencies
yarn build            # Build the project
yarn lint             # Run ESLint
yarn format           # Check Prettier formatting
yarn test             # Run all tests
yarn test:unit        # Run unit tests only
yarn test:integration # Run integration tests only
yarn test:e2e         # Run end-to-end tests only
```

## Development Workflow

### Always Verify Build and Lint After Changes

After making any code changes, always run:

```bash
yarn build   # TypeScript compilation must pass
yarn lint    # ESLint must pass (no errors)
```

Both commands must succeed before considering the changes complete.

### Code Changes Require Test Updates

When modifying code in `src/`, always update the corresponding tests:

- `tests/unit/` - Unit tests for isolated functionality
- `tests/integration/` - Integration tests with external services
- `tests/e2e/` - End-to-end tests for full workflows

### Linting Requirements

All code must pass the lint step before CI will succeed. The project uses:

- **ESLint** configured in `.eslintrc`:
  - Extends `nevermined` (shared Nevermined config from `eslint-config-nevermined`)
  - Uses `eslint-plugin-tsdoc` for TSDoc syntax validation
  - `tsdoc/syntax`: warn
  - `@typescript-eslint/no-explicit-any`: off
- **Prettier** for code formatting (config in `prettier.config.js`, extends `eslint-config-nevermined/prettier.config.js`)

Before committing, ensure your code passes:

```bash
yarn lint    # ESLint check on ./src
yarn format  # Prettier check on ./src
```

To auto-fix issues:

```bash
yarn lint --fix
npx prettier --write ./src
```

## CI Workflow

The CI pipeline (`.github/workflows/testing.yml`) runs:

1. **lint_build** - Lints and builds the project
2. **unit_integration** - Runs unit and integration tests (requires lint_build)
3. **e2e** - Runs E2E tests (requires unit_integration to pass)

## Project Structure

```
src/           # Source code
tests/
  unit/        # Unit tests
  integration/ # Integration tests
  e2e/         # End-to-end tests
  utils.ts     # Shared test utilities
dist/          # Build output (generated)
```

## Key APIs

- `Payments` - Main entry point for the SDK
- `payments.facilitator` - X402 verify/settle permissions
- `payments.x402` - X402 access token generation
- `payments.plans` - Plan management
- `payments.agents` - Agent management
