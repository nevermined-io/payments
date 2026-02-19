---
title: "Other Commands"
description: "Reference guide for additional CLI commands including configuration, facilitator operations, organizations, and utilities"
icon: "terminal"
---

# Other Commands

Reference guide for additional CLI commands including configuration, facilitator operations, organizations, and utilities.

## Configuration Commands

### Login

Authenticate via browser login. Opens your browser, waits for you to sign in, and saves the API key to your CLI config:

```bash
nvm login
nvm login --environment live
nvm login --profile production --environment live
nvm login --no-browser  # Print URL instead of opening browser
```

### Logout

Remove your API key from the local configuration so you need to authenticate again:

```bash
nvm logout
nvm logout --profile production
nvm logout --all-profiles  # Remove API keys from every profile
```

### Initialize Configuration

Set up your CLI configuration interactively:

```bash
nvm config init
```

Interactive prompts:
- NVM API Key
- Environment (sandbox, live)
- Profile name (optional)

Flags:
- `--api-key` — Provide API key non-interactively
- `--environment` — Set environment (sandbox, live, staging_sandbox, staging_live)
- `-i, --interactive` — Interactive mode (default: true)

### View Configuration

Display your current configuration:

```bash
nvm config show

# Show all profiles
nvm config show --all
```

Output:

```
Current Configuration
Active Profile: default
Environment:    sandbox
API Key:        sandbox:eyJxxxxaaaa...bbbbbbbb (truncated)
Config File:    /home/user/.config/nvm/config.json
```

### Set Configuration Values

Update specific configuration values:

```bash
# Set API key
nvm config set nvmApiKey sandbox:eyJxxxxaaaa...bbbbbbbb

# Set environment
nvm config set environment sandbox

# Set active profile
nvm config set activeProfile production
```

### Configuration File Structure

The config file at `~/.config/nvm/config.json`:

```json
{
  "profiles": {
    "default": {
      "nvmApiKey": "sandbox:eyJxxxxaaaa...bbbbbbbb",
      "environment": "sandbox"
    },
    "production": {
      "nvmApiKey": "live:eyJyyyybbbb...",
      "environment": "live"
    }
  },
  "activeProfile": "default"
}
```

## Facilitator Commands

Facilitator commands are used by agent owners to verify and settle permissions (credit burning).

### Verify Permissions

Verify that a subscriber has permission to use credits from a payment plan. This simulates credit usage without actually burning credits:

```bash
nvm facilitator verify-permissions \
  --params verify.json
```

**verify.json**:

```json
{
  "paymentRequired": "eyJhbGci...",
  "x402AccessToken": "eyJhbGci...",
  "maxAmount": "5"
}
```

### Settle Permissions

Settle (burn) credits from a subscriber's payment plan. This executes the actual credit consumption:

```bash
nvm facilitator settle-permissions \
  --params settle.json
```

**settle.json**:

```json
{
  "paymentRequired": "eyJhbGci...",
  "x402AccessToken": "eyJhbGci...",
  "maxAmount": "5"
}
```

## Organizations Commands

Manage organization members and settings.

### List Members

View all members in your organization:

```bash
nvm organizations get-members

# Filter by role
nvm organizations get-members --role admin

# Filter active members
nvm organizations get-members --is-active true

# Pagination
nvm organizations get-members --page 1 --offset 10
```

### Create Member

Add a new member to your organization:

```bash
nvm organizations create-member <user-id>

# With email and role
nvm organizations create-member <user-id> --user-email "john@example.com" --user-role "developer"
```

Flags:
- `--user-email` — Member's email address (optional)
- `--user-role` — Member's role (optional)

### Connect Stripe Account

Connect a user with Stripe for fiat payments:

```bash
nvm organizations connect-stripe-account \
  --user-email "john@example.com" \
  --user-country-code "US" \
  --return-url "https://yourapp.com/stripe-callback"
```

All flags are required:
- `--user-email` — User's email address
- `--user-country-code` — Two-letter country code
- `--return-url` — URL to redirect after Stripe connection

## X402 Token Commands

