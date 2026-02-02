---
title: "Querying Agents"
description: "Complete guide to accessing AI agents using X402 access tokens with the Nevermined CLI"
icon: "messages"
---

# Querying Agents

Complete guide to accessing AI agents using X402 access tokens with the Nevermined CLI.

## Overview

After purchasing a payment plan, you can query AI agents using X402 access tokens. The X402 protocol enables pay-per-use access with automatic credit deduction.

## Getting an Access Token

### Generate X402 Token

Get an access token for a purchased plan:

```bash
nvm x402token get-x402-access-token <plan-id>
```

Example:

```bash
nvm x402token get-x402-access-token did:nvm:abc123
```

Output:

```
X402 Access Token
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Plan ID: did:nvm:abc123
Expires: 2024-03-15 10:30:00 UTC
Credits: 100

Use this token in the X-402 header:
  curl -H "X-402: eyJhbGci..." https://agent-api.example.com
```

### Token Format

The token is a JWT containing:
- Plan ID
- Subscriber address
- Credits information
- Signature for verification

### Save Token for Reuse

Store the token for multiple requests:

```bash
# Get token and save to file
TOKEN=$(nvm x402token get-x402-access-token did:nvm:abc123 --format json | jq -r '.token')
echo $TOKEN > ~/.nvm-token

# Use token from file
curl -H "X-402: $(cat ~/.nvm-token)" https://agent-api.example.com/query
```

## Using X402 Tokens

### HTTP Requests with curl

Query an agent using curl:

```bash
# Get access token
TOKEN=$(nvm x402token get-x402-access-token did:nvm:abc123 --format json | jq -r '.token')

# Make request with X-402 header
curl -X POST https://agent-api.example.com/v1/chat \
  -H "Content-Type: application/json" \
  -H "X-402: $TOKEN" \
  -d '{
    "message": "Hello, AI assistant!",
    "temperature": 0.7
  }'
```

### With JavaScript/TypeScript

```javascript
// Get token from CLI
const { execSync } = require('child_process')

const planId = 'did:nvm:abc123'
const tokenCmd = `nvm x402token get-x402-access-token ${planId} --format json`
const result = JSON.parse(execSync(tokenCmd).toString())
const token = result.token

// Make API request
const response = await fetch('https://agent-api.example.com/v1/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-402': token
  },
  body: JSON.stringify({
    message: 'Hello, AI assistant!',
    temperature: 0.7
  })
})

const data = await response.json()
console.log(data)
```

### With Python

```python
import subprocess
import json
import requests

# Get token from CLI
plan_id = 'did:nvm:abc123'
cmd = f'nvm x402token get-x402-access-token {plan_id} --format json'
result = subprocess.run(cmd.split(), capture_output=True, text=True)
token_data = json.loads(result.stdout)
token = token_data['token']

# Make API request
response = requests.post(
    'https://agent-api.example.com/v1/chat',
    headers={
        'Content-Type': 'application/json',
        'X-402': token
    },
    json={
        'message': 'Hello, AI assistant!',
        'temperature': 0.7
    }
)

print(response.json())
```

## Verifying Requests

### Manual Verification

Verify that a request is valid before processing (for agent owners):

```bash
nvm facilitator verify-permissions \
  --verify-permissions-params verify.json
```

**verify.json**:

```json
{
  "planId": "did:nvm:abc123",
  "token": "eyJhbGci...",
  "creditsRequired": 5
}
```

Output:

```
Permission Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: Valid
Plan ID: did:nvm:abc123
Subscriber: 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
Credits Available: 100
Credits Required: 5
Can Proceed: true
```

### Automatic Verification (SDK)

For agent implementations, use the SDK for automatic verification:

```typescript
import { Payments } from '@nevermined-io/payments'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'staging_sandbox'
})

// Verify incoming request
const isValid = await payments.facilitator.verifyPermissions({
  planId: 'did:nvm:abc123',
  token: req.headers['x-402'],
  creditsRequired: 5
})

if (!isValid) {
  return res.status(402).json({ error: 'Payment required' })
}
```

## Settling Credits

### Burn Credits After Use

After processing a request, burn the credits (agent owners):

```bash
nvm facilitator settle-permissions \
  --settle-permissions-params settle.json
```

