---
title: "Request Validation"
description: "Verify X402 access tokens and settle payments when subscribers access your agents"
icon: "shield-check"
---

# Validation of Requests

This guide explains how AI agents validate incoming requests and settle payments using the Nevermined Facilitator. Agent builders use these methods to verify subscriber access and burn credits.

> 🔐 **Never log incoming tokens.** When you extract the `payment-signature` header, treat it as a bearer secret: do not echo it in error messages, debug output, or telemetry. Configure your log/trace exporters to redact `payment-signature`, `authorization`, and `cookie` headers by default.

## Overview

The validation flow consists of:
1. **Extract Token**: Read X402 access token from request headers
2. **Build Payment Required**: Create payment requirement specification
3. **Verify Permissions**: Check if subscriber has valid access
4. **Execute Task**: Process the agent request
5. **Settle Permissions**: Burn credits after successful execution
6. **Return Response**: Send result or 402 error to subscriber

## Receiving Requests

Extract the X402 access token from request headers. The X402 v2 spec defines the `payment-signature` header:

```typescript
import express from 'express'

const app = express()
app.use(express.json())

app.post('/api/v1/tasks', async (req, res) => {
  // Extract token from payment-signature header (X402 v2)
  const accessToken = req.headers['payment-signature'] as string

  // Alternative: Authorization header
  // const accessToken = req.headers.authorization?.replace('Bearer ', '')

  if (!accessToken) {
    return res.status(402).json({ error: 'Payment required' })
  }

  // Process request...
})
```

## Build Payment Required

Use the `buildPaymentRequired` helper to create the payment specification:

```typescript
import { buildPaymentRequired } from '@nevermined-io/payments'

const paymentRequired = buildPaymentRequired(planId, {
  endpoint: req.url,           // Resource URL
  agentId: agentId,            // Your agent ID
  httpVerb: req.method,        // HTTP method (POST, GET, etc.)
  network: 'eip155:84532',     // Optional: blockchain network
  description: 'Task API'      // Optional: description
})
```

## Verify Permissions

Before executing the request, verify the subscriber has valid access:

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { buildPaymentRequired } from '@nevermined-io/payments'

const agentPayments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,  // Builder/agent API key
  environment: 'sandbox' as EnvironmentName,
})

app.post('/api/v1/tasks', async (req, res) => {
  const accessToken = req.headers['payment-signature'] as string

  if (!accessToken) {
    return res.status(402).json({ error: 'Payment required' })
  }

  // Build payment required
  const paymentRequired = buildPaymentRequired(planId, {
    endpoint: req.url,
    agentId: agentId,
    httpVerb: req.method,
  })

  try {
    // Verify permissions
    const verification = await agentPayments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,  // Max credits to verify
    })

    if (!verification.isValid) {
      return res.status(402).json({ error: 'Insufficient credits or invalid token' })
    }

    // Verification successful, proceed with request...

  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})
```

## Settle Permissions

After successfully processing the request, burn the credits:

```typescript
app.post('/api/v1/tasks', async (req, res) => {
  const accessToken = req.headers['payment-signature'] as string

  if (!accessToken) {
    return res.status(402).json({ error: 'Payment required' })
  }

  const paymentRequired = buildPaymentRequired(planId, {
    endpoint: req.url,
    agentId: agentId,
    httpVerb: req.method,
  })

  try {
    // Verify
    const verification = await agentPayments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })

    if (!verification.isValid) {
      return res.status(402).json({ error: 'Insufficient credits' })
    }

    // Execute task
    const result = await processTask(req.body)

    // Settle permissions (burn credits)
    const settlement = await agentPayments.facilitator.settlePermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,  // Credits to burn
    })

    // Return success with payment metadata. Pass `billingModel` through — it is
    // what tells the caller how to read the credit fields (see below).
    return res.json({
      result,
      transaction: settlement.transaction,
      billingModel: settlement.billingModel,
      creditsUsed: settlement.creditsRedeemed,
      remainingBalance: settlement.remainingBalance,
      orderTx: settlement.orderTx,
    })

  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
})
```

### Was the buyer charged?

`settlement.success` tells you the settle worked. What to check **in addition** depends
on `settlement.billingModel`:

| `billingModel` | Success criterion | Credit fields |
| -------------- | ----------------- | ------------- |
| `credits` | `success === true && Number(creditsRedeemed) > 0` | `creditsRedeemed` is the amount burned, `remainingBalance` what is left |
| `pay-as-you-go` | `success === true` **and** a non-empty `orderTx` (fiat rails) / `transaction` (crypto rails) | always the string `'0'` — no balance exists on this plan shape |

**No `billingModel` in the response?** You are talking to a Nevermined API that predates the
discriminator. Apply the **credits** rule — never read a missing discriminator as pay-as-you-go.

```typescript
const settled =
  settlement.success &&
  (settlement.billingModel === 'pay-as-you-go'
    ? Boolean(settlement.orderTx || settlement.transaction)
    : Number(settlement.creditsRedeemed ?? '0') > 0)
