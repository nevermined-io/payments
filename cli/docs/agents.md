---
title: "Managing AI Agents"
description: "Complete guide to registering and managing AI agents with the Nevermined CLI"
icon: "robot"
---

# Managing AI Agents

Complete guide to registering and managing AI agents with the Nevermined CLI.

## Overview

AI agents are services that users can access by purchasing payment plans. Agents can be:
- **AI assistants**: Chat-based conversational agents
- **API services**: REST APIs with metered access
- **Data pipelines**: Processing services with usage tracking
- **Tools**: Utility services with pay-per-use billing

## Listing Agent Plans

Get the list of plans that can be ordered to access an agent:

```bash
nevermined agents get-agent-plans <agent-id>

# With pagination
nevermined agents get-agent-plans <agent-id> --pagination '{"page": 1, "offset": 10}'

# JSON output
nevermined agents get-agent-plans <agent-id> --format json
```

## Getting Agent Details

Retrieve detailed information about a specific agent:

```bash
nevermined agents get-agent <agent-id>
```

Example:

```bash
nevermined agents get-agent "did:nvm:abc123"
```

Output includes:
- Agent metadata (name, description, creator)
- API endpoint configuration
- Associated payment plans

## Registering Agents

### Register Agent with Existing Plans

Register a new AI agent and associate it with one or more existing payment plans:

```bash
nevermined agents register-agent \
  --agent-metadata agent-metadata.json \
  --agent-api agent-api.json \
  --payment-plans "plan-id-1,plan-id-2"
```

