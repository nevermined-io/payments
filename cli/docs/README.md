# Nevermined Payments CLI Documentation

Complete documentation for the Nevermined Payments CLI (`nvm`).

## Overview

The Nevermined Payments CLI is a command-line interface for interacting with the Nevermined Payments Protocol. It enables developers to:

- Create and manage payment plans
- Register AI agents with pay-per-use billing
- Purchase and manage subscriptions
- Query agents using X402 access tokens
- Verify and settle permissions
- Manage organizations and members

## Documentation

### Getting Started

**[Getting Started Guide](./getting-started.md)**

Everything you need to install and configure the CLI:
- Prerequisites and system requirements
- Getting your NVM API key
- Installation methods (npm, npx, from source)
- Configuration setup and profiles
- Environment selection guide
- Common installation issues

### Core Functionality

**[Managing Payment Plans](./plans.md)**

Create and manage payment plans for your services:
- Listing and viewing plans
- Creating credits-based, time-based, and service plans
- Updating plan metadata and pricing
- Checking balances and credits
- Plan files and transfers
- Advanced plan operations

**[Managing AI Agents](./agents.md)**

Register and configure AI agents:
- Listing and viewing agents
- Registering new agents with payment plans
- Updating agent metadata and endpoints
- Managing payment plan associations
- Agent files and resources
- Access control configuration

**[Making Purchases](./purchases.md)**

Order plans and manage subscriptions:
- Ordering payment plans
- Checking credit balances
- Managing subscriptions
- Refilling credits
- Transaction history and analytics
- Automated purchasing and budgeting

**[Querying Agents](./querying.md)**

Access agents using X402 tokens:
- Generating X402 access tokens
- Making HTTP requests with tokens
- Verifying and settling requests
- Complete query workflows
- Batch queries and rate limiting
- Monitoring credit usage

**[Other Commands](./other-commands.md)**

Additional CLI features and utilities:
- Configuration management
- Facilitator operations (verify/settle)
- Organization member management
- X402 token commands
- Global flags and options
- Scripting and automation examples

## Quick Links

### Installation

```bash
# Global installation
npm install -g @nevermined-io/cli

# Using npx
npx @nevermined-io/cli --help
```

### First Steps

```bash
# Initialize configuration
nvm config init

# List available plans
nvm plans get-plans

# Get plan details
nvm plans get-plan <plan-id>

# Order a plan
nvm plans order-plan <plan-id>

# Get access token
nvm x402token get-x402-access-token <plan-id>
```

### Common Commands

```bash
# Configuration
nvm config init              # Initialize configuration
nvm config show              # Display current config
nvm config set <key> <value> # Update configuration

# Plans
nvm plans get-plans                          # List all plans
nvm plans get-plan <plan-id>            # Get plan details
nvm plans get-plan-balance <plan-id>    # Check balance
nvm plans order-plan <plan-id>          # Purchase plan

# Agents
nvm agents list                         # List agents
nvm agents get-agent <agent-id>         # Get agent details
nvm agents register-agent \             # Register new agent
  --agent-metadata metadata.json \
  --agent-api "https://api.example.com" \
  --payment-plans "plan-id-1,plan-id-2"

# X402 Tokens
nvm x402token get-x402-access-token <plan-id>  # Get access token

# Organizations
nvm organizations get-members                    # List members
nvm organizations create-member \                # Add member
  --member-data member.json
```

## Global Flags

All commands support these global flags:

- `-f, --format <format>` - Output format: table, json, quiet (default: table)
- `-p, --profile <profile>` - Configuration profile to use
- `-v, --verbose` - Verbose output with detailed logging
- `-h, --help` - Display help for command

## Output Formats

### Table (Default)

Human-readable table output for interactive use:

```bash
nvm plans get-plans
```

### JSON

Machine-readable JSON for scripting:

```bash
nvm plans get-plans --format json
```

### Quiet

Minimal output for automation:

