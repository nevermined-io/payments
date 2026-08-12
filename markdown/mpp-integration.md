---
title: "MPP Integration"
description: "Protect Express routes with the Machine Payments Protocol (MPP), a second payment framing over the same plans, delegations and credits as x402"
icon: "handshake"
---

# MPP Integration

The Machine Payments Protocol (MPP) is a second payment framing over the same
Nevermined plans, delegations and credits that x402 uses. Turning it on for a
route does not change the plan, the credits or the route configuration.

## Header table

| Header | Direction | Purpose |
|--------|-----------|---------|
| `WWW-Authenticate` | Server → Client (402) | Carries the `Payment …` challenge |
| `Authorization` | Client → Server | Carries the `Payment …` credential |
| `Payment-Receipt` | Server → Client (success) | Carries the settlement receipt |

## Protecting a route

```typescript
import express from 'express'
import { Payments } from '@nevermined-io/payments'
import { paymentMiddleware } from '@nevermined-io/payments/express'

const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox',
})

const app = express()
app.use(express.json())

app.use(
  paymentMiddleware(payments, {
    'POST /ask': { planId: PLAN_ID, credits: 2, mpp: true },
  }),
)

app.post('/ask', (req, res) => res.json({ answer: '...' }))
```

An unpaid request is answered with `402` and a `WWW-Authenticate: Payment …`
challenge; the x402 `payment-required` header is sent alongside it, so x402
buyers keep working unchanged. A paid request carries the credential in
`Authorization: Payment …`, and a successful response carries the settlement in
`Payment-Receipt`.

## Credits are sealed into the challenge

Under MPP the credits are fixed when the challenge is minted. A `credits`
function is evaluated once, at that moment, and the settlement burns the amount
the challenge carries. There is no post-hoc re-pricing as there is with x402.

## Binding the challenge to the request body

```typescript
import { captureRawBody } from '@nevermined-io/payments/express'

app.use(express.json({ verify: captureRawBody }))
app.use(
  paymentMiddleware(payments, {
    'POST /ask': { planId: PLAN_ID, credits: 2, mpp: { bindBody: true } },
  }),
)
```

`bindBody` seals a `sha-256=<base64>` digest of the raw request body into the
challenge, so a credential minted for one body cannot be spent on another. It
requires `captureRawBody` on the body parser; without it the middleware fails
loudly rather than sending a digest computed from re-serialized JSON.

## Paying an MPP endpoint

```typescript
const { delegationId } = await payments.delegation.createDelegation({
  provider: 'erc4337',
  spendingLimitCents: 10000,
  durationSecs: 604800,
  currency: 'usdc',
})

const { response, receipt } = await payments.mpp.fetch(
  'https://agent.example/ask',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'hello' }) },
  { delegationConfig: { delegationId } },
)

console.log(await response.json(), receipt?.reference)
```

The helper reads the plan out of the challenge, mints an MPP access token for
the delegation you already have, retries the request with the credential, and
decodes the `Payment-Receipt`. A request to an endpoint that does not speak MPP
comes back untouched, with `paid: false`.

Errors are typed: `MppChallengeExpiredError` (fetch a fresh challenge — the
helper already retries once), `MppCredentialRejectedError` (the credential was
refused, for example because it was already spent) and `MppNotConfiguredError`
(the environment has MPP switched off).
