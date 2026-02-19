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
nvm agents get-agent-plans <agent-id>

# With pagination
nvm agents get-agent-plans <agent-id> --pagination '{"page": 1, "offset": 10}'

# JSON output
nvm agents get-agent-plans <agent-id> --format json
```

## Getting Agent Details

Retrieve detailed information about a specific agent:

```bash
nvm agents get-agent <agent-id>
```

Example:

```bash
nvm agents get-agent "did:nvm:abc123"
```

Output includes:
- Agent metadata (name, description, creator)
- API endpoint configuration
- Associated payment plans

## Registering Agents

### Register Agent with Existing Plans

Register a new AI agent and associate it with one or more existing payment plans:

```bash
nvm agents register-agent \
  --agent-metadata agent-metadata.json \
  --agent-api "https://api.example.com/v1/agent" \
  --payment-plans "plan-id-1,plan-id-2"
```

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
nvm agents register-agent-and-plan \
  --agent-metadata agent-metadata.json \
  --agent-api "https://api.example.com/v1/agent" \
  --plan-metadata plan-metadata.json \
  --price-config price-config.json \
  --credits-config credits-config.json
```

Optional flags:
- `--access-limit` — Limit the number of times the plan can be ordered

**plan-metadata.json**:

```json
{
  "name": "My Agent - Basic Plan",
  "description": "100 credits for API access",
  "tags": ["ai", "assistant", "basic"]
}
```

**price-config.json**:

```json
{
  "tokenAddress": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "price": 1000000,
  "amountOfCredits": 100
}
```

**credits-config.json**:

```json
{
  "subscriptionType": "credits",
  "accessType": "credits",
  "minCreditsToCharge": 1,
  "maxCreditsToCharge": 10
}
```

## Updating Agents

### Update Agent Metadata

Modify agent name, description, API endpoint, or other metadata:

```bash
nvm agents update-agent-metadata <agent-id> \
  --agent-metadata updated-metadata.json \
  --agent-api "https://api-v2.example.com/agent"
```

Both `--agent-metadata` and `--agent-api` are required.

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
nvm agents add-plan-to-agent <plan-id> --agent-id <agent-id>
```

Example:

```bash
nvm agents add-plan-to-agent "did:nvm:plan123" --agent-id "did:nvm:agent456"
```

### Remove Payment Plan from Agent

Disassociate a payment plan from an agent:

```bash
nvm agents remove-plan-from-agent <plan-id> --agent-id <agent-id>
```

Example:

```bash
nvm agents remove-plan-from-agent "did:nvm:plan123" --agent-id "did:nvm:agent456"
```

### List Plans Associated with Agent

See which plans give access to an agent:

```bash
nvm agents get-agent-plans <agent-id>
```

## Integration Examples

### Example 1: Full Agent Setup

Complete workflow to register and configure an AI agent:

```bash
#!/bin/bash
# Complete agent setup script

# 1. Create a payment plan first
PLAN_ID=$(nvm plans register-credits-plan \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json \
  --format json | jq -r '.planId')

echo "Created plan: $PLAN_ID"

# 2. Register the agent with the plan
AGENT_ID=$(nvm agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com/agent" \
  --payment-plans "$PLAN_ID" \
  --format json | jq -r '.agentId')

echo "Registered agent: $AGENT_ID"

# 3. Update agent metadata if needed
nvm agents update-agent-metadata $AGENT_ID \
  --agent-metadata updated-agent.json \
  --agent-api "https://api.example.com/agent"

# 4. Verify agent is accessible
nvm agents get-agent $AGENT_ID

echo "Agent setup complete!"
```

### Example 2: One-Step Agent and Plan Registration

Register an agent and its payment plan in a single command:

```bash
nvm agents register-agent-and-plan \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com/agent" \
  --plan-metadata plan.json \
  --price-config price.json \
  --credits-config credits.json
```

### Example 3: Multi-Plan Agent

Register an agent with multiple pricing tiers:

```bash
# Create basic plan
BASIC_PLAN=$(nvm plans register-credits-plan \
  --plan-metadata basic-plan.json \
  --price-config basic-price.json \
  --credits-config basic-credits.json \
  --format json | jq -r '.planId')

# Create premium plan
PREMIUM_PLAN=$(nvm plans register-credits-plan \
  --plan-metadata premium-plan.json \
  --price-config premium-price.json \
  --credits-config premium-credits.json \
  --format json | jq -r '.planId')

# Register agent with both plans
nvm agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com" \
  --payment-plans "$BASIC_PLAN,$PREMIUM_PLAN"
```

## JSON Output for Automation

Use `--format json` to integrate with other tools:

```bash
# Get agent data
AGENT=$(nvm agents get-agent "did:nvm:agent123" --format json)

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
nvm --profile sandbox agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://staging-api.example.com" \
  --payment-plans "$STAGING_PLAN_ID"

# Test the agent
nvm --profile sandbox agents get-agent $STAGING_AGENT_ID

# Once verified, deploy to production
nvm --profile production agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com" \
  --payment-plans "$PROD_PLAN_ID"
```

## Common Issues

### "Payment plan not found"

Verify the payment plan exists and you're using the correct plan ID:

```bash
# List all your plans
nvm plans get-plans

# Verify specific plan
nvm plans get-plan <plan-id>
```

### "Insufficient permissions"

Ensure you're the agent owner or have proper permissions:

```bash
# Check agent details
nvm agents get-agent <agent-id>

# Verify you're using the correct profile
nvm config show
```

## Next Steps

- [Purchases](./purchases.md) - Users ordering your agent plans
- [Querying](./querying.md) - Accessing agents with X402 tokens
- [Plans](./plans.md) - Creating payment plans for your agents
