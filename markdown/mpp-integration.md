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

const { response, receipt, paid, settled, credentialsPresented } = await payments.mpp.fetch(
  'https://agent.example/ask',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'hello' }) },
  { delegationConfig: { delegationId }, planId: PLAN_ID },
)

console.log(await response.json(), receipt?.reference)
```

The helper reads the plan out of the challenge, mints an MPP access token for
the delegation you already have, retries the request with the credential, and
decodes the `Payment-Receipt`. `delegationConfig` must carry a `delegationId`
— create the delegation first, the same as for x402. Passing `planId` pins
the plan you expect to pay; the challenge naming a different plan makes the
call fail before anything is minted. `maxCredits` does the same for price: a
seller unilaterally names the credits in the challenge (and can raise it on a
re-challenge), so without a cap the helper pays whatever is asked.

### What `paid: false` does and does not mean

`paid` is `response.ok && settled` — it does **not** mean nothing was
attempted. Check `credentialsPresented` (0, 1 or 2) before deciding a blind
retry is safe:

- **`credentialsPresented === 0`** — no credential was ever minted or sent.
  The endpoint may not speak MPP, or never returned a challenge. A retry here
  is exactly as safe as calling `fetch` again.
- **`credentialsPresented > 0` and `settled === false`** — one or two
  credentials were minted and presented, and their fate is not known to the
  caller (the seller may have burned credits and failed to respond, or the
  receipt could not be decoded). **Do not blindly retry** — that mints and
  presents yet another credential. Inspect `response` and `creditsPresented`
  first.
- **`settled === true`** (equivalently, `receipt` is present) — the payment
  succeeded regardless of what `paid` says. `paid` additionally requires the
  HTTP response itself to be a 2xx; a settle-then-error response from a
  seller is `settled: true, paid: false`.

A request to an endpoint that never challenges (no 402 at all) comes back
untouched, with `paid: false` and `credentialsPresented: 0` — this holds for
any body type, including a `ReadableStream`.

### Streaming request bodies

A `ReadableStream` request body works exactly like plain `fetch` **as long as
the endpoint never challenges the request** — the single underlying `fetch()`
consumes it once, safely. The one caveat: if the endpoint *does* answer with a
402 challenge, the retry needs to resend the same body, and a stream can only
be read once. In that case `payments.mpp.fetch` throws before attempting the
retry, rather than let it fail with an opaque runtime error. A `string`,
`Buffer`/`ArrayBuffer`/typed array, `URLSearchParams`, `FormData` or `Blob`
body has no such caveat — pass one of those instead if the endpoint may
challenge the request.

### Errors

Two families, thrown for different reasons:

- **`PaymentsError`** (`code: 'validation'`) — a guard this call refused to
  even attempt: a missing or unusable `delegationConfig` (it must carry a
  `delegationId` — the deprecated inline create-on-the-fly shape is not
  accepted here), a challenge naming a different plan than `planId` pinned, a
  challenge asking for more credits than `maxCredits` allows, or a
  `ReadableStream` body that a retry would need to replay. Nothing was ever
  minted when one of these throws.
- **`MppError`** and its typed subclasses — what the wire actually said:
  `MppNotConfiguredError` when the environment has MPP switched off,
  `MppCredentialRejectedError` when the backend names that code explicitly, a
  generic `MppError` for a rejection the backend answers without a code
  (including the seller replaying an identical challenge), and a generic
  `MppError` for a 402 whose challenge could not be decoded at all.

`MppChallengeExpiredError` (`BCK.MPP.0004`) is never thrown by this helper —
it is exactly the case `payments.mpp.fetch` retries automatically, once, with
a fresh challenge, so the caller never sees it.

### Note on schemes

This helper mints `nvm:erc4337` access tokens only in this release. A buyer
holding an `nvm:card-delegation` delegation cannot use `payments.mpp.fetch`
yet — use `payments.x402.getX402AccessToken` with `scheme: 'nvm:card-delegation'`
against an x402-only route instead.