`--agent-api` is a JSON object (`AgentAPIAttributes`), not a bare URL — pass a file or an inline JSON string. See [Config schemas](#config-schemas) for the full shape.

**agent-metadata.json**:

```json
{
  "name": "My AI Assistant",
  "description": "GPT-4 powered conversational AI with specialized knowledge",
  "version": "1.0.0",
  "author": "Your Name",
  "tags": ["ai", "assistant", "gpt4"],
  "customData": {
    "capabilities": ["chat", "code-generation", "analysis"],
    "model": "gpt-4",
    "language": "en"
  }
}
```

### Register Agent and Plan Together

Register a new AI agent and create a payment plan for it in a single command:

```bash
nevermined agents register-agent-and-plan \
  --agent-metadata agent-metadata.json \
  --agent-api agent-api.json \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

Optional flags:
- `--access-limit` — `credits` or `time`. When omitted, it is derived from the credits config: `time` if `durationSecs > 0`, otherwise `credits`.

Each `--*` flag accepts **either** a path to a `.json` file **or** an inline JSON string (anything ending in `.json` is read as a file; everything else is parsed as JSON). Note that `--agent-api` is a JSON **object** (`AgentAPIAttributes`), not a bare URL.

The four config flags map to the SDK types — see [Config schemas](#config-schemas) below for the full field reference and the helper commands that generate them.

**agent-api.json** (`AgentAPIAttributes`):

```json
{
  "endpoints": [{ "POST": "https://api.example.com/v1/agents/:agentId/tasks" }],
  "openEndpoints": ["https://api.example.com/v1/docs"],
  "authType": "bearer",
  "token": "your-upstream-bearer-token"
}
```

Only `endpoints` is commonly needed; `openEndpoints` and the auth fields (`authType`, `username`, `password`, `token`) are optional.

**plan-metadata.json** (`PlanMetadata`):

```json
{
  "name": "My Agent - Basic Plan",
  "description": "100 credits for API access",
  "tags": ["ai", "assistant", "basic"]
}
```

**price-config.json** (`PlanPriceConfig`) — a free plan (no charge to subscribe):

```json
{
  "isCrypto": true,
  "amounts": [],
  "receivers": [],
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "contractAddress": "0x0000000000000000000000000000000000000000",
  "feeController": "0x0000000000000000000000000000000000000000",
  "externalPriceAddress": "0x0000000000000000000000000000000000000000",
  "templateAddress": "0x0000000000000000000000000000000000000000"
}
```

To charge a fixed crypto price instead, set `amounts` to the price in the token's smallest unit and `receivers` to the wallet that collects it (this is what `nevermined plans get-native-token-price-config` / `get-erc20-price-config` emit):

```json
{
  "isCrypto": true,
  "amounts": [1000000],
  "receivers": ["0xYourReceiverWallet"],
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "contractAddress": "0x0000000000000000000000000000000000000000",
  "feeController": "0x0000000000000000000000000000000000000000",
  "externalPriceAddress": "0x0000000000000000000000000000000000000000",
  "templateAddress": "0x0000000000000000000000000000000000000000"
}
```

**credits-config.json** (`PlanCreditsConfig`) — grant 100 credits, burn 1 per request:

```json
{
  "isRedemptionAmountFixed": true,
  "redemptionType": 4,
  "onchainMirror": false,
  "durationSecs": 0,
  "amount": 100,
  "minAmount": 1,
  "maxAmount": 1
}
```

### Config schemas

`register-agent-and-plan` (and `nevermined plans register-credits-plan`) accept these JSON shapes. They match the SDK types exactly — the easiest way to produce a valid file is to run the matching `nevermined plans get-*-config` command and save its output, rather than hand-crafting the JSON.

#### `--price-config` (`PlanPriceConfig`)

| Field | Type | Notes |
|-------|------|-------|
| `isCrypto` | boolean | `true` for crypto/native/ERC-20 payments, `false` for fiat (Stripe/Braintree). Required. |
| `amounts` | number[] | Price(s) in the token's smallest unit (6-decimal units for USDC/EURC; `2000000` = $2.00). Empty `[]` for a free plan. |
| `receivers` | string[] | Wallet address(es) that collect the payment. Empty `[]` for a free plan. Same length as `amounts`. |
| `tokenAddress` | string | ERC-20 token address, or the zero address (`0x0000…0000`) for the native token / free / fiat plans. |
| `contractAddress` | string | Price-calculator contract. Zero address unless using a smart-contract price. |
| `feeController` | string | Fee-controller contract. Zero address uses the default. |
| `externalPriceAddress` | string | External price contract. Zero address when unused. |
| `templateAddress` | string | Template contract. Zero address except for pay-as-you-go plans. |
| `currency` | string | Optional: `USD`, `EUR`, `USDC`, or `EURC`. When omitted, the backend infers it from the payment type. |

Generators that emit this shape: `nevermined plans get-free-price-config`, `get-native-token-price-config`, `get-crypto-price-config`, `get-erc20-price-config`, `get-eurc-price-config`, `get-fiat-price-config`, `get-pay-as-you-go-price-config`.

#### `--credits-config` (`PlanCreditsConfig`)

| Field | Type | Notes |
|-------|------|-------|
| `isRedemptionAmountFixed` | boolean | `true` when every request burns a fixed number of credits (`minAmount == maxAmount`), `false` for a dynamic range. |
| `redemptionType` | number | Who may redeem credits: `0` = global burner role, `1` = plan owner, `2` = plan role, `4` = subscriber. SDK helpers use `4` (`ONLY_SUBSCRIBER`). |
| `onchainMirror` | boolean | `false` keeps the credit ledger off-chain (default). `true` mirrors each burn to the on-chain `NFT1155Credits` contract. |
| `durationSecs` | number | Plan lifetime in seconds. `0` = non-expirable (credit-limited). `> 0` makes it a time-limited plan. |
| `amount` | number | Credits granted when the plan is purchased. |
| `minAmount` | number | Minimum credits burned per request. |
| `maxAmount` | number | Maximum credits burned per request (equal to `minAmount` for fixed plans). |
| `nftAddress` | string | Optional: NFT contract representing the plan's credits. Normally omitted — assigned by the backend. |

Generators that emit this shape: `nevermined plans get-fixed-credits-config`, `get-dynamic-credits-config`, `get-expirable-duration-config`, `get-non-expirable-duration-config`, `get-pay-as-you-go-credits-config`.

#### `--agent-api` (`AgentAPIAttributes`)

| Field | Type | Notes |
|-------|------|-------|
| `endpoints` | object[] | Allowlist of paid upstream endpoints, each `{ "<HTTP-VERB>": "<url>" }` (e.g. `{ "POST": "https://…/:agentId/tasks" }`). Optional defense-in-depth on top of your library middleware. |
| `openEndpoints` | string[] | Endpoints that do **not** require a subscription (docs, health, etc.). Optional. |
| `agentDefinitionUrl` | string | Optional link to an OpenAPI spec, MCP manifest, or A2A agent card (metadata only). |
| `authType` | string | Upstream auth: `none`, `basic`, `bearer`, or `oauth`. Optional. |
| `username` / `password` | string | Upstream credentials when `authType` is `basic`. |
| `token` | string | Upstream bearer token when `authType` is `bearer` or `oauth`. |

The CLI passes this object straight to the SDK, which wraps it as `agentApiAttributes` in the request body — you supply the unwrapped `AgentAPIAttributes` shown above.

#### Generating valid configs

```bash
# A free plan that grants 100 credits, burning 1 per request:
nevermined plans get-free-price-config --format json > price-config.json
nevermined plans get-fixed-credits-config --credits-granted 100 --credits-per-request 1 \
  --format json > credits-config.json

nevermined agents register-agent-and-plan \
  --agent-metadata agent-metadata.json \
  --agent-api agent-api.json \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

## Updating Agents

### Update Agent Metadata

Modify agent name, description, API endpoint, or other metadata:

```bash
nevermined agents update-agent-metadata <agent-id> \
  --agent-metadata updated-metadata.json \
  --agent-api updated-agent-api.json
```

Both `--agent-metadata` and `--agent-api` are required. As with registration, `--agent-api` is a JSON object (`AgentAPIAttributes`), not a bare URL.

**updated-metadata.json**:

```json
{
  "name": "My AI Assistant Pro",
  "description": "Enhanced GPT-4 assistant with advanced capabilities",
  "version": "2.0.0",
  "tags": ["ai", "assistant", "gpt4", "premium"]
}
```

## Managing Payment Plans

### Add Payment Plan to Agent

Associate an existing payment plan with an agent:

```bash
nevermined agents add-plan-to-agent <plan-id> --agent-id <agent-id>
```

Example:

```bash
nevermined agents add-plan-to-agent "did:nvm:plan123" --agent-id "did:nvm:agent456"
```

### Remove Payment Plan from Agent

Disassociate a payment plan from an agent:

```bash
nevermined agents remove-plan-from-agent <plan-id> --agent-id <agent-id>
```

Example:

```bash
nevermined agents remove-plan-from-agent "did:nvm:plan123" --agent-id "did:nvm:agent456"
```

### List Plans Associated with Agent

See which plans give access to an agent:

```bash
nevermined agents get-agent-plans <agent-id>
```

## Integration Examples

### Example 1: Full Agent Setup

Complete workflow to register and configure an AI agent:

```bash
#!/bin/bash
# Complete agent setup script

# 1. Create a payment plan first
PLAN_ID=$(nevermined plans register-credits-plan \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json \
  --format json | jq -r '.planId')

echo "Created plan: $PLAN_ID"

# 2. Register the agent with the plan
AGENT_ID=$(nevermined agents register-agent \
  --agent-metadata agent.json \
  --agent-api agent-api.json \
  --payment-plans "$PLAN_ID" \
  --format json | jq -r '.agentId')

echo "Registered agent: $AGENT_ID"

# 3. Update agent metadata if needed
nevermined agents update-agent-metadata $AGENT_ID \
  --agent-metadata updated-agent.json \
  --agent-api agent-api.json

# 4. Verify agent is accessible
nevermined agents get-agent $AGENT_ID

echo "Agent setup complete!"
```

### Example 2: One-Step Agent and Plan Registration

Register an agent and its payment plan in a single command:

```bash
nevermined agents register-agent-and-plan \
  --agent-metadata agent.json \
  --agent-api agent-api.json \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json
```

### Example 3: Multi-Plan Agent

Register an agent with multiple pricing tiers:

```bash
# Create basic plan
BASIC_PLAN=$(nevermined plans register-credits-plan \
  --plan-metadata basic-plan.json \
  --price-config basic-price.json \
  --credits-config basic-credits.json \
  --format json | jq -r '.planId')

# Create premium plan
PREMIUM_PLAN=$(nevermined plans register-credits-plan \
  --plan-metadata premium-plan.json \
  --price-config premium-price.json \
  --credits-config premium-credits.json \
  --format json | jq -r '.planId')

# Register agent with both plans
nevermined agents register-agent \
  --agent-metadata agent.json \
  --agent-api agent-api.json \
  --payment-plans "$BASIC_PLAN,$PREMIUM_PLAN"
```

## JSON Output for Automation

Use `--format json` to integrate with other tools:

```bash
# Get agent data
AGENT=$(nevermined agents get-agent "did:nvm:agent123" --format json)

# Extract fields
NAME=$(echo $AGENT | jq -r '.name')
echo "Agent: $NAME"
```

## Best Practices

### 1. Use Descriptive Metadata

Provide comprehensive information about your agent:

```json
{
  "name": "GPT-4 Code Assistant",
  "description": "AI-powered code generation and debugging assistant",
  "version": "1.2.0",
  "author": "YourCompany",
  "tags": ["code", "ai", "programming", "debugging"]
}
```

### 2. Implement Proper API Endpoints

Ensure your agent API follows best practices:

- Use HTTPS for all endpoints
- Implement rate limiting
- Return proper HTTP status codes
- Include error handling

### 3. Test Before Production

Always test agents in sandbox environment:

```bash
# Register in sandbox
nevermined --profile sandbox agents register-agent \
  --agent-metadata agent.json \
  --agent-api staging-agent-api.json \
  --payment-plans "$STAGING_PLAN_ID"

# Test the agent
nevermined --profile sandbox agents get-agent $STAGING_AGENT_ID

# Once verified, deploy to production
nevermined --profile production agents register-agent \
  --agent-metadata agent.json \
  --agent-api agent-api.json \
  --payment-plans "$PROD_PLAN_ID"
```

## Common Issues

### "Payment plan not found"

Verify the payment plan exists and you're using the correct plan ID:

```bash
# List all your plans
nevermined plans get-plans

# Verify specific plan
nevermined plans get-plan <plan-id>
```

### "Insufficient permissions"

Ensure you're the agent owner or have proper permissions:

```bash
# Check agent details
nevermined agents get-agent <agent-id>

# Verify you're using the correct profile
nevermined config show
```

## Next Steps

- [Purchases](./purchases.md) - Users ordering your agent plans
- [Querying](./querying.md) - Accessing agents with X402 tokens
- [Plans](./plans.md) - Creating payment plans for your agents
