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
pnpm install
pnpm build
./bin/run.js --help
```

## Quick Start

### 1. Initialize Configuration

```bash
nevermined config init
```

This will prompt you for:

- Your Nevermined API key
- Target environment (sandbox, live)

Configuration is saved to `~/.config/nvm/config.json`.

### 2. List Plans

```bash
nevermined plans get-plans
```

### 3. Get Plan Details

```bash
nevermined plans get-plan did:nvm:abc123
```

### 4. Get X402 Access Token

```bash
nevermined x402token get-x402-access-token did:nvm:plan123
```

## Usage

```
nevermined [COMMAND]

TOPICS
  agents   Manage AI agents
  config   Manage CLI configuration
  plans    Manage payment plans
  x402     X402 protocol operations

COMMANDS
  help     Display help for nevermined
```

## Configuration

### Using Environment Variables

Instead of `nevermined config init`, you can set environment variables:

```bash
export NVM_API_KEY=nvm-your-api-key
export NVM_ENVIRONMENT=sandbox
```

### Using Configuration Profiles

Support for multiple profiles:

```bash
# Initialize a production profile
nevermined config init --profile production

# Use a specific profile
nevermined plans get-plans --profile production

# Show all profiles
nevermined config show --all
```

## Output Formats

All commands support multiple output formats:

```bash
# Table format (default)
nevermined plans get-plans

# JSON format
nevermined plans get-plans --format json

# Quiet mode (no output, useful for scripts)
nevermined plans get-plans --format quiet
```

## Commands

### Configuration Commands

- `nevermined config init` - Initialize CLI configuration
- `nevermined config show` - Display current configuration
- `nevermined config set <key> <value>` - Set a configuration value

### Plan Commands

- `nevermined plans get-plans` - List all payment plans
- `nevermined plans get-plan <planId>` - Get details of a specific plan
- `nevermined plans get-plan-balance <planId>` - Get plan balance for a subscriber
- `nevermined plans register-plan` - Register a new payment plan (flexible)
- `nevermined plans register-credits-plan` - Register a credits-based plan
- `nevermined plans register-time-plan` - Register a time-based plan
- `nevermined plans register-credits-trial-plan` - Register a trial credits plan
- `nevermined plans register-time-trial-plan` - Register a trial time plan

### Agent Commands

- `nevermined agents get-agent <agentId>` - Get details of a specific agent
- `nevermined agents get-agent-plans <agentId>` - Get plans associated with an agent
- `nevermined agents register-agent` - Register a new AI agent
- `nevermined agents register-agent-and-plan` - Register an agent with a plan
- `nevermined agents add-plan-to-agent <planId>` - Associate a plan with an agent
- `nevermined agents remove-plan-from-agent <planId>` - Remove a plan from an agent
- `nevermined agents update-agent-metadata <agentId>` - Update agent metadata

### X402 Commands

- `nevermined x402token get-x402-access-token <planId>` - Get an X402 access token for a plan

## Examples

### Register a Plan and Agent

```bash
# Initialize config
nevermined config init

# Get X402 token for a plan
nevermined x402token get-x402-access-token did:nvm:abc123 --format json

# Get plan details
nevermined plans get-plan did:nvm:abc123
```

### Using JSON Config Files

```bash
# Register plan from JSON config
nevermined plans register-plan --config plan-config.json

# Register agent from JSON config
nevermined agents register-agent did:nvm:plan123 --config agent-config.json
```

## Development

### Building

```bash
pnpm build
```

### Testing

```bash
pnpm test
```

### Linting

```bash
pnpm lint
```

## License

Apache-2.0

## Links

- [Nevermined Payments SDK](https://github.com/nevermined-io/payments)
- [Documentation](https://nevermined.ai/docs)
- [Nevermined Website](https://nevermined.io)