**settle.json**:

```json
{
  "planId": "did:nvm:abc123",
  "token": "eyJhbGci...",
  "creditsBurned": 5,
  "executionId": "exec-123"
}
```

Output:

```
Credits Settled
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Plan ID: did:nvm:abc123
Credits Burned: 5
Remaining Balance: 95
Transaction Hash: 0x1234567890abcdef...
Status: Confirmed
```

### Automatic Settlement (SDK)

Integrate settlement into your agent:

```typescript
// After processing request
await payments.facilitator.settlePermissions({
  planId: 'did:nvm:abc123',
  token: req.headers['x-402'],
  creditsBurned: 5,
  executionId: requestId
})
```

## Complete Query Workflow

### End-to-End Example

Complete flow from purchase to query:

```bash
#!/bin/bash
# Complete agent query workflow

PLAN_ID="did:nvm:abc123"
AGENT_API="https://agent-api.example.com/v1/chat"

# 1. Purchase plan if needed
echo "Checking balance..."
BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

if [ "$BALANCE" -lt "10" ]; then
  echo "Low balance, purchasing plan..."
  nvm plans order-plan $PLAN_ID
fi

# 2. Get X402 access token
echo "Getting access token..."
TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')

# 3. Query the agent
echo "Querying agent..."
RESPONSE=$(curl -s -X POST $AGENT_API \
  -H "Content-Type: application/json" \
  -H "X-402: $TOKEN" \
  -d '{
    "message": "Explain quantum computing in simple terms",
    "temperature": 0.7
  }')

echo "Response:"
echo $RESPONSE | jq '.'

# 4. Check updated balance
echo "Updated balance:"
nvm plans get-plan-balance $PLAN_ID
```

## Advanced Usage

### Batch Queries

Process multiple queries efficiently:

```bash
#!/bin/bash
# Batch query script

PLAN_ID="did:nvm:abc123"
AGENT_API="https://agent-api.example.com/v1/chat"

# Get token once
TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')

# Array of questions
QUESTIONS=(
  "What is machine learning?"
  "Explain neural networks"
  "What is deep learning?"
)

# Query each
for QUESTION in "${QUESTIONS[@]}"; do
  echo "Query: $QUESTION"

  RESPONSE=$(curl -s -X POST $AGENT_API \
    -H "Content-Type: application/json" \
    -H "X-402: $TOKEN" \
    -d "{\"message\": \"$QUESTION\"}")

  echo "Answer: $(echo $RESPONSE | jq -r '.answer')"
  echo "Credits used: $(echo $RESPONSE | jq -r '.creditsUsed')"
  echo "---"
done

# Check final balance
nvm plans get-plan-balance $PLAN_ID
```

### Rate-Limited Queries

Respect rate limits:

```bash
#!/bin/bash
# Rate-limited query script

PLAN_ID="did:nvm:abc123"
AGENT_API="https://agent-api.example.com/v1/chat"
RATE_LIMIT=10  # requests per minute
DELAY=$(echo "60 / $RATE_LIMIT" | bc -l)

TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')

for i in {1..50}; do
  echo "Request $i..."

  curl -s -X POST $AGENT_API \
    -H "Content-Type: application/json" \
    -H "X-402: $TOKEN" \
    -d "{\"message\": \"Query $i\"}"

  # Respect rate limit
  sleep $DELAY
done
```

### Error Handling

Handle common errors gracefully:

```bash
#!/bin/bash
# Robust query script with error handling

query_agent() {
  local plan_id=$1
  local message=$2
  local max_retries=3
  local retry_count=0

  while [ $retry_count -lt $max_retries ]; do
    # Get fresh token
    TOKEN=$(nvm x402token get-x402-access-token $plan_id --format json 2>&1)

    if [ $? -ne 0 ]; then
      echo "Error getting token: $TOKEN"
      return 1
    fi

    TOKEN=$(echo $TOKEN | jq -r '.token')

    # Make request
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
      https://agent-api.example.com/v1/chat \
      -H "Content-Type: application/json" \
      -H "X-402: $TOKEN" \
      -d "{\"message\": \"$message\"}")

    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)

    case $HTTP_CODE in
      200)
        echo "$BODY"
        return 0
        ;;
      402)
        echo "Insufficient credits. Purchasing more..."
        nvm plans order-plan $plan_id
        ;;
      429)
        echo "Rate limit exceeded. Waiting..."
        sleep 60
        ;;
      *)
        echo "Error $HTTP_CODE: $BODY"
        ;;
    esac

    retry_count=$((retry_count + 1))
    sleep 2
  done

  echo "Max retries exceeded"
  return 1
}

# Usage
query_agent "did:nvm:abc123" "Hello, agent!"
```