```bash
nvm plans get-plans --format quiet
```

## Configuration Profiles

Use profiles to manage multiple environments:

```bash
# Create production profile
nvm config set profiles.production.nvmApiKey live:eyJxxxxaaaabbbbbbbb
nvm config set profiles.production.environment live

# Use production profile
nvm --profile production plans list

# Switch active profile
nvm config set activeProfile production
```

## Environment Guide

| Environment | Use Case | Blockchain | Payments |
|-------------|----------|------------|----------|
| `sandbox` | Development, testing | Test network | Test credits |
| `live` | Production | Mainnet | Real payments |

## Examples

### Complete Workflow

```bash
#!/bin/bash
# Complete workflow: Setup -> Purchase -> Query

# 1. Initialize configuration
nvm config init

# 2. List available plans
nvm plans get-plans

# 3. Get plan details
PLAN_ID="123456789012345678"
nvm plans get-plan $PLAN_ID

# 4. Purchase plan
nvm plans order-plan $PLAN_ID

# 5. Check balance
nvm plans get-plan-balance $PLAN_ID

# 6. Get access token
TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')

# 7. Query agent
curl -H "payment-signature: $TOKEN" https://agent-api.example.com/query
```

### Agent Registration

```bash
#!/bin/bash
# Register an AI agent with payment plan

# 1. Create payment plan
PLAN_ID=$(nvm plans register-credits-plan \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json \
  --format json | jq -r '.planId')

# 2. Register agent with plan
AGENT_ID=$(nvm agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com" \
  --payment-plans "$PLAN_ID" \
  --format json | jq -r '.agentId')

# 3. Verify agent is accessible
nvm agents get-agent $AGENT_ID
```

## Getting Help

### Command Help

```bash
# General help
nvm --help

# Topic help
nvm plans --help
nvm agents --help

# Command help
nvm plans get-plan --help
```

### Documentation

- Full Documentation: https://nevermined.ai/docs
- GitHub Repository: https://github.com/nevermined-io/payments
- Issue Tracker: https://github.com/nevermined-io/payments/issues

### Support

- Discord Community: https://discord.gg/nevermined
- Email Support: support@nevermined.io
- Developer Forum: https://forum.nevermined.io

## Advanced Topics

### Automation

The CLI is designed for automation:

```bash
# Cron job for credit monitoring
0 */6 * * * /path/to/check-credits.sh

# CI/CD integration
- run: nvm agents register-agent --agent-metadata agent.json
```

### Scripting

Use JSON output for scripting:

```bash
# Extract data with jq
BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

# Loop over plans
PLANS=$(nvm plans get-plans --format json | jq -r '.[].id')
for PLAN in $PLANS; do
  nvm plans get-plan $PLAN
done
```

### Integration

Integrate with other tools:

```bash
# Export to CSV
nvm plans get-plans --format json | jq -r '.[] | [.id, .name, .price] | @csv' > plans.csv

# Send to monitoring
BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json)
curl -X POST monitoring-api.com/metrics -d "$BALANCE"
```

## Troubleshooting

Common issues and solutions:

### Command Not Found

```bash
# Verify installation
npm list -g @nevermined-io/cli

# Reinstall if needed
npm install -g @nevermined-io/cli
```

### API Key Errors

```bash
# Initialize configuration
nvm config init

# Or set environment variable
export NVM_API_KEY=your-api-key
```

### Permission Errors

```bash
# Fix config file permissions
chmod 600 ~/.config/nvm/config.json

# Use npx instead of global install
npx @nevermined-io/cli
```

## Contributing

Contributions are welcome! See the main repository for:

- Contributing guidelines
- Development setup
- Testing procedures
- Code of conduct

## License

Apache-2.0 License - see LICENSE file for details

## Version

Current version: 1.0.2

Check your version:

```bash
nvm --version
```

Update to latest:

```bash
npm update -g @nevermined-io/cli
```
