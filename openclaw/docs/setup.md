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
    "nevermined": {
      "nvmApiKey": "sandbox:eyJhbG...",
      "environment": "sandbox",
      "planId": "did:nv:abc123...",
      "agentId": "did:nv:def456...",
      "creditsPerRequest": 1
    }
  }
}
```

### Configuration Fields

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `nvmApiKey` | No | — | Your Nevermined API key. Can be set via `/nvm-login` instead. |
| `environment` | No | `sandbox` | Target environment: `sandbox` for testing, `live` for production. |
| `planId` | No | — | Default payment plan ID. When set, subscriber tools use this plan automatically. |
| `agentId` | No | — | Default agent ID. Required for plans with multiple agents. |
| `creditsPerRequest` | No | `1` | Number of credits consumed per request. |

### Environment Details

| Environment | Description | Use Case |
|-------------|-------------|----------|
| `sandbox` | Test environment on Arbitrum Sepolia | Development, testing, integration |
| `live` | Production environment on Arbitrum One | Live deployments with real payments |

## Authentication Flow

The plugin supports a browser-based login flow identical to the [Nevermined CLI](/docs/api-reference/cli/getting-started):

1. User sends `/nvm-login` in any chat channel (or calls `nevermined.login`)
2. The plugin starts a local HTTP server on a random port
3. A browser window opens to the Nevermined login page
4. After authentication, Nevermined redirects back with the API key
5. The key is stored in the gateway config via `api.setConfig()`

The login times out after 5 minutes if no authentication is received.

### Logging Out

Send `/nvm-logout` or call `nevermined.logout` to remove the stored API key. All payment tools will require re-authentication after logout.

## Default Values

When `planId` and `agentId` are set in the config, all subscriber tools (`checkBalance`, `getAccessToken`, `orderPlan`, `queryAgent`) use them as defaults. You can always override them per-call by passing the parameter explicitly.

This is useful for gateways that serve a single plan — configure it once and all tools work without extra parameters.
