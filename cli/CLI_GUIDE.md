# Nevermined Payments CLI Guide

Complete guide for using and developing the Nevermined Payments CLI.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Commands](#commands)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Installation

### npm (Recommended)

```bash
npm install -g @nevermined-io/cli
```

### npx (No Install)

```bash
npx @nevermined-io/cli --help
```

### From Source

```bash
cd cli
yarn install
yarn build:manifest
./bin/run.js --help
```

## Quick Start

### 1. Initialize Configuration

```bash
nevermined config init
```

This will prompt you for:

- API Key (get one from https://nevermined.app)
- Environment (sandbox, live)

### 2. List Available Plans

```bash
nevermined plans get-plans
```

### 3. Get Plan Details

```bash
nevermined plans get-plan <plan-id>
```

### 4. Check Your Balance

```bash
nevermined plans get-plan-balance <plan-id>
```

## Configuration

### Configuration File

The CLI stores configuration in `~/.config/nvm/config.json`:

```json
{
  "profiles": {
    "default": {
      "nvmApiKey": "sandbox:eyJxxxxaaaa",
      "environment": "sandbox"
    },
    "production": {
      "nvmApiKey": "live:eyJyyyybbbb",
      "environment": "live"
    }
  },
  "activeProfile": "default"
}
```

### Environment Variables

You can override configuration with environment variables:

```bash
export NVM_API_KEY=your-api-key
export NVM_ENVIRONMENT=sandbox
```

### Using Profiles

```bash
# Use specific profile
nevermined --profile production plans get-plans

# Set active profile
nevermined config set activeProfile production
```

## Commands

### Config Commands

```bash
nevermined config init               # Initialize configuration
nevermined config show               # Display current configuration
nevermined config set <key> <value>  # Set configuration value
```

### Plans Commands

```bash
# List all plans
nevermined plans get-plans [--format json]

# Get plan details
nevermined plans get-plan <plan-id>

# Get plan balance
nevermined plans get-plan-balance <plan-id> [--account-address <address>]

# Register a credits plan
nevermined plans register-credits-plan \
  --plan-metadata metadata.json \
  --price-config price.json \
  --credits-config credits.json

# Order a plan
nevermined plans order-plan <plan-id>
```

### Agents Commands

```bash
# Get agent details
nevermined agents get-agent <agent-id>

# Register an agent
nevermined agents register-agent \
  --agent-metadata '{"name": "My Agent", "description": "AI Assistant"}' \
  --agent-api "https://api.example.com" \
  --payment-plans "plan-id-1,plan-id-2"

# Update agent metadata
nevermined agents update-agent-metadata <agent-id> \
  --agent-metadata updated-metadata.json
```

### X402 Commands

```bash
# Get X402 access token (crypto, default)
nevermined x402token get-x402-access-token <plan-id>

# Get X402 access token (fiat/card-delegation, auto-selects first enrolled card)
nevermined x402token get-x402-access-token <plan-id> --payment-type fiat

# Get X402 access token (fiat with specific card and limits)
nevermined x402token get-x402-access-token <plan-id> --payment-type fiat \
    --payment-method-id pm_1AbCdEfGhIjKlM \
    --spending-limit-cents 5000 \
    --delegation-duration-secs 7200

# Auto-detect crypto vs fiat from plan metadata
nevermined x402token get-x402-access-token <plan-id> --auto-resolve-scheme
```

### Delegation Commands

```bash
# List enrolled payment methods (credit/debit cards)
nevermined delegation list-payment-methods
```

### Facilitator Commands

```bash
# Verify permissions
nevermined facilitator verify-permissions \
  --verify-permissions-params params.json

# Settle permissions
nevermined facilitator settle-permissions \
  --settle-permissions-params params.json
```

### Organizations Commands

```bash
# Create organization member
nevermined organizations create-member \
  --member-data member.json

# List members
nevermined organizations get-members
```

## Global Flags

All commands support these flags:

```bash
-f, --format <format>    Output format: table, json, quiet (default: table)
-p, --profile <profile>  Configuration profile to use
-v, --verbose            Verbose output with stack traces
-h, --help               Show help
```

### Output Formats

**Table (default)**: Human-readable table output

```bash
nevermined plans get-plans
```

**JSON**: Machine-readable JSON output

```bash
nevermined plans get-plans --format json
```

**Quiet**: Minimal output for scripting

```bash
nevermined plans get-plans --format quiet
```

## Development

### Project Structure

```
cli/
├── src/
│   ├── commands/         # Command implementations
│   │   ├── config/       # Config commands (manual)
│   │   ├── plans/        # Plans commands (generated)
│   │   ├── agents/       # Agents commands (generated)
│   │   ├── x402token/    # X402 commands (generated)
│   │   ├── delegation/   # Card delegation commands
│   │   ├── facilitator/  # Facilitator commands (generated)
│   │   └── organizations/ # Org commands (generated)
│   ├── generator/        # Command generation system
│   │   ├── api-scanner.ts      # Scans SDK API
│   │   ├── command-generator.ts # Generates commands
│   │   ├── generate.ts         # Main generator script
│   │   └── sync-check.ts       # Sync verification
│   ├── utils/            # Utilities
│   │   ├── config-manager.ts   # Config management
│   │   └── output-formatter.ts # Output formatting
│   ├── base-command.ts   # Base command class
│   └── index.ts          # Entry point
├── test/
│   ├── unit/             # Unit tests
│   ├── integration/      # Integration tests
│   └── helpers/          # Test utilities
├── bin/
│   └── run.js            # CLI entry point
└── package.json          # Package configuration
```

### Development Workflow

```bash
# Install dependencies
yarn install

# Build TypeScript
yarn build

# Generate commands from SDK
yarn generate

# Build and generate manifest
yarn build:manifest

# Run in development mode
yarn dev <command>

# Run tests
yarn test

# Run specific tests
yarn test:unit
yarn test:integration

# Check CLI sync with SDK
yarn sync-check

# Lint code
yarn lint
```

### Creating New Commands

#### Manual Commands

Create a new command file in `src/commands/<topic>/`:

```typescript
import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

export default class MyCommand extends BaseCommand {
  static override description = 'My command description'

  static override examples = ['$ nevermined mytopic mycommand <arg>']

  static override flags = {
    ...BaseCommand.baseFlags,
    myFlag: Flags.string({
      description: 'My flag description',
      required: false,
    }),
  }

  static override args = {
    myArg: Args.string({
      description: 'My argument',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)
    const payments = await this.initPayments()

    try {
      const result = await payments.myApi.myMethod(args.myArg, flags.myFlag)
      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
```

#### Auto-Generated Commands

Commands are automatically generated from the SDK API:

```bash
# Generate all commands from SDK
yarn generate

# This will:
# 1. Scan SDK API using ts-morph
# 2. Extract method signatures and JSDoc
# 3. Generate oclif command files
# 4. Create flags and args automatically
```

### Command Generation

The CLI includes an auto-generation system that:

1. **Scans SDK API** - Parses TypeScript AST with ts-morph
2. **Extracts Metadata** - Method signatures, parameters, JSDoc
3. **Generates Commands** - Creates oclif command files
4. **Verifies Sync** - Ensures CLI matches SDK

```bash
# Generate commands
yarn generate

# Verify sync
yarn sync-check

# If out of sync in CI, this fails the build
```

## Testing

### Test Structure

```
test/
├── unit/                     # Unit tests (fast, isolated)
│   ├── simple.test.ts        # Basic tests
│   └── output-formatter-basic.test.ts
├── integration/              # Integration tests (CLI execution)
│   ├── cli-basic.test.ts     # Core CLI functionality
│   └── generated-commands.test.ts # Generated commands
└── helpers/                  # Test utilities
    ├── mock-payments.ts      # SDK mocks
    └── test-utils.ts         # Test helpers
```

### Running Tests

```bash
# Run all stable tests
yarn test

# Run unit tests only
yarn test:unit

# Run integration tests only
yarn test:integration

# Run all tests (including experimental)
yarn test:all

# Run with coverage
yarn test:coverage

# Run in watch mode
yarn test:watch
```

### Writing Tests

#### Integration Test Example

```typescript
import { execSync } from 'child_process'

function runCLI(args: string[]) {
  try {
    const stdout = execSync(`node ./bin/run.js ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      exitCode: error.status || 1,
    }
  }
}

