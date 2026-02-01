# Nevermined Payments CLI

Official command-line interface for the Nevermined Payments SDK.

## Installation

### Via npm (global)

```bash
npm install -g @nevermined-io/payments-cli
```

### Via npx (no installation)

```bash
npx @nevermined-io/payments-cli <command>
```

### From source

```bash
git clone https://github.com/nevermined-io/payments
cd payments/cli
yarn install
yarn build
./bin/run.js --help
```

## Quick Start

### 1. Initialize Configuration

```bash
nvm config init
```

This will prompt you for:
- Your Nevermined API key
- Target environment (staging_sandbox, staging_live, sandbox, live)

Configuration is saved to `~/.config/nvm/config.json`.

### 2. List Plans

```bash
nvm plans list
```

### 3. Get Plan Details

```bash
nvm plans get did:nvm:abc123
```

### 4. Get X402 Access Token

```bash
nvm x402 get-token did:nvm:plan123
```

## Usage

```
nvm [COMMAND]

TOPICS
  agents   Manage AI agents
  config   Manage CLI configuration
  plans    Manage payment plans
  x402     X402 protocol operations

COMMANDS
  help     Display help for nvm
```

## Configuration

### Using Environment Variables

Instead of `nvm config init`, you can set environment variables:

```bash
export NVM_API_KEY=nvm-your-api-key
export NVM_ENVIRONMENT=staging_sandbox
```

### Using Configuration Profiles

Support for multiple profiles:

```bash
# Initialize a production profile
nvm config init --profile production

# Use a specific profile
nvm plans list --profile production

# Show all profiles
nvm config show --all
```

## Output Formats

All commands support multiple output formats:

```bash
# Table format (default)
nvm plans list

# JSON format
nvm plans list --format json

# Quiet mode (no output, useful for scripts)
nvm plans list --format quiet
```

## Commands

### Configuration Commands

- `nvm config init` - Initialize CLI configuration
- `nvm config show` - Display current configuration
- `nvm config set <key> <value>` - Set a configuration value

### Plan Commands

- `nvm plans list` - List all payment plans
- `nvm plans get <planId>` - Get details of a specific plan
- `nvm plans register` - Register a new payment plan (see help for options)

### Agent Commands

- `nvm agents list` - List all AI agents
- `nvm agents get <agentId>` - Get details of a specific agent
- `nvm agents register` - Register a new AI agent

### X402 Commands

- `nvm x402 get-token <planId>` - Get an X402 access token for a plan

## Examples

### Register a Plan and Agent

```bash
# Initialize config
nvm config init

# Get X402 token for a plan
nvm x402 get-token did:nvm:abc123 --format json

# Get plan details
nvm plans get did:nvm:abc123
```

### Using JSON Config Files

```bash
# Register plan from JSON config
nvm plans register --config plan-config.json

# Register agent from JSON config
nvm agents register did:nvm:plan123 --config agent-config.json
```

## Development

### Building

```bash
yarn build
```

### Testing

```bash
yarn test
```

### Linting

```bash
yarn lint
```

## License

Apache-2.0

## Links

- [Nevermined Payments SDK](https://github.com/nevermined-io/payments)
- [Documentation](https://nevermined.ai/docs)
- [Nevermined Website](https://nevermined.io)