```

Do not gate on `creditsRedeemed` without reading `billingModel` first: a pay-as-you-go plan
holds no credit balance, so `creditsRedeemed > 0` can never hold there and a real charge
reads as a decline. On a card rail that invites a retry of a payment that already succeeded,
and repeated attempts feed issuer fraud scoring. Note also that these fields are **strings** —
`'0'` is truthy while `Number('0') > 0` is false.

## Return 402 Payment Required

When payment is required, return HTTP 402 with the `PAYMENT-REQUIRED` header:

```typescript
import { buildPaymentRequired } from '@nevermined-io/payments'

function return402Response(res: express.Response, planId: string, agentId: string, endpoint: string) {
  const paymentRequired = buildPaymentRequired(planId, {
    endpoint,
    agentId,
    httpVerb: 'POST',
  })

  // Encode payment required as base64
  const paymentRequiredHeader = Buffer.from(
    JSON.stringify(paymentRequired)
  ).toString('base64')

  res.writeHead(402, {
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': paymentRequiredHeader,
  })

  res.end(JSON.stringify({
    error: 'Payment required',
    message: 'Valid X402 access token required in payment-signature header',
  }))
}

// Usage
app.post('/api/v1/tasks', async (req, res) => {
  const accessToken = req.headers['payment-signature'] as string

  if (!accessToken) {
    return return402Response(res, planId, agentId, req.url)
  }

  // Verify and process...
})
```

## Complete Validation Example

```typescript
import express from 'express'
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { buildPaymentRequired } from '@nevermined-io/payments'

const app = express()
app.use(express.json())

const agentPayments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

const PLAN_ID = process.env.NVM_PLAN_ID!
const AGENT_ID = process.env.NVM_AGENT_ID!

app.post('/api/v1/tasks', async (req, res) => {
  // 1. Extract token
  const accessToken = req.headers['payment-signature'] as string

  if (!accessToken) {
    return return402Response(res, PLAN_ID, AGENT_ID, req.url)
  }

  // 2. Build payment required
  const paymentRequired = buildPaymentRequired(PLAN_ID, {
    endpoint: req.url,
    agentId: AGENT_ID,
    httpVerb: req.method,
  })

  try {
    // 3. Verify permissions
    const verification = await agentPayments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })

    if (!verification.isValid) {
      console.log('Verification failed: insufficient credits or invalid token')
      return return402Response(res, PLAN_ID, AGENT_ID, req.url)
    }

    console.log('✓ Permissions verified')

    // 4. Execute task
    const result = await processTask(req.body)

    // 5. Settle permissions
    const settlement = await agentPayments.facilitator.settlePermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount: 1n,
    })

    console.log(`✓ Credits settled: ${settlement.creditsRedeemed}`)
    console.log(`✓ Transaction: ${settlement.transaction}`)

    // 6. Return response with payment metadata
    const paymentResponse = {
      success: settlement.success,
      network: settlement.network,
      transaction: settlement.transaction,
      billingModel: settlement.billingModel,
      creditsRedeemed: settlement.creditsRedeemed,
      orderTx: settlement.orderTx,
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'PAYMENT-RESPONSE': Buffer.from(JSON.stringify(paymentResponse)).toString('base64'),
    })

    res.end(JSON.stringify({ result }))

  } catch (error) {
    console.error('Request processing failed:', error)
    res.status(500).json({ error: error.message })
  }
})

function return402Response(
  res: express.Response,
  planId: string,
  agentId: string,
  endpoint: string
) {
  const paymentRequired = buildPaymentRequired(planId, {
    endpoint,
    agentId,
    httpVerb: 'POST',
  })

  const paymentRequiredHeader = Buffer.from(
    JSON.stringify(paymentRequired)
  ).toString('base64')

  res.writeHead(402, {
    'Content-Type': 'application/json',
    'PAYMENT-REQUIRED': paymentRequiredHeader,
  })

  res.end(JSON.stringify({ error: 'Payment required' }))
}

async function processTask(body: any): Promise<any> {
  // Your agent logic here
  return { response: 'Task completed' }
}

app.listen(3000, () => {
  console.log('Agent server running on port 3000')
})
```

## Dynamic Credit Burning

For agents with variable credit costs, calculate credits based on the request:

```typescript
async function calculateCredits(request: any, response: any): Promise<bigint> {
  // Example: charge based on response length
  const responseLength = JSON.stringify(response).length
  return BigInt(Math.ceil(responseLength / 1000))  // 1 credit per KB
}

