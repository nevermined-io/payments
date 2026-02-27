---
title: "Querying Agents"
description: "Generate X402 access tokens and make authenticated requests to AI agents"
icon: "message"
---

# Querying an Agent

After purchasing a payment plan, subscribers can generate X402 access tokens and use them to query AI agents. This guide explains how to get tokens and make authenticated requests.

## Overview

The query flow consists of:
1. **Generate X402 Access Token**: Get a payment-authorized token for agent access
2. **Make Authenticated Requests**: Include the token in HTTP headers
3. **Receive Responses**: Agent validates the token and processes the request

## Get X402 Access Token

The X402 access token is a cryptographically signed credential that proves you have purchased access to an agent:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

// Initialize with subscriber's API key
const subscriberPayments = Payments.getInstance({
  nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Generate access token
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,   // Required: The plan you purchased
  agentId   // Optional: Specific agent ID to restrict access
)

console.log('Access token generated')
```

### Token Parameters

The `getX402AccessToken` method accepts several optional parameters:

```typescript
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,
  agentId,              // Optional: Restrict to specific agent
  redemptionLimit,      // Optional: Max credits this token can burn (BigInt)
  orderLimit,           // Optional: Order limit (string)
  expiration            // Optional: Token expiration date (ISO string)
)
```

### Card-Delegation Tokens (Fiat)

For plans that accept fiat payments, generate tokens using the `nvm:card-delegation` scheme. Pass `X402TokenOptions` with a `CardDelegationConfig` to specify the payment method and spending limits:

```typescript
import { Payments, EnvironmentName, X402TokenOptions } from '@nevermined-io/payments'

const subscriberPayments = Payments.getInstance({
  nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// List enrolled payment methods
const methods = await subscriberPayments.delegation.listPaymentMethods()
console.log(`Found ${methods.length} enrolled card(s)`)

// Build token options for card-delegation
const tokenOptions: X402TokenOptions = {
  scheme: 'nvm:card-delegation',
  delegationConfig: {
    providerPaymentMethodId: methods[0].id,  // or a specific 'pm_...' ID
    spendingLimitCents: 1000,                // max $10.00
    durationSecs: 3600,                      // 1 hour delegation
  },
}

// Generate fiat access token
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,
  agentId,
  undefined,  // redemptionLimit
  undefined,  // orderLimit
  undefined,  // expiration
  tokenOptions,
)
```

#### Auto-Detecting the Scheme

If you don't know whether a plan uses crypto or fiat, use `resolveScheme()` to auto-detect from plan metadata:

```typescript
import { Payments, resolveScheme } from '@nevermined-io/payments'

const scheme = await resolveScheme(subscriberPayments, planId)

let tokenOptions: X402TokenOptions | undefined
if (scheme === 'nvm:card-delegation') {
  const methods = await subscriberPayments.delegation.listPaymentMethods()
  tokenOptions = {
    scheme: 'nvm:card-delegation',
    delegationConfig: {
      providerPaymentMethodId: methods[0].id,
      spendingLimitCents: 1000,
      durationSecs: 3600,
    },
  }
}

const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId, agentId, undefined, undefined, undefined, tokenOptions,
)
```

#### CLI

```bash
# Crypto (default)
nvm x402token get-x402-access-token <planId>

# Fiat with auto-selected card
nvm x402token get-x402-access-token <planId> --payment-type fiat

# Fiat with specific card and limits
nvm x402token get-x402-access-token <planId> --payment-type fiat \
    --payment-method-id pm_1AbCdEfGhIjKlM \
    --spending-limit-cents 5000 \
    --delegation-duration-secs 7200

# Auto-detect scheme from plan metadata
nvm x402token get-x402-access-token <planId> --auto-resolve-scheme

# List enrolled payment methods
nvm delegation list-payment-methods
```

### Basic Example

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

const subscriberPayments = Payments.getInstance({
  nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

// Simple token generation
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,
  agentId
)

console.log(`Token generated, length: ${accessToken.length} characters`)
```

## Token Structure (X402 v2)

The access token is a JSON Web Token (JWT) containing an X402 v2 payment credential:

```json
{
  "x402Version": 2,
  "accepted": {
    "scheme": "nvm:erc4337",
    "network": "eip155:84532",
    "planId": "plan-123",
    "extra": {
      "version": "1",
      "agentId": "did:nv:agent-456"
    }
  },
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xSubscriberAddress",
      "sessionKeysProvider": "zerodev",
      "sessionKeys": []
    }
  },
  "extensions": {}
}
```

## Make Requests with X402 Token

### Using PAYMENT-SIGNATURE Header (X402 v2 Spec)

The X402 v2 specification defines the `PAYMENT-SIGNATURE` header for payment credentials:

```typescript
// Make authenticated request to agent
const response = await fetch('https://agent.example.com/api/v1/tasks', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-SIGNATURE': accessToken,  // X402 v2 standard header
  },
  body: JSON.stringify({
    prompt: 'What is the weather in San Francisco?',
  }),
})

const result = await response.json()
console.log(result)
```

