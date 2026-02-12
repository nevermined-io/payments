# Nevermined Payments CLI

Official command-line interface for the Nevermined Payments SDK.

## Installation

### Via npm (global)

```bash
npm install -g @nevermined-io/cli
```

### Via npx (no installation)

```bash
npx @nevermined-io/cli <command>
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
- Target environment (sandbox, live)

Configuration is saved to `~/.config/nvm/config.json`.

### 2. List Plans

```bash
nvm plans get-plans
```

### 3. Get Plan Details

```bash
nvm plans get-plan did:nvm:abc123
```

### 4. Get X402 Access Token

```bash
nvm x402token get-x402-access-token did:nvm:plan123
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
export NVM_ENVIRONMENT=sandbox
```

### Using Configuration Profiles

Support for multiple profiles:

```bash
# Initialize a production profile
nvm config init --profile production

# Use a specific profile
nvm plans get-plans --profile production

# Show all profiles
nvm config show --all
```

## Output Formats

All commands support multiple output formats:

```bash
# Table format (default)
nvm plans get-plans

# JSON format
nvm plans get-plans --format json

# Quiet mode (no output, useful for scripts)
nvm plans get-plans --format quiet
```

## Commands

### Configuration Commands

- `nvm config init` - Initialize CLI configuration
- `nvm config show` - Display current configuration
- `nvm config set <key> <value>` - Set a configuration value

### Plan Commands

- `nvm plans get-plans` - List all payment plans
- `nvm plans get-plan <planId>` - Get details of a specific plan
- `nvm plans get-plan-balance <planId>` - Get plan balance for a subscriber
- `nvm plans register-plan` - Register a new payment plan (flexible)
- `nvm plans register-credits-plan` - Register a credits-based plan
- `nvm plans register-time-plan` - Register a time-based plan
- `nvm plans register-credits-trial-plan` - Register a trial credits plan
- `nvm plans register-time-trial-plan` - Register a trial time plan

### Agent Commands

- `nvm agents get-agent <agentId>` - Get details of a specific agent
- `nvm agents get-agent-plans <agentId>` - Get plans associated with an agent
- `nvm agents register-agent` - Register a new AI agent
- `nvm agents register-agent-and-plan` - Register an agent with a plan
- `nvm agents add-plan-to-agent <planId>` - Associate a plan with an agent
- `nvm agents remove-plan-from-agent <planId>` - Remove a plan from an agent
- `nvm agents update-agent-metadata <agentId>` - Update agent metadata

### X402 Commands

- `nvm x402token get-x402-access-token <planId>` - Get an X402 access token for a plan

## Examples

### Register a Plan and Agent

```bash
# Initialize config
nvm config init

# Get X402 token for a plan
nvm x402token get-x402-access-token did:nvm:abc123 --format json

# Get plan details
nvm plans get-plan did:nvm:abc123
```

### Using JSON Config Files

```bash
# Register plan from JSON config
nvm plans register-plan --config plan-config.json

# Register agent from JSON config
nvm agents register-agent did:nvm:plan123 --config agent-config.json
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
