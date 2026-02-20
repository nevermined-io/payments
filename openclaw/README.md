# @nevermined-io/openclaw-plugin

OpenClaw plugin for [Nevermined](https://nevermined.io) — exposes AI agent payment operations as gateway tools callable from any OpenClaw channel (Telegram, Discord, WhatsApp, etc.).

## Installation

```bash
openclaw plugin install @nevermined-io/openclaw-plugin
```

## Authentication

The plugin supports two ways to provide your Nevermined API key:

### Option A: Browser login (recommended)

Use the `/nvm-login` command from any chat channel, or call the `nevermined.login` gateway method. This opens a browser window where you authenticate with Nevermined, and the API key is captured automatically.

```
/nvm-login          # Login to sandbox (default)
/nvm-login live     # Login to live environment
/nvm-logout         # Remove stored API key
```

### Option B: Manual configuration

Add your API key directly to `openclaw.json`:

```json
{
  "plugins": {
    "nevermined": {
      "nvmApiKey": "sandbox:eyJhbG...",
      "environment": "sandbox",
      "planId": "did:nv:abc123",
      "agentId": "did:nv:def456",
      "creditsPerRequest": 1
    }
  }
}
```

## Configuration

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | No | — | Your Nevermined API key (or use `/nvm-login`) |
| `environment` | No | `sandbox` | `sandbox` or `live` |
| `planId` | No | — | Default plan ID for subscriber tools |
| `agentId` | No | — | Default agent ID for multi-agent plans |
| `creditsPerRequest` | No | `1` | Credits consumed per request |

## Available Tools

### Authentication

| Tool / Command | Description |
|----------------|-------------|
| `nevermined.login` / `/nvm-login` | Authenticate via browser login |
| `nevermined.logout` / `/nvm-logout` | Remove stored API key |

### Subscriber Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `nevermined.checkBalance` | Check credit balance for a plan | `planId` |
| `nevermined.getAccessToken` | Get an x402 access token | `planId`, `agentId` |
| `nevermined.orderPlan` | Purchase a payment plan | `planId` |
| `nevermined.queryAgent` | Query an agent end-to-end | `agentUrl`, `prompt`, `planId`, `agentId` |

### Builder Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `nevermined.registerAgent` | Register an agent with a plan | `name`, `agentUrl`, `planName`, `priceAmounts`, `priceReceivers`, `creditsAmount` |
| `nevermined.createPlan` | Create a payment plan | `name`, `priceAmounts`, `priceReceivers`, `creditsAmount` |
| `nevermined.listPlans` | List your plans | — |

## Documentation

- [Nevermined Docs](https://docs.nevermined.app)
- [Payments SDK](https://github.com/nevermined-io/payments)

## License

Apache-2.0
