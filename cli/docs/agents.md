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

## Listing Agents

View all registered agents:

```bash
# Table output (default)
nvm agents list

# JSON output for scripting
nvm agents list --format json
```

Example output:

```
AI Agents
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Agent ID                 Name                    Plans
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"987654321098765432"          GPT-4 Assistant         3
"876543210987654321"          Code Helper             2
"765432109876543210"          Data Analyzer           1
```

## Getting Agent Details

Retrieve detailed information about a specific agent:

```bash
nvm agents get-agent <agent-id>
```

Example:

```bash
nvm agents get-agent "987654321098765432"23
```

Output includes:
- Agent metadata (name, description, creator)
- API endpoint configuration
- Associated payment plans
- Access control settings
- Authentication requirements

## Registering Agents

### Basic Agent Registration

Register a new AI agent with payment plans:

```bash
nvm agents register-agent \
  --agent-metadata agent-metadata.json \
  --agent-api "https://api.example.com/v1/agent" \
  --payment-plans ""111111111111111111","222222222222222222"
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

### Agent with Service Configuration

Register an agent with detailed service configuration:

```bash
nvm agents register-agent \
  --agent-metadata metadata.json \
  --agent-api "https://api.example.com" \
  --payment-plans ""111111111111111111"" \
  --service-config service-config.json
```

**service-config.json**:

```json
{
  "endpoints": {
    "chat": "/v1/chat",
    "completion": "/v1/completion",
    "embedding": "/v1/embedding"
  },
  "authentication": {
    "type": "bearer",
    "headerName": "Authorization"
  },
  "rateLimit": {
    "maxRequests": 100,
    "windowMs": 60000
  },
  "timeout": 30000
}
```

## Updating Agents

### Update Agent Metadata

Modify agent name, description, or other metadata:

```bash
nvm agents update-agent-metadata <agent-id> \
  --agent-metadata updated-metadata.json
```

**updated-metadata.json**:

```json
{
  "name": "My AI Assistant Pro",
  "description": "Enhanced GPT-4 assistant with advanced capabilities",
  "version": "2.0.0",
  "tags": ["ai", "assistant", "gpt4", "premium"]
}
```

### Update Agent API Endpoint

Change the agent's API endpoint:

```bash
nvm agents update-agent-endpoint <agent-id> \
  --agent-api "https://api-v2.example.com/agent"
```

### Add Payment Plans

Associate additional payment plans with an agent:

```bash
nvm agents add-agent-plan <agent-id> \
  --plan-id "444444444444444444"
```

### Remove Payment Plans

Disassociate a payment plan from an agent:

```bash
nvm agents remove-agent-plan <agent-id> \
  --plan-id "555555555555555555"
```

## Agent Files and Resources

### Upload Agent Files

Upload files associated with your agent (models, configs, etc.):

```bash
nvm agents upload-agent-files <agent-id> \
  --files "./model.bin,./config.json"
```

### Download Agent Files

Download files from an agent:

```bash
nvm agents download-agent-files <agent-id> \
  --destination ./downloads
```

## Advanced Agent Operations

### Create Agent Execution

Create a new agent execution/session:

```bash
nvm agents create-agent-execution <agent-id> \
  --execution-config execution.json
```

**execution.json**:

```json
{
  "sessionId": "unique-session-id",
  "parameters": {
    "temperature": 0.7,
    "maxTokens": 2000
  },
  "context": {
    "userId": "user123",
    "conversationId": "conv456"
  }
}
```

### Get Agent Execution Status

Check the status of an agent execution:

```bash
nvm agents get-agent-execution-status <agent-id> <execution-id>
```

### List Agent Executions

View all executions for an agent:

```bash
nvm agents list-agent-executions <agent-id>
```

## Agent Access Control

### Get Agent Access Config

View who can access your agent:

```bash
nvm agents get-agent-access-config <agent-id>
```

### Update Agent Access Config

Modify access control settings:

```bash
nvm agents update-agent-access-config <agent-id> \
  --access-config access.json
