---
title: "Building a Paid AI Agent with OpenClaw and Nevermined"
description: "Step-by-step guide to building, monetizing, and querying a paid AI agent using the Nevermined OpenClaw plugin"
icon: "book-open"
---

# Building a Paid AI Agent with OpenClaw and Nevermined

The Nevermined OpenClaw plugin lets you monetize AI agents directly from chat channels. Subscribers pay per-request using the [x402 payment protocol](https://nevermined.ai/docs/api-reference/typescript/x402-protocol), and builders collect revenue automatically through on-chain payment plans.

This guide walks through building a **Weather Oracle** — a paid agent that serves weather forecasts and charges 1 credit per request.

## What You Get

The plugin adds 7 payment tools and 2 slash commands to your OpenClaw gateway:

**Subscriber tools** — for users who consume paid services:

| Tool | Purpose |
|------|---------|
| `nevermined_checkBalance` | Check remaining credits on a plan |
| `nevermined_getAccessToken` | Get an x402 token for authenticating requests |
| `nevermined_orderPlan` | Purchase a payment plan |
| `nevermined_queryAgent` | Send a paid query to an agent (end-to-end) |

**Builder tools** — for developers who create paid services:

| Tool | Purpose |
|------|---------|
| `nevermined_registerAgent` | Register an agent with a payment plan |
| `nevermined_createPlan` | Create a standalone payment plan |
| `nevermined_listPlans` | List your payment plans |

**Slash commands**: `/nvm_login` and `/nvm_logout` for authentication.

**Paid HTTP endpoint**: An x402-compatible endpoint on the gateway that handles payment verification, request processing, and credit settlement automatically.

## Prerequisites

- An [OpenClaw](https://openclaw.ai) gateway instance (v2026.2+)
- Node.js >= 18
- A [Nevermined account](https://nevermined.app) with an API key

## Step 1: Install the Plugin

From your OpenClaw gateway server:

```bash
openclaw plugin install @nevermined-io/openclaw-plugin
```

Or install manually by placing the package in `~/.openclaw/extensions/nevermined/`.

After installation, restart the gateway:

```bash
openclaw gateway restart
```

You should see in the logs:

```
Registered 7 Nevermined payment tools
```

## Step 2: Authenticate

Send `/nvm_login` from any connected chat channel (Telegram, Discord, etc.). The plugin supports two flows:

**Browser login** (if your server has a display):

```
/nvm_login
```

A browser window opens for Nevermined authentication. The API key is captured automatically.

**Manual login** (headless servers):

```
/nvm_login sandbox:eyJhbGciOiJFUzI1NksifQ...
```

Paste your API key directly. Get one from [Nevermined App](https://nevermined.app) under Settings > API Keys.

Use `sandbox` for testing, `live` for production.

## Step 3: Register Your Agent and Payment Plan

Ask your Claw to register an agent. In any chat channel, send a message like:

> Register a Nevermined agent called "Weather Oracle" at URL `https://my-gateway.example.com/nevermined/agent` with a plan named "Weather Forecast" priced at 1000000 (1 USDC) to address `0xYourWalletAddress` with token `0x036CbD53842c5426634e7929541eC2318f3dCF7e` granting 5 credits.

The agent will call `nevermined_registerAgent` with these parameters:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `name` | Weather Oracle | Display name on Nevermined |
| `agentUrl` | `https://my-gateway.example.com/nevermined/agent` | Public URL of your paid endpoint |
| `planName` | Weather Forecast | Name for the payment plan |
| `priceAmounts` | `1000000` | Price in token units (1 USDC = 1,000,000 wei) |
| `priceReceivers` | `0xYourWalletAddress` | Your wallet that receives payments |
| `creditsAmount` | `5` | Credits granted per purchase |
| `tokenAddress` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | USDC on Base Sepolia. Omit for native token. |

The tool returns the `agentId` and `planId` — save these for the next step.

## Step 4: Enable the Paid Endpoint

Add the returned IDs and enable the paid endpoint in your gateway config (`~/.openclaw/openclaw.json`):

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
          "enablePaidEndpoint": true,
          "agentEndpointPath": "/nevermined/agent",
          "creditsPerRequest": 1
        }
      }
    }
  }
}
```

Restart the gateway. You should see:

```
Registered 7 Nevermined payment tools
Registered paid endpoint at /nevermined/agent
```

The paid endpoint handles the full x402 lifecycle:

1. Extracts the `payment-signature` header from incoming requests
2. Calls `verifyPermissions` to check the subscriber has credits
3. Processes the request (runs your agent handler)
4. Calls `settlePermissions` to burn credits
5. Returns the response with a `payment-response` header

### Configuration Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | No | — | API key (set via `/nvm_login` or config) |
| `environment` | No | `sandbox` | `sandbox` for testing, `live` for production |
| `planId` | No | — | Default plan ID for tools and the paid endpoint |
| `agentId` | No | — | Default agent ID |
| `creditsPerRequest` | No | `1` | Credits burned per request |
| `enablePaidEndpoint` | No | `false` | Enable the x402 paid HTTP endpoint |
| `agentEndpointPath` | No | `/nevermined/agent` | Path for the paid endpoint |

## Step 5: Test as a Subscriber

From the same gateway (or a different one with a subscriber API key), test the full flow:

### Order the plan

> Order the Weather Oracle plan `<plan-id>`

The Claw calls `nevermined_orderPlan`. You receive 5 credits.

### Check your balance

> Check my Nevermined balance for plan `<plan-id>`

Should show 5 credits.

### Query the agent

> Ask the Weather Oracle at `http://localhost:18789/nevermined/agent` about the weather in Barcelona

