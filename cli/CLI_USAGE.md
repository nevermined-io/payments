# Nevermined Payments CLI - Quick Start Guide

## Installation

### Option 1: From Source (Current)

```bash
cd /home/aitor/Projects/Nevermined/payments/cli
yarn install
yarn build
./bin/run.js --help
```

### Option 2: Via npm (After Publishing)

```bash
npm install -g @nevermined-io/cli
nvm --help
```

### Option 3: Via npx (No Installation)

```bash
npx @nevermined-io/cli <command>
```

## Quick Start

### 1. Configure the CLI

```bash
# Interactive configuration
./bin/run.js config init

# Non-interactive configuration
./bin/run.js config init --api-key your-api-key --environment sandbox

# View current configuration
./bin/run.js config show

# View all profiles
./bin/run.js config show --all
```

### 2. Work with Plans

```bash
# List all plans
./bin/run.js plans list

# List plans in JSON format
./bin/run.js plans list --format json

# Get specific plan details
./bin/run.js plans get did:nvm:abc123

# Check plan balance
./bin/run.js plans balance did:nvm:abc123

# Check balance for specific account
./bin/run.js plans balance did:nvm:abc123 --account 0x123...
```

### 3. Work with Agents

```bash
# Get agent details
./bin/run.js agents get did:nvm:agent123

# Register agent (requires config file)
./bin/run.js agents register --config agent-config.json
```

### 4. X402 Protocol

```bash
# Get access token for a plan
./bin/run.js x402 get-token did:nvm:plan123

# Get token in JSON format
./bin/run.js x402 get-token did:nvm:plan123 --format json
```

## Available Commands

### Configuration (`config`)

- `config init` - Initialize CLI configuration
- `config show` - Display current configuration
- `config set <key> <value>` - Set configuration value

### Plans (`plans`)

- `plans list` - List all payment plans
- `plans get <planId>` - Get plan details
- `plans balance <planId>` - Get plan balance
- `plans register` - Register new plan (placeholder)

### Agents (`agents`)

- `agents list` - List agents (placeholder)
- `agents get <agentId>` - Get agent details
- `agents register` - Register agent (placeholder)

### X402 Protocol (`x402`)

- `x402 get-token <planId>` - Get X402 access token

## Output Formats

All commands support multiple output formats:

```bash
# Table format (default, human-readable)
./bin/run.js plans list

# JSON format (machine-readable)
./bin/run.js plans list --format json

# Quiet mode (minimal output, useful for scripts)
./bin/run.js plans list --format quiet
```

## Configuration Options

### Environment Variables

You can override configuration with environment variables:

```bash
export NVM_API_KEY=nvm-your-api-key
export NVM_ENVIRONMENT=sandbox
export NVM_CONFIG=/custom/path/config.json

./bin/run.js plans list
```

### Configuration File

Default location: `~/.config/nvm/config.json`

```json
{
  "profiles": {
    "default": {
      "nvmApiKey": "nvm-api-key",
      "environment": "sandbox"
    },
    "production": {
      "nvmApiKey": "nvm-prod-key",
      "environment": "live"
    }
  },
  "activeProfile": "default"
}
```

### Supported Environments

- `sandbox` - Testing environment (recommended for development)
- `live` - Production environment
- `custom` - Custom environment configuration

## Using Profiles

```bash
# Create a production profile
./bin/run.js config init --profile production

# Use a specific profile for a command
./bin/run.js plans list --profile production

# Set a value for a specific profile
./bin/run.js config set nvmApiKey nvm-prod-key --profile production
```

## Examples

### Example 1: Check Your Plans

```bash
# Configure CLI
./bin/run.js config init --api-key nvm-your-key --environment sandbox

# List all your plans
./bin/run.js plans list

# Expected output:
# ┌────────────────┬─────────────┬──────────┬─────────────┐
# │ Plan ID        │ Name        │ Type     │ Created     │
# ├────────────────┼─────────────┼──────────┼─────────────┤
# │ did:nvm:abc... │ Basic Plan  │ credits  │ 1/31/2026   │
# └────────────────┴─────────────┴──────────┴─────────────┘
```

### Example 2: Get X402 Access Token

```bash
# Get token for a plan
./bin/run.js x402 get-token did:nvm:plan123

# Expected output:
# ℹ Generating X402 access token...
# ✓ Access token generated!
#
# Token: eyJhbGc...
#
# ℹ Use this token in the X-NVM-PROXY-ACCESS-TOKEN header
```

### Example 3: Check Plan Balance

```bash
# Check balance for a plan
./bin/run.js plans balance did:nvm:plan123

# Expected output:
# ┌──────────────────┬─────────────────────┐
# │ Plan ID          │ did:nvm:plan123     │
# ├──────────────────┼─────────────────────┤
# │ Plan Name        │ Basic Plan          │
# ├──────────────────┼─────────────────────┤
# │ Plan Type        │ credits             │
# ├──────────────────┼─────────────────────┤
# │ Balance          │ 1000                │
# ├──────────────────┼─────────────────────┤
# │ Is Subscriber    │ Yes                 │
# └──────────────────┴─────────────────────┘
```

### Example 4: Scripting with JSON Output

```bash
#!/bin/bash

# Get all plans and extract DIDs
plans=$(./bin/run.js plans list --format json)
plan_ids=$(echo "$plans" | jq -r '.[].did')

# Loop through each plan and get balance
for plan_id in $plan_ids; do
  echo "Checking balance for $plan_id..."
  ./bin/run.js plans balance "$plan_id" --format json
done
```

## Troubleshooting

### Command Not Found

If you get "command not found" after global installation:

```bash
# Make sure npm global bin is in PATH
echo $PATH | grep npm

# Or use npx
npx @nevermined-io/cli --help
```

### Configuration Not Found

```bash
# Check if config file exists
cat ~/.config/nvm/config.json

# Reinitialize configuration
./bin/run.js config init
```

### API Errors

```bash
# Use verbose flag for detailed error information
./bin/run.js plans list --verbose

# Check your API key is valid
./bin/run.js config show
```

## Development

### Building from Source

```bash
cd /home/aitor/Projects/Nevermined/payments/cli
yarn install
yarn build
```

### Running in Development Mode

```bash
# Use dev script for faster iteration
./bin/dev.js plans list

# Or use tsx directly
yarn dev plans list
```

### Adding New Commands

1. Create command file in `src/commands/<topic>/<command>.ts`
2. Extend `BaseCommand` class
3. Implement `run()` method
4. Build and test

```typescript
import { Args } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

export default class MyCommand extends BaseCommand {
  static description = 'My command description'

  static args = {
    myArg: Args.string({ required: true })
  }

  async run(): Promise<void> {
    const { args } = await this.parse(MyCommand)
    const payments = await this.initPayments()

    // Your command logic here
    this.formatter.success('Done!')
  }
}
```

## Getting Help

```bash
# General help
./bin/run.js --help

# Command-specific help
./bin/run.js plans --help
./bin/run.js plans list --help

# Version
./bin/run.js --version
```

## Next Steps

1. **Explore Commands**: Try out different commands with `--help`
2. **Set Up Profiles**: Configure multiple environments
3. **Automate Workflows**: Use JSON output for scripting
4. **Read Documentation**: See [README.md](README.md) for more details

## Links

- [Nevermined Payments SDK](https://github.com/nevermined-io/payments)
- [API Documentation](https://nevermined.ai/docs)
- [CLI Implementation Details](../CLI_IMPLEMENTATION.md)