```

**access.json**:

```json
{
  "public": false,
  "allowedAddresses": [
    "0x123...",
    "0x456..."
  ],
  "requiresPayment": true,
  "allowedPlans": [
    ""111111111111111111"",
    ""222222222222222222"
  ]
}
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
  --agent-metadata updated-agent.json

# 4. Verify agent is accessible
nvm agents get-agent $AGENT_ID

echo "Agent setup complete!"
```

### Example 2: Multi-Plan Agent

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

### Example 3: Agent Monitoring

Monitor agent usage and executions:

```bash
#!/bin/bash
# Agent monitoring script

AGENT_ID="987654321098765432"23"

# Get agent details
echo "Agent Details:"
nvm agents get-agent $AGENT_ID

# List recent executions
echo -e "\nRecent Executions:"
nvm agents list-agent-executions $AGENT_ID

# Check access configuration
echo -e "\nAccess Configuration:"
nvm agents get-agent-access-config $AGENT_ID
```

## JSON Output for Automation

Use `--format json` to integrate with other tools:

```bash
# Get agent data
AGENT=$(nvm agents get-agent "987654321098765432"23 --format json)

# Extract fields
NAME=$(echo $AGENT | jq -r '.name')
API=$(echo $AGENT | jq -r '.apiEndpoint')
PLANS=$(echo $AGENT | jq -r '.plans | join(",")')

echo "Agent: $NAME"
echo "API: $API"
echo "Plans: $PLANS"

# Check if agent has specific plan
HAS_PLAN=$(echo $AGENT | jq --arg pid ""111111111111111111"" \
  '.plans | contains([$pid])')

if [ "$HAS_PLAN" = "true" ]; then
  echo "Agent has the required plan"
fi
```

## Best Practices

### 1. Use Descriptive Metadata

Provide comprehensive information about your agent:

```json
{
  "name": "GPT-4 Code Assistant",
  "description": "AI-powered code generation and debugging assistant with support for 20+ programming languages",
  "version": "1.2.0",
  "author": "YourCompany",
  "tags": ["code", "ai", "programming", "debugging"],
  "customData": {
    "supportedLanguages": ["python", "javascript", "typescript", "go", "rust"],
    "features": ["code-generation", "debugging", "refactoring", "documentation"],
    "model": "gpt-4-turbo",
    "maxContextLength": 128000
  }
}
```

### 2. Implement Proper API Endpoints

Ensure your agent API follows best practices:

- Use HTTPS for all endpoints
- Implement rate limiting
- Return proper HTTP status codes
- Include error handling
- Log requests for debugging

### 3. Version Your Agents

Update version numbers when making changes:

```bash
# Update agent with new version
nvm agents update-agent-metadata $AGENT_ID \
  --agent-metadata updated-metadata.json

# Create new payment plan for new version if needed
nvm plans register-credits-plan \
  --plan-metadata v2-plan.json \
  --price-config v2-price.json \
  --credits-config v2-credits.json
```

### 4. Test Before Production

Always test agents in staging environment:

```bash
# Register in staging
nvm --profile staging agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://staging-api.example.com" \
  --payment-plans "$STAGING_PLAN_ID"

# Test the agent
nvm --profile staging agents get-agent $STAGING_AGENT_ID

# Once verified, deploy to production
nvm --profile production agents register-agent \
  --agent-metadata agent.json \
  --agent-api "https://api.example.com" \
  --payment-plans "$PROD_PLAN_ID"
```

### 5. Organize Multiple Agents

Keep agent configurations organized:

```
agents/
├── code-assistant/
│   ├── metadata.json
│   ├── service-config.json
│   └── plans/
│       ├── basic-plan.json
│       └── premium-plan.json
├── data-analyzer/
│   ├── metadata.json
│   ├── service-config.json
│   └── plans/
│       └── enterprise-plan.json
└── chat-bot/
    ├── metadata.json
    └── plans/
        └── starter-plan.json
```

## Common Issues

### "Agent endpoint not reachable"

Ensure your agent API endpoint is:
- Publicly accessible
- Using HTTPS
- Responding to health checks
- Not blocking Nevermined's IP ranges

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