test('command shows help', () => {
  const { stdout, exitCode } = runCLI(['plans', 'list', '--help'])
  expect(exitCode).toBe(0)
  expect(stdout).toContain('USAGE')
})
```

## Troubleshooting

### Common Issues

#### "Command not found"

Make sure the manifest is generated:

```bash
yarn build:manifest
```

#### "API Key not found"

Initialize configuration:

```bash
nevermined config init
```

Or set environment variable:

```bash
export NVM_API_KEY=your-api-key
```

#### "CLI out of sync with SDK"

Regenerate commands:

```bash
yarn generate
yarn build:manifest
```

#### TypeScript Compilation Errors

Clean and rebuild:

```bash
rm -rf dist
yarn build
```

### Debug Mode

Enable verbose output for debugging:

```bash
nevermined <command> --verbose
```

This shows:

- Detailed error messages
- Stack traces
- API request/response details

### Getting Help

```bash
# General help
nevermined --help

# Topic help
nevermined plans --help

# Command help
nevermined plans get-plan --help
```

## Best Practices

### 1. Use Profiles for Different Environments

```bash
# Development
nevermined --profile dev plans get-plans

# Production
nevermined --profile prod plans get-plans
```

### 2. Use JSON Output for Scripting

```bash
# Get plan and extract ID
PLAN_ID=$(nevermined plans get-plans --format json | jq -r '.plans[0].id')
```

### 3. Use JSON Files for Complex Inputs

```bash
# Instead of inline JSON
nevermined agents register-agent --agent-metadata metadata.json
```

### 4. Check Command Help First

```bash
nevermined <topic> <command> --help
```

## Contributing

### Before Submitting PR

1. Run tests: `yarn test`
2. Run sync check: `yarn sync-check`
3. Lint code: `yarn lint`
4. Build manifest: `yarn build:manifest`

### Commit Messages

Follow conventional commits:

```
feat: add new command
fix: resolve error handling issue
docs: update CLI guide
test: add integration tests
chore: update dependencies
```

## Support

- Documentation: https://nevermined.ai/docs
- Issues: https://github.com/nevermined-io/payments/issues
- Discord: https://discord.gg/GZju2qScKq
