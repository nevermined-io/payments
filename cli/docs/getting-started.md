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
- **npm** or **pnpm** package manager
- A Nevermined account with API key

## Getting Your API Key

To interact with the Nevermined API, you need an API key. Follow the [Get Your API Key](/docs/getting-started/get-your-api-key) guide to create one.

## Installation

### Option 1: Global Installation (Recommended)

Install the CLI globally to use the `nevermined` command from anywhere:

```bash
npm install -g @nevermined-io/cli
```

Verify installation:

```bash
nevermined --version
```

> **Renamed from `nvm`**: earlier versions installed the binary as `nvm`, which collided with [Node Version Manager](https://github.com/nvm-sh/nvm). The command is now `nevermined`. Update any scripts that called `nvm <command>`.

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
pnpm install

# Build the project
pnpm build:manifest

# Run the CLI
./bin/run.js --help
```

## Authentication

### Browser Login (Recommended)

The quickest way to authenticate:

```bash
nevermined login
```

This opens your browser to sign in with Google, X, or email. After login,
your API key is automatically captured and saved to your CLI config.

Options:
- `--environment <env>` — Target environment (default: sandbox)
- `--profile <name>` — Config profile to save to (default: default)
- `--no-browser` — Print the login URL instead of opening the browser

Examples:

```bash
nevermined login --environment live
nevermined login --profile production --environment live
nevermined login --no-browser
```

### Logout

Remove your API key from the CLI config:

```bash
nevermined logout
nevermined logout --profile production
nevermined logout --all-profiles
```

## Configuration

### Interactive Setup

The easiest way to configure the CLI is using the interactive setup:

```bash
nevermined config init
```

This will prompt you for:
- **NVM API Key**: Your API key from nevermined.app
- **Environment**: Choose from:
  - `sandbox` - Testing (recommended for learning and development)
  - `live` - Production environment

Example:

```bash
$ nevermined config init

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
nevermined config init

# Create a production profile
nevermined config set profiles.production.nvmApiKey nvm-yyyyyyyy...
nevermined config set profiles.production.environment live

# Switch active profile
nevermined config set activeProfile production
```

Use a specific profile for a command:

```bash
nevermined --profile production plans get-plans
```

### Environment Variables

Override configuration with environment variables:

```bash
# Set API key
export NVM_API_KEY=sandbox:eyJxxxxaaaabbbbbbbb

# Set environment
export NVM_ENVIRONMENT=sandbox

# Run commands
nevermined plans get-plans
```

This is useful for:
- CI/CD pipelines
- Temporary configuration changes
- Scripting

### View Configuration

Display your current configuration:

```bash
nevermined config show
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
nevermined plans get-plans
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

### "Command not found: nevermined"

After global installation, if `nevermined` command is not found:

1. Verify installation: `npm list -g @nevermined-io/cli`
2. Check your PATH includes npm global bin directory
3. Restart your terminal
4. Try using the full path: `npx @nevermined-io/cli`

### "API Key not found"

If you get an API key error:

```bash
# Browser login (recommended)
nevermined login

# Or initialize configuration manually
nevermined config init

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
nevermined --help

# Topic help
nevermined plans --help

# Command help
nevermined plans get-plan --help
```

For support:
- Documentation: https://nevermined.ai/docs
- Issues: https://github.com/nevermined-io/payments/issues
- Discord: https://discord.gg/GZju2qScKq