The Claw calls `nevermined_queryAgent`, which:
1. Acquires an x402 access token
2. Sends the prompt with a `PAYMENT-SIGNATURE` header
3. The paid endpoint verifies, processes, and settles
4. Returns the weather forecast

### Verify credit burn

> Check my balance again

Should show 4 credits — one was consumed.

## Custom Agent Handlers

The plugin includes a mock weather handler for demonstration. To use your own logic, pass a custom `agentHandler` when registering the plugin:

```typescript
import neverminedPlugin from '@nevermined-io/openclaw-plugin'

neverminedPlugin.register(api, {
  agentHandler: async (body) => {
    const response = await myAIModel.generate(body.prompt)
    return { result: response }
  },
})
```

The handler receives `{ prompt: string }` and returns any JSON-serializable object.

## Credit Balance Awareness

When the plugin is authenticated and a `planId` is configured, it automatically injects the current credit balance into the agent's context before each prompt. This means your Claw can proactively warn users when credits are running low:

> "You have 2 credits remaining on the Weather Forecast plan. Consider ordering more credits."

The balance is cached for 60 seconds to avoid excessive API calls.

## How It Works

The plugin implements the [x402 payment protocol](https://nevermined.ai/docs/api-reference/typescript/x402-protocol) for agent-to-agent payments:

```
Subscriber Claw                    Builder Claw (Gateway)
      │                                     │
      │  1. getX402AccessToken(planId)       │
      │─────────────────────────────────────>│  Nevermined API
      │<─────────────────────────────────────│  returns token
      │                                     │
      │  2. POST /nevermined/agent           │
      │     Header: payment-signature: token │
      │     Body: { prompt: "..." }          │
      │─────────────────────────────────────>│
      │                                     │  3. verifyPermissions()
      │                                     │  4. Process request
      │                                     │  5. settlePermissions()
      │  6. Response + payment-response hdr  │
      │<─────────────────────────────────────│
```

Credits are managed on-chain through the Nevermined Protocol. The `verifyPermissions` step checks the subscriber's balance without burning credits, and `settlePermissions` burns them only after successful processing.

## Next Steps

- [Commands Reference](./commands.md) — full parameter documentation for all tools
- [Setup Reference](./setup.md) — detailed configuration options
- [Nevermined Docs](https://nevermined.ai/docs) — platform documentation
- [x402 Protocol](https://nevermined.ai/docs/api-reference/typescript/x402-protocol) — payment protocol specification
- [OpenClaw Plugin Development](https://docs.openclaw.ai/tools/plugin) — building OpenClaw plugins
