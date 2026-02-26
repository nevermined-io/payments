---
title: "Setup"
description: "Full configuration reference for the Nevermined OpenClaw plugin"
icon: "gear"
---

# Setup

## Configuration

The plugin reads its configuration from the `plugins.nevermined` section of your `openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "nevermined": {
        "enabled": true,
        "config": {
          "nvmApiKey": "sandbox:eyJhbG...",
          "environment": "sandbox",
          "planId": "did:nv:abc123...",
          "agentId": "did:nv:def456...",
          "creditsPerRequest": 1,
          "enablePaidEndpoint": false,
          "agentEndpointPath": "/nevermined/agent",
          "paymentType": "crypto",
          "defaultSpendingLimitCents": 1000,
          "defaultDelegationDurationSecs": 3600
        }
      }
    }
  }
}
```

### Configuration Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | No | — | Your Nevermined API key. Can be set via `/nvm_login` instead. |
| `environment` | No | `sandbox` | Target environment: `sandbox` for testing, `live` for production. |
| `planId` | No | — | Default payment plan ID. When set, subscriber tools use this plan automatically. |
| `agentId` | No | — | Default agent ID. Required for plans with multiple agents. |
| `creditsPerRequest` | No | `1` | Number of credits consumed per request. |
| `enablePaidEndpoint` | No | `false` | Enable the x402 paid HTTP endpoint on the gateway. |
| `agentEndpointPath` | No | `/nevermined/agent` | HTTP path for the paid agent endpoint. |
| `paymentType` | No | `crypto` | Default payment type: `crypto` (nvm:erc4337) or `fiat` (nvm:card-delegation). |
| `defaultSpendingLimitCents` | No | `1000` | Default max spend in cents ($10) for fiat payments. |
| `defaultDelegationDurationSecs` | No | `3600` | Default delegation duration in seconds (1 hour) for fiat payments. |

### Environment Details

| Environment | Description | Use Case |
|-------------|-------------|----------|
| `sandbox` | Test environment on Arbitrum Sepolia | Development, testing, integration |
| `live` | Production environment on Arbitrum One | Live deployments with real payments |

## Authentication Flow

The plugin supports a browser-based login flow identical to the [Nevermined CLI](/docs/api-reference/cli/getting-started):

1. User sends `/nvm_login` in any chat channel
2. The plugin starts a local HTTP server on a random port
3. A browser window opens to the Nevermined login page
4. After authentication, Nevermined redirects back with the API key
5. The key is stored in the plugin's in-memory config for the current session

The login times out after 5 minutes if no authentication is received.

### Logging Out

Send `/nvm_logout` or call `nvm_logout` to remove the stored API key. All payment tools will require re-authentication after logout.

## Default Values

When `planId` and `agentId` are set in the config, all subscriber tools (`checkBalance`, `getAccessToken`, `orderPlan`, `queryAgent`) use them as defaults. You can always override them per-call by passing the parameter explicitly.

This is useful for gateways that serve a single plan — configure it once and all tools work without extra parameters.
