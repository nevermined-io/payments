# @nevermined-io/openclaw-plugin

OpenClaw plugin for [Nevermined](https://nevermined.io) — exposes AI agent payment operations as gateway tools callable from any OpenClaw channel (Telegram, Discord, WhatsApp, etc.).

## Installation

```bash
openclaw plugin install @nevermined-io/openclaw-plugin
```

## Authentication

The plugin supports two ways to provide your Nevermined API key:

### Option A: Slash command (recommended)

Use the `/nvm_login` command from any chat channel. This opens a browser window where you authenticate with Nevermined, and the API key is captured automatically.

```
/nvm_login              # Login to sandbox (default)
/nvm_login live         # Login to live environment
/nvm_login <api-key>    # Paste an API key directly
/nvm_logout             # Remove stored API key
```

On headless servers where a browser can't open, the command provides manual instructions with a login URL.

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
          "environment": "sandbox",
          "planId": "<your-plan-id>",
          "agentId": "<your-agent-id>",
          "creditsPerRequest": 1,
          "enablePaidEndpoint": false,
          "agentEndpointPath": "/nevermined/agent"
        }
      }
    }
  }
}
```

## Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | No | — | Your Nevermined API key (or use `/nvm_login`) |
| `environment` | No | `sandbox` | `sandbox` or `live` |
| `planId` | No | — | Default plan ID for subscriber tools |
| `agentId` | No | — | Default agent ID for multi-agent plans |
| `creditsPerRequest` | No | `1` | Credits consumed per request |
| `enablePaidEndpoint` | No | `false` | Enable the x402 paid HTTP endpoint on the gateway |
| `agentEndpointPath` | No | `/nevermined/agent` | HTTP path for the paid agent endpoint |

## Available Tools

### Slash Commands

| Command | Description |
|---------|-------------|
| `/nvm_login [environment]` | Authenticate via browser login or paste an API key |
| `/nvm_logout` | Remove stored API key |

### Subscriber Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `nevermined_checkBalance` | Check credit balance for a plan | `planId` |
| `nevermined_getAccessToken` | Get an x402 access token | `planId`, `agentId` |
| `nevermined_orderPlan` | Purchase a payment plan | `planId` |
| `nevermined_queryAgent` | Query an agent end-to-end | `agentUrl`, `prompt`, `planId`, `agentId` |

### Builder Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `nevermined_registerAgent` | Register an agent with a plan | `name`, `agentUrl`, `planName`, `priceAmounts`, `priceReceivers`, `creditsAmount`, `tokenAddress` |
| `nevermined_createPlan` | Create a payment plan | `name`, `priceAmounts`, `priceReceivers`, `creditsAmount`, `tokenAddress` |
| `nevermined_listPlans` | List your plans | — |

## Documentation

- [User Guide](./guide.md) — step-by-step tutorial building a paid Weather Oracle agent
- [Commands Reference](./commands.md) — full parameter documentation for all tools
- [Setup Reference](./setup.md) — detailed configuration options
- [Nevermined Docs](https://nevermined.ai/docs)
- [Payments SDK](https://github.com/nevermined-io/payments)

## License

Apache-2.0