**Note**: The A2A (Agent-to-Agent) protocol also uses the `payment-signature` header for authentication. For A2A integration details, see the [A2A Integration](./a2a-integration) guide.

## Complete Query Example

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

async function queryAgent(
  planId: string,
  agentId: string,
  agentUrl: string,
  prompt: string
) {
  // Initialize subscriber payments
  const subscriberPayments = Payments.getInstance({
    nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
    environment: 'sandbox' as EnvironmentName,
  })

  try {
    // 1. Generate access token
    const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
      planId,
      agentId
    )
    console.log('✓ Access token generated')

    // 2. Make authenticated request
    const response = await fetch(`${agentUrl}/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': accessToken,
      },
      body: JSON.stringify({ prompt }),
    })

    // 3. Handle response
    if (!response.ok) {
      if (response.status === 402) {
        console.error('Payment required - insufficient credits')
      } else {
        console.error(`Request failed: ${response.statusText}`)
      }
      return null
    }

    const result = await response.json()
    console.log('✓ Agent response received')
    return result

  } catch (error) {
    console.error('Failed to query agent:', error)
    return null
  }
}

// Usage
const result = await queryAgent(
  'plan-123',
  'did:nv:agent-456',
  'https://weather-agent.example.com/api/v1',
  'What is the weather forecast for tomorrow?'
)
```

## Handling 402 Payment Required

If the token is invalid or credits are insufficient, agents return HTTP 402 with payment details:

```typescript
const response = await fetch(agentUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'PAYMENT-SIGNATURE': accessToken,
  },
  body: JSON.stringify({ prompt }),
})

if (response.status === 402) {
  // Read PAYMENT-REQUIRED header
  const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED')

  if (paymentRequiredHeader) {
    // Decode base64 payment required info
    const paymentRequired = JSON.parse(
      Buffer.from(paymentRequiredHeader, 'base64').toString()
    )

    console.log('Payment required:', paymentRequired)
    console.log(`Plan ID: ${paymentRequired.accepts[0].planId}`)

    // User needs to purchase plan or top up credits
  }
}
```

## MCP JSON-RPC Requests

For MCP-based agents, use JSON-RPC format:

```typescript
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,
  agentId
)

const response = await fetch('https://mcp-agent.example.com/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'payment-signature': accessToken,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'get_weather',
      arguments: {
        city: 'San Francisco'
      }
    }
  }),
})

const result = await response.json()
console.log(result.result)
```

## Token Reuse

X402 access tokens can be reused for multiple requests until they expire or credits are exhausted:

```typescript
// Generate token once
const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
  planId,
  agentId
)

// Use for multiple requests
for (const city of ['San Francisco', 'New York', 'London']) {
  const response = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': accessToken,  // Reuse same token
    },
    body: JSON.stringify({ prompt: `Weather in ${city}` }),
  })

  const result = await response.json()
  console.log(`${city}:`, result)
}
```

## Check Balance Before Querying

To avoid 402 errors, check your balance before making requests:

```typescript
async function queryWithBalanceCheck(
  planId: string,
  agentId: string,
  agentUrl: string,
  prompt: string
) {
  const subscriberPayments = Payments.getInstance({
    nvmApiKey: process.env.SUBSCRIBER_API_KEY!,
    environment: 'sandbox',
  })

  // Check balance first
  const balance = await subscriberPayments.plans.getPlanBalance(planId)
  const availableCredits = BigInt(balance.balance)

  if (availableCredits === 0n) {
    console.error('No credits available - please purchase a plan')
    return null
  }

  console.log(`Available credits: ${availableCredits}`)

  // Generate token and query
  const { accessToken } = await subscriberPayments.x402.getX402AccessToken(
    planId,
    agentId
  )

  const response = await fetch(agentUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PAYMENT-SIGNATURE': accessToken,
    },
    body: JSON.stringify({ prompt }),
  })

  return await response.json()
}
```

## Best Practices

1. **Token Caching**: Generate tokens once and reuse them for multiple requests
2. **Balance Checking**: Check balance before generating tokens
3. **Error Handling**: Always handle 402 Payment Required responses
4. **HTTPS Only**: Never send tokens over unencrypted HTTP
5. **Token Expiration**: Regenerate tokens if you receive 402 errors
6. **Header Standard**: Prefer `PAYMENT-SIGNATURE` header (X402 v2 spec)

## Related Documentation

- [Payments and Balance](./payments-and-balance) - How to purchase plans and check credits
- [Validation of Requests](./validation-of-requests) - How agents validate tokens (for builders)
- [X402 Protocol](./x402) - Complete X402 specification

---

**Source References**:
- `src/x402/token.ts` (getX402AccessToken method)
- `tests/e2e/test_x402_e2e.test.ts` (lines 114-133, token generation)
- `tests/e2e/test_payments_e2e.test.ts` (MockAgentServer, lines 72-127)
