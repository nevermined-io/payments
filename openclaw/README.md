# @nevermined-io/openclaw-plugin

OpenClaw plugin for [Nevermined](https://nevermined.io) — exposes AI agent payment operations as gateway tools callable from any OpenClaw channel (Telegram, Discord, WhatsApp, etc.).

## Installation

```bash
openclaw plugin install @nevermined-io/openclaw-plugin
```

## Configuration

Add the Nevermined plugin config to your `openclaw.json`:

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

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | Yes | — | Your Nevermined API key |
| `environment` | No | `sandbox` | `sandbox` or `live` |
| `planId` | No | — | Default plan ID for subscriber tools |
| `agentId` | No | — | Default agent ID for multi-agent plans |
| `creditsPerRequest` | No | `1` | Credits consumed per request |

## Available Tools

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
