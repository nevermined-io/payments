---
title: "Getting Started"
description: "Complete guide to installing and configuring the Nevermined CLI"
icon: "rocket"
---

# Getting Started

Complete guide to installing and configuring the Nevermined CLI.

## Prerequisites

Before installing the CLI, ensure you have:

- **Node.js** >= 18.0.0
- **npm** or **yarn** package manager
- A Nevermined account with API key

## Getting Your API Key

1. Visit [nevermined.app](https://nevermined.app) and sign in
2. Navigate to your account settings
3. Generate a new API key from the "API Keys" section
4. Save your API key securely - you'll need it for CLI configuration

The API key format is: `live:eyJxxxxaaaa`

## Installation

### Option 1: Global Installation (Recommended)

Install the CLI globally to use the `nvm` command from anywhere:

```bash
npm install -g @nevermined-io/cli
```

Verify installation:

```bash
nvm --version
```

### Option 2: Using npx (No Installation)

Run the CLI without installing:

```bash
npx @nevermined-io/cli --help
```

This is useful for one-off commands or trying the CLI before installing.

### Option 3: From Source

For development or contributing:

```bash
# Clone the repository
git clone https://github.com/nevermined-io/payments
cd payments/cli

# Install dependencies
yarn install

# Build the project
yarn build:manifest

# Run the CLI
./bin/run.js --help
```

## Authentication

### Browser Login (Recommended)

The quickest way to authenticate:

```bash
nvm login
```

This opens your browser to sign in with Google, X, or email. After login,
your API key is automatically captured and saved to your CLI config.

Options:
- `--environment <env>` — Target environment (default: sandbox)
- `--profile <name>` — Config profile to save to (default: default)
- `--no-browser` — Print the login URL instead of opening the browser

Examples:

```bash
nvm login --environment live
nvm login --profile production --environment live
nvm login --no-browser
```

### Logout

Remove your API key from the CLI config:

```bash
nvm logout
nvm logout --profile production
nvm logout --all-profiles
```

## Configuration

### Interactive Setup

The easiest way to configure the CLI is using the interactive setup:

```bash
nvm config init
```

This will prompt you for:
- **NVM API Key**: Your API key from nevermined.app
- **Environment**: Choose from:
  - `sandbox` - Testing (recommended for learning and development)
  - `live` - Production environment

Example:

```bash
$ nvm config init

? Enter your NVM API Key: sandbox:eyJxxxxaaaabbbbbbbb
? Select environment: sandbox

✅ Configuration saved to /home/user/.config/nvm/config.json
```

### Configuration File

The CLI stores configuration in `~/.config/nvm/config.json`:

```json
{
  "profiles": {
    "default": {
      "nvmApiKey": "live:eyJxxxxaaaabbbbbbbb",
      "environment": "live"
    }
  },
  "activeProfile": "default"
}
```

### Multiple Profiles

Create multiple profiles for different environments or accounts:

```bash
# Initialize with default profile
nvm config init

# Create a production profile
nvm config set profiles.production.nvmApiKey nvm-yyyyyyyy...
nvm config set profiles.production.environment live

# Switch active profile
nvm config set activeProfile production
```

Use a specific profile for a command:

```bash
nvm --profile production plans get-plans
```

### Environment Variables

Override configuration with environment variables:

```bash
# Set API key
export NVM_API_KEY=sandbox:eyJxxxxaaaabbbbbbbb

# Set environment
export NVM_ENVIRONMENT=sandbox

# Run commands
nvm plans get-plans
```

This is useful for:
- CI/CD pipelines
- Temporary configuration changes
- Scripting

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
Environment:    sandbox
API Key:        live:eyJxxxxaaaabbbbbbbb (truncated)
```

## Verify Setup

Test your configuration by listing available plans:

```bash
nvm plans get-plans
```

If configured correctly, you should see a table of available payment plans.

## Environment Guide

Choose the right environment for your use case:

| Environment | Use Case | Blockchain | Payments |
|-------------|----------|------------|----------|
| `sandbox` | Development, learning, testing | Test network | Test credits |
| `live` | Production | Mainnet | Real payments |

**Recommendation**: Start with `sandbox` for development and testing.

## Common Issues

### "Command not found: nvm"

After global installation, if `nvm` command is not found:

1. Verify installation: `npm list -g @nevermined-io/cli`
2. Check your PATH includes npm global bin directory
3. Restart your terminal
4. Try using the full path: `npx @nevermined-io/cli`

### "API Key not found"

If you get an API key error:

```bash
# Browser login (recommended)
nvm login

# Or initialize configuration manually
nvm config init

# Or set environment variable
export NVM_API_KEY=your-api-key-here
```

### Permission Errors

If you get permission errors during global installation:

```bash
# Use npx instead
npx @nevermined-io/cli --help

# Or install without sudo using nvm/volta
```

## Next Steps

Now that you've installed and configured the CLI, explore:

- [Plans](./plans.md) - Create and manage payment plans
- [Agents](./agents.md) - Register AI agents
- [Purchases](./purchases.md) - Order plans and make payments
- [Querying](./querying.md) - Query agents with access tokens

## Getting Help

Get help for any command:

```bash
# General help
nvm --help

# Topic help
nvm plans --help

# Command help
nvm plans get-plan --help
```

For support:
- Documentation: https://nevermined.ai/docs
- Issues: https://github.com/nevermined-io/payments/issues
- Discord: https://discord.gg/nevermined