## Monitoring Usage

### Track Credit Consumption

Monitor how credits are used per query:

```bash
#!/bin/bash
# Credit usage tracking

PLAN_ID="did:nvm:abc123"
LOG_FILE="credit-usage.log"

# Get initial balance
INITIAL=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

# Make query
TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')
RESPONSE=$(curl -s -X POST https://agent-api.example.com/v1/chat \
  -H "X-402: $TOKEN" \
  -d '{"message": "test query"}')

# Get new balance
FINAL=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')

# Calculate usage
USED=$((INITIAL - FINAL))

# Log
echo "$(date)|Query: test query|Credits used: $USED|Remaining: $FINAL" >> $LOG_FILE
echo "Credits used: $USED"
echo "Remaining: $FINAL"
```

### Usage Reports

Generate usage reports:

```bash
#!/bin/bash
# Generate usage report from logs

echo "Credit Usage Report"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Total credits used
TOTAL_USED=$(awk -F'|' '{sum+=$3} END {print sum}' credit-usage.log | cut -d: -f2)
echo "Total Credits Used: $TOTAL_USED"

# Average per query
NUM_QUERIES=$(wc -l < credit-usage.log)
AVG=$(echo "$TOTAL_USED / $NUM_QUERIES" | bc -l | xargs printf "%.2f")
echo "Average per Query: $AVG"

# Queries by date
echo ""
echo "Queries by Date:"
awk -F'|' '{print substr($1, 1, 10)}' credit-usage.log | sort | uniq -c
```

## Best Practices

### 1. Token Refresh

Tokens may expire, always get fresh tokens for new sessions:

```bash
# Don't reuse old tokens
TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')
```

### 2. Credit Management

Monitor balance before queries:

```bash
BALANCE=$(nvm plans get-plan-balance $PLAN_ID --format json | jq -r '.balance')
if [ "$BALANCE" -lt "10" ]; then
  echo "Low credits, refilling..."
  nvm plans order-plan $PLAN_ID
fi
```

### 3. Error Recovery

Implement retries with exponential backoff:

```bash
retry_with_backoff() {
  local max_attempts=5
  local timeout=1
  local attempt=1

  while [ $attempt -le $max_attempts ]; do
    if "$@"; then
      return 0
    fi

    echo "Attempt $attempt failed. Retrying in ${timeout}s..."
    sleep $timeout
    timeout=$((timeout * 2))
    attempt=$((attempt + 1))
  done

  return 1
}
```

### 4. Secure Token Storage

Never commit tokens to version control:

```bash
# Use environment variables
export X402_TOKEN=$(nvm x402token get-x402-access-token $PLAN_ID --format json | jq -r '.token')

# Or secure file storage
chmod 600 ~/.nvm-token
```

### 5. Rate Limiting

Respect API rate limits to avoid 429 errors:

```bash
# Add delays between requests
sleep 0.1  # 100ms between requests
```

## Common Issues

### "Invalid token"

Token may be expired or malformed:

```bash
# Get a fresh token
nvm x402token get-x402-access-token $PLAN_ID
```

### "Insufficient credits"

Your balance is too low:

```bash
# Check balance
nvm plans get-plan-balance $PLAN_ID

# Purchase more
nvm plans order-plan $PLAN_ID
```

### "402 Payment Required"

The agent requires payment but token is invalid or missing:

```bash
# Ensure X-402 header is included
curl -H "X-402: $TOKEN" https://agent-api.example.com
```

## Next Steps

- [Other Commands](./other-commands.md) - Additional CLI features
- [Purchases](./purchases.md) - Managing your credits
- [Agents](./agents.md) - Discover more agents
