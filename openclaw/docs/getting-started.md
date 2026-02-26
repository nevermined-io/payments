---
title: "Getting Started"
description: "Install and configure the Nevermined OpenClaw plugin in minutes"
icon: "rocket"
---

# Getting Started

The Nevermined OpenClaw plugin exposes AI agent payment operations as gateway tools callable from any OpenClaw channel — Telegram, Discord, WhatsApp, and more.

## Prerequisites

- An [OpenClaw](https://openclaw.ai) gateway instance
- Node.js >= 18.0.0
- A [Nevermined account](https://nevermined.app) (free to create)

## Installation

Install the plugin from your OpenClaw gateway:

```bash
openclaw plugin install @nevermined-io/openclaw-plugin
```

## Authentication

<Note>
To interact with the Nevermined API, you need an API key. Follow the [Get Your API Key](/docs/getting-started/get-your-api-key) guide to create one.
</Note>

### Option A: Browser login (recommended)

Use the `/nvm_login` command from any connected chat channel:

```
/nvm_login
```

This opens a browser window where you authenticate with Nevermined. The API key is captured automatically and stored in your gateway config.

To target the live environment:

```
/nvm_login live
```

To use a specific API key:

```
/nvm_login sandbox:eyJhbG...
```

### Option B: Manual configuration

Add your API key directly to `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "nevermined": {
        "enabled": true,
        "config": {
          "nvmApiKey": "sandbox:eyJhbG...",
          "environment": "sandbox"
        }
      }
    }
  }
}
```

## Quick Test

After authenticating, verify the plugin is working:

1. **Check your balance** — from any chat channel, the agent can ask `Example prompt: “How many credits do I have left on my plan?”` to verify connectivity.

2. **List plans** — you can ask `Example prompt: Show me all my payment plans”` to see available payment plans.

## Fiat Payments

The plugin also supports fiat payments via credit card delegation. Enroll a card at [nevermined.app](https://nevermined.app), then use `paymentType: fiat` with any token or query tool. See the [guide](./guide.md#fiat-payments-credit-card) for details.

## Next Steps

- [Setup](/docs/api-reference/openclaw-plugin/setup) — full configuration reference
- [Commands](/docs/api-reference/openclaw-plugin/commands) — all available tools and slash commands
