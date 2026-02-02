---
title: "Other Commands"
description: "Reference guide for additional CLI commands including configuration, facilitator operations, organizations, and utilities"
icon: "terminal"
---

# Other Commands

Reference guide for additional CLI commands including configuration, facilitator operations, organizations, and utilities.

## Configuration Commands

### Initialize Configuration

Set up your CLI configuration interactively:

```bash
nvm config init
```

Interactive prompts:
- NVM API Key
- Environment (staging_sandbox, sandbox, staging_live, live)
- Profile name (optional)

### View Configuration

Display your current configuration:

```bash
nvm config show
```

Output:

```
Current Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Active Profile: default
Environment:    staging_sandbox
API Key:        nvm-xxxxx...xxxxx (truncated)
Config File:    /home/user/.config/nvm/config.json
```

### Set Configuration Values

Update specific configuration values:

```bash
# Set API key
nvm config set nvmApiKey nvm-xxxxxxxx...

# Set environment
nvm config set environment staging_sandbox

# Set active profile
nvm config set activeProfile production

# Create new profile
nvm config set profiles.production.nvmApiKey nvm-yyyyyyyy...
nvm config set profiles.production.environment live
```

### Configuration File Structure

The config file at `~/.config/nvm/config.json`:

```json
{
  "profiles": {
    "default": {
      "nvmApiKey": "nvm-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "environment": "staging_sandbox"
    },
    "staging": {
      "nvmApiKey": "nvm-staging-key",
      "environment": "staging_sandbox"
    },
    "production": {
      "nvmApiKey": "nvm-production-key",
      "environment": "live"
    }
  },
  "activeProfile": "default"
}
```

## Facilitator Commands

Facilitator commands are used by agent owners to verify and settle permissions (credit burning).

### Verify Permissions

Verify that a request has valid permissions before processing:

```bash
nvm facilitator verify-permissions \
  --verify-permissions-params verify.json
```

**verify.json**:

```json
{
  "planId": "did:nvm:abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "creditsRequired": 5
}
```

Output:

```
Permission Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: Valid
Plan ID: did:nvm:abc123
Subscriber: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Credits Available: 100
Credits Required: 5
Can Proceed: true
Signature Valid: true
```

### Settle Permissions

Burn credits after processing a request:

```bash
nvm facilitator settle-permissions \
  --settle-permissions-params settle.json
```

**settle.json**:

```json
{
  "planId": "did:nvm:abc123",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "creditsBurned": 5,
  "executionId": "exec-20240315-001",
  "metadata": {
    "requestType": "chat",
    "duration": 1234,
    "tokensUsed": 500
  }
}
```

Output:

```
Credits Settled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan ID: did:nvm:abc123
Credits Burned: 5
Previous Balance: 100
New Balance: 95
Transaction Hash: 0x1234567890abcdef...
Execution ID: exec-20240315-001
Status: Confirmed
```

### Batch Verification

Verify multiple requests at once:

```bash
#!/bin/bash
# Batch permission verification

REQUESTS=("request1.json" "request2.json" "request3.json")

for REQUEST in "${REQUESTS[@]}"; do
  echo "Verifying $REQUEST..."
  RESULT=$(nvm facilitator verify-permissions \
    --verify-permissions-params $REQUEST \
    --format json)

  CAN_PROCEED=$(echo $RESULT | jq -r '.canProceed')

  if [ "$CAN_PROCEED" = "true" ]; then
    echo "✅ Valid - Processing request"
    # Process request here
  else
    echo "❌ Invalid - Rejecting request"
  fi
done
```

## Organizations Commands

Manage organization members and settings.

### Create Organization Member

Add a new member to your organization:

```bash
nvm organizations create-member \
  --member-data member.json
```

**member.json**:

```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "role": "developer",
  "permissions": ["read", "write"],
  "metadata": {
    "name": "John Doe",
    "email": "john@example.com",
    "department": "Engineering"
  }
}
```

Output:

```
Member Created
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Member ID: member-123
Address: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Role: developer
Permissions: read, write
Status: Active
```

### List Organization Members

View all members in your organization:

```bash
nvm organizations get-members
```

Output:

```
Organization Members
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Name            Address          Role          Status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
John Doe        0x742d35...      developer     Active
Jane Smith      0x8f3a21...      admin         Active
Bob Wilson      0x1c5e92...      viewer        Active
```

### Update Member Role

Modify a member's role or permissions:

```bash
nvm organizations update-member <member-id> \
  --member-data updated-member.json
```

**updated-member.json**:

```json
{
  "role": "admin",
  "permissions": ["read", "write", "delete", "admin"]
}
```

### Remove Member

Remove a member from the organization:

```bash
nvm organizations remove-member <member-id>
```

## X402 Token Commands

### Get X402 Access Token

Generate an access token for a plan:

```bash
nvm x402token get-x402-access-token <plan-id>
```

Example:

```bash
nvm x402token get-x402-access-token did:nvm:abc123
```

Output:

```
X402 Access Token
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Plan ID: did:nvm:abc123
Issued: 2024-03-15 10:30:00 UTC
Expires: 2024-03-15 11:30:00 UTC
Credits: 100
```

### Save Token

Save token for later use:

```bash
# Save to file
nvm x402token get-x402-access-token did:nvm:abc123 \
  --format json | jq -r '.token' > ~/.nvm/token.txt

# Save to environment variable
export X402_TOKEN=$(nvm x402token get-x402-access-token did:nvm:abc123 \
  --format json | jq -r '.token')
```

## Global Flags

All commands support these global flags:

### Format Flag

Control output format:

```bash
# Table output (default)
nvm plans list

# JSON output
nvm plans list --format json

# Quiet output (minimal)
nvm plans list --format quiet
```

### Profile Flag

Use a specific configuration profile:

```bash
# Use production profile
nvm --profile production plans list

# Use staging profile
nvm --profile staging agents list
```

### Verbose Flag

Enable verbose output with detailed logging:

```bash
nvm plans order-plan did:nvm:abc123 --verbose
```

Output includes:
- Request/response details
- API calls made
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
# env-switch.sh - Switch CLI environment

case $1 in
  staging)
    nvm config set activeProfile staging
    nvm config set environment staging_sandbox
    echo "Switched to staging environment"
    ;;
  production)
    nvm config set activeProfile production
    nvm config set environment live
    echo "Switched to production environment"
    ;;
  sandbox)
    nvm config set activeProfile sandbox
    nvm config set environment sandbox
    echo "Switched to sandbox environment"
    ;;
  *)
    echo "Usage: $0 {staging|production|sandbox}"
    exit 1
    ;;
esac

nvm config show
```

Usage:

```bash
./env-switch.sh staging
./env-switch.sh production
```

### Backup Configuration

Backup your CLI configuration:

```bash
#!/bin/bash
# backup-config.sh

CONFIG_FILE=~/.config/nvm/config.json
BACKUP_DIR=~/.config/nvm/backups
BACKUP_FILE=$BACKUP_DIR/config-$(date +%Y%m%d-%H%M%S).json

mkdir -p $BACKUP_DIR
cp $CONFIG_FILE $BACKUP_FILE

echo "Configuration backed up to: $BACKUP_FILE"
```

### Restore Configuration

Restore from backup:

```bash
#!/bin/bash
# restore-config.sh

BACKUP_DIR=~/.config/nvm/backups
CONFIG_FILE=~/.config/nvm/config.json

# List available backups
echo "Available backups:"
ls -1 $BACKUP_DIR

# Prompt for backup to restore
read -p "Enter backup filename: " BACKUP_NAME

if [ -f "$BACKUP_DIR/$BACKUP_NAME" ]; then
  cp "$BACKUP_DIR/$BACKUP_NAME" $CONFIG_FILE
  echo "Configuration restored from: $BACKUP_NAME"
  nvm config show
else
  echo "Backup file not found"
  exit 1
fi
```

### Multi-Profile Operations

Run commands across multiple profiles:

```bash
#!/bin/bash
# multi-profile.sh - Run command across all profiles

PROFILES=("staging" "production" "sandbox")
COMMAND="$@"

for PROFILE in "${PROFILES[@]}"; do
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Profile: $PROFILE"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  nvm --profile $PROFILE $COMMAND
  echo ""
done
```

Usage:

```bash
./multi-profile.sh plans list
./multi-profile.sh agents list
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
            --agent-api https://api.example.com \
            --payment-plans ${{ secrets.PLAN_ID }}

      - name: Verify Agent
        run: |
          AGENT_ID=$(cat agent-id.txt)
          nvm agents get-agent $AGENT_ID
```

### Monitoring Script

Monitor your resources:

```bash
#!/bin/bash
# monitor.sh - Monitor plans, agents, and balances

echo "Nevermined Resources Monitor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Configuration
echo "Current Configuration:"
nvm config show
echo ""

# Plans
echo "Active Plans:"
nvm plans list
echo ""

# Agents
echo "Registered Agents:"
nvm agents list
echo ""

# Balances
echo "Plan Balances:"
PLANS=$(nvm plans list --format json | jq -r '.[].id')
for PLAN in $PLANS; do
  echo "  $PLAN:"
  nvm plans get-plan-balance $PLAN | grep "Credits"
done
```

## Best Practices

### 1. Use Profiles for Environments

Separate configurations for different environments:

```bash
# Development
nvm --profile dev plans list

# Production
nvm --profile prod plans list
```

### 2. Secure Your API Keys

Never commit API keys to version control:

```bash
# Use environment variables
export NVM_API_KEY=nvm-xxxxxxxx...

# Or secure config files
chmod 600 ~/.config/nvm/config.json
```

### 3. Automate Repetitive Tasks

Create scripts for common operations:

```bash
# Daily backup
0 0 * * * /path/to/backup-config.sh

# Weekly report
0 9 * * 1 /path/to/monitor.sh | mail -s "Weekly Report" you@example.com
```

### 4. Use JSON Output for Scripting

Always use `--format json` in scripts:

```bash
PLAN_DATA=$(nvm plans get-plan did:nvm:abc123 --format json)
PLAN_NAME=$(echo $PLAN_DATA | jq -r '.name')
```

## Common Issues

### "Config file not found"

Initialize configuration:

```bash
nvm config init
```

### "Invalid profile"

Check available profiles:

```bash
cat ~/.config/nvm/config.json | jq '.profiles | keys'
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