app.post('/api/v1/tasks', async (req, res) => {
  const accessToken = req.headers['payment-signature'] as string
  const paymentRequired = buildPaymentRequired(PLAN_ID, {
    endpoint: req.url,
    agentId: AGENT_ID,
    httpVerb: req.method,
  })

  // Verify with max possible credits
  const verification = await agentPayments.facilitator.verifyPermissions({
    paymentRequired,
    x402AccessToken: accessToken,
    maxAmount: 10n,  // Max credits subscriber might need
  })

  if (!verification.isValid) {
    return return402Response(res, PLAN_ID, AGENT_ID, req.url)
  }

  // Execute
  const result = await processTask(req.body)

  // Calculate actual credits used
  const creditsUsed = await calculateCredits(req.body, result)

  // Settle with actual amount
  const settlement = await agentPayments.facilitator.settlePermissions({
    paymentRequired,
    x402AccessToken: accessToken,
    maxAmount: creditsUsed,
  })

  return res.json({
    result,
    creditsUsed: settlement.creditsRedeemed,
  })
})
```

## Settle Options

The `settlePermissions` method accepts additional options:

```typescript
const settlement = await agentPayments.facilitator.settlePermissions({
  paymentRequired,
  x402AccessToken: accessToken,
  maxAmount: 5n,               // Credits to burn
  batch: false,                // Batch settlement (optional)
  marginPercent: 5,            // Add 5% margin to calculated cost (optional)
  agentRequestId: 'req-123',   // Request ID from verification (optional)
})
```

## Single-Use (v3) Tokens on the Seller Side

Buyers may present a **v3** access token: bound to one resource URL and HTTP
verb, and **consumed by its first settlement**. The seller side needs no
protocol change — relay the `payment-signature` value to verify and settle
**byte-for-byte**, exactly as with a v2 token. Two consequences to be aware of:

- **`paymentRequired` must match what the token was minted for.** The backend
  compares the token's `resource.url` with yours (origin + path, query ignored;
  an unparseable string is compared literally) and rejects a mismatch with
  `BCK.X402.0013`. Whatever you pass as `endpoint` is what buyers must mint
  against — `paymentMiddleware` advertises `req.originalUrl`, i.e. a relative
  path. Keep it stable, and document it for your buyers.
- **`verifyPermissions` never consumes the token**, so verify-then-settle is
  unchanged and verification stays repeatable. Only `settlePermissions` spends it.

A second settlement of the same token fails with **`BCK.X402.0059`** — which is
neither a decline nor a forgery (`BCK.X402.0005`): the token was valid and has
already been spent. Never retry it; the buyer must mint a new one.

```typescript
import { isAccessTokenAlreadyUsed } from '@nevermined-io/payments'

try {
  await agentPayments.facilitator.settlePermissions({ paymentRequired, x402AccessToken: accessToken })
} catch (error) {
  if (isAccessTokenAlreadyUsed(error)) {
    return res.status(402).json({
      error: 'This access token was already used. Please mint a new one.',
    })
  }
  throw error
}
```

## Best Practices

1. **Always Verify First**: Call `verifyPermissions` before executing tasks
2. **Settle After Success**: Only burn credits after successful task completion
3. **Handle Errors**: Wrap verification/settlement in try-catch blocks
4. **Return 402 Properly**: Include `PAYMENT-REQUIRED` header with payment details
5. **Log Transactions**: Record transaction hashes for audit trails
6. **Dynamic Pricing**: Calculate credits based on actual resource usage
7. **Token Validation**: Never skip verification even if token looks valid
8. **Branch on `billingModel`**: Never decide "was the buyer charged?" from
   `creditsRedeemed` alone — see [Was the buyer charged?](#was-the-buyer-charged) above
9. **Never Retry a Spent Token**: Treat `BCK.X402.0059` as "mint a new token", not as a transient settlement failure
10. **Relay Tokens Verbatim**: Do not re-encode, trim or normalise `payment-signature` — a v3 envelope that disagrees with its signature is rejected as forgery

## Related Documentation

- [Querying an Agent](./querying-an-agent) - How subscribers generate and use tokens
- [X402 Protocol](./x402) - Complete X402 specification
- [MCP Integration](./mcp-integration) - Automatic validation in MCP servers
- [A2A Integration](./a2a-integration) - Automatic validation in A2A servers

---

**Source References**:
- `src/x402/facilitator-api.ts` (buildPaymentRequired, verifyPermissions, settlePermissions)
- `tests/e2e/test_payments_e2e.test.ts` (MockAgentServer class, complete validation flow)
- `tests/e2e/test_x402_e2e.test.ts` (lines 135-150, verification examples)