### Get X402 Access Token

Generate an access token for a plan with delegated permissions:

```bash
nvm x402token get-x402-access-token <plan-id>
```

Example:

```bash
nvm x402token get-x402-access-token "did:nvm:abc123"
```

Optional flags:
- `--agent-id` — Target agent ID
- `--redemption-limit` — Maximum credits that can be redeemed
- `--order-limit` — Maximum number of orders
- `--expiration` — Token expiration time

Example with options:

```bash
nvm x402token get-x402-access-token "did:nvm:abc123" \
  --agent-id "did:nvm:agent456" \
  --redemption-limit 100 \
  --expiration 3600
```

Output:

```
X402 Access Token
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Plan ID: did:nvm:abc123
```

### Save Token

Save token for later use:

```bash
# Save to environment variable
export X402_TOKEN=$(nvm x402token get-x402-access-token "did:nvm:abc123" \
  --format json | jq -r '.token')

# Use token in requests
curl -H "payment-signature: $X402_TOKEN" https://agent-api.example.com
```

## Global Flags

All commands support these global flags:

### Format Flag

Control output format:

```bash
# Table output (default)
nvm plans get-plans

# JSON output
nvm plans get-plans --format json

# Quiet output (minimal)
nvm plans get-plans --format quiet
```

### Profile Flag

Use a specific configuration profile:

```bash
# Use production profile
nvm --profile production plans get-plans

# Use staging profile
nvm --profile staging agents get-agent <agent-id>
```

### Verbose Flag

Enable verbose output with detailed logging:

```bash
nvm plans order-plan "did:nvm:abc123" --verbose
```

Output includes:
- Request/response details
- Stack traces for errors
- Debug information

## Utility Commands

### Version Information

Check CLI version:

```bash
nvm --version
```

### Help

Get help for commands:

```bash
# General help
nvm --help

# Topic help
nvm plans --help
nvm agents --help
nvm config --help

# Command help
nvm plans get-plan --help
nvm agents register-agent --help
```

## Scripting Examples

### Environment Switcher

Switch between environments easily:

```bash
#!/bin/bash
case $1 in
  production)
    nvm config set activeProfile production
    echo "Switched to production environment"
    ;;
  sandbox)
    nvm config set activeProfile default
    echo "Switched to sandbox environment"
    ;;
  *)
    echo "Usage: $0 {production|sandbox}"
    exit 1
    ;;
esac

nvm config show
```

### Multi-Profile Operations

Run commands across multiple profiles:

```bash
#!/bin/bash
PROFILES=("default" "production")
COMMAND="$@"

for PROFILE in "${PROFILES[@]}"; do
  echo "Profile: $PROFILE"
  nvm --profile $PROFILE $COMMAND
  echo ""
done
```

Usage:

```bash
./multi-profile.sh plans get-plans
```

## Integration Examples

### CI/CD Pipeline

Use CLI in CI/CD:

```yaml
# .github/workflows/deploy-agent.yml
name: Deploy Agent

on:
  push:
    tags:
      - 'v*'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - name: Install CLI
        run: npm install -g @nevermined-io/cli

      - name: Configure CLI
        run: |
          nvm config set nvmApiKey ${{ secrets.NVM_API_KEY }}
          nvm config set environment live

      - name: Register Agent
        run: |
          nvm agents register-agent \
            --agent-metadata agent.json \
            --agent-api "https://api.example.com" \
            --payment-plans "${{ secrets.PLAN_ID }}"
```

## Common Issues

### "Config file not found"

Initialize configuration:

```bash
nvm login
# or
nvm config init
```

### "Invalid profile"

Check available profiles:

```bash
nvm config show --all
```

### "Permission denied"

Fix config file permissions:

```bash
chmod 600 ~/.config/nvm/config.json
```

## Next Steps

- [Getting Started](./getting-started.md) - Installation and setup
- [Plans](./plans.md) - Create and manage plans
- [Agents](./agents.md) - Register and manage agents
- [Purchases](./purchases.md) - Order plans and manage credits
- [Querying](./querying.md) - Query agents with X402 tokens
