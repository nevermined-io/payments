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

## The 402 body: `code` and `retryable`

Every `402` carries a JSON body shaped `{ error, message, code?, retryable? }`.
`code` and `retryable` are present together, or not at all — this is the
signal a non-SDK buyer (anything not using this package's typed error
classes) needs to implement the retry loop correctly:

- **No credential was presented yet.** `code` and `retryable` are both
  absent. This is the opening challenge; pay it.
- **A credential was presented and rejected.** `code` is one of the
  backend's `BCK.MPP.*` codes, and `retryable` says whether minting a fresh
  credential against the new challenge on this same `402` can succeed:
  - `retryable: false` — the credential itself was refused (forged, replayed,
    wrong plan, insufficient balance, all collapsed into `BCK.MPP.0003` so
    the endpoint cannot be used to probe *which* check failed). Paying again
    with a new credential changes nothing; treat this as terminal.
  - `retryable: true` — the challenge expired (`BCK.MPP.0004`) or the request
    body did not match the digest sealed into the challenge
    (`BCK.MPP.0005`, only when the route uses `bindBody`). Mint a fresh
    credential against the challenge this same response carries and retry
    once.

`code` is never anything outside the `BCK.MPP.*` namespace — a transport or
infrastructure failure (a network error, a `5xx` from the seller's own
backend) never appears here, so its absence on a `402` is not itself a
retryable signal on its own; only a genuine `BCK.MPP.*` rejection is.

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
challenge, so a credential minted for one body cannot be spent on another.

`captureRawBody` only runs for the content-type the parser it is mounted on
matches — `express.json({ verify: captureRawBody })` covers `application/json`
and nothing else. A route that also accepts other content-types needs the
hook wired into each parser it uses, or body binding fails for those requests.

When `bindBody` is on and a request has a body (a non-zero `Content-Length`,
or `Transfer-Encoding`) but its raw bytes were never captured, the middleware
refuses the request rather than minting an unbound challenge — the binding is
a security property, and it fails closed: a `500` if the request looked like
the parser should have captured it (a likely configuration mistake), a `400`
if the request's content-type is not one this route captures at all. Neither
case falls through to a re-serialized-JSON digest; the alternative — silently
serving an unbound challenge whenever the buyer's request shape does not
match — would let the buyer, not the seller, decide whether binding applies.

If the seller's own settlement fails after a paid, delivered request, the
buyer still receives their `2xx` response but no `Payment-Receipt` header —
the settlement outcome is not otherwise visible on the wire.

A seller who wires `onAfterSettle` (a `paymentMiddleware` option) sees more
than the wire does. Settlement is the one MPP call that burns, so a request
to the backend that times out before answering is not the same as one the
backend actually rejected: the credits may already be burned even though
nothing came back. That case is reported to `onAfterSettle` as
`{ outcome: 'unknown', reason }` — the exported `MppSettlementOutcomeUnknown`
type — instead of the usual `MppSettleResult`, and `settleCredential` itself
rejects with the exported `MppSettlementOutcomeUnknownError` (extends
`MppError`, carries no `code` since it is never backend-issued) rather than a
generic network error, so a seller calling `settleCredential` directly can
`instanceof`-check it too. `onAfterSettle`'s third parameter is typed
`unknown`, so narrow to `MppSettlementOutcomeUnknown` explicitly before
reading `outcome` — a blind cast to `MppSettleResult` reads `undefined` for
`creditsRedeemed` on this branch with no compile-time or runtime signal.

A `credits` function is evaluated once per *request* handled by this
middleware — once when the challenge is minted, and again when the paid
request presents its credential — so twice per full payment cycle, not once.
Anything with a side effect (metering, a counter, a DB write) in that
function runs twice.

## Concurrent requests with the same credential

Verifying a credential burns nothing, and settling the same credential twice
burns once — that idempotency is what makes settlement safe to retry, and it
is also what would make concurrent delivery cheap: without a guard, two
requests presenting the same credential at the same time would both pass
verification, both be served, and the two settlements would collapse into a
single burn.

The middleware guards against this **within one Node process**: a second
request presenting a credential that is already verified but not yet settled
is refused with `409 Conflict` rather than served. This does **not** extend
across multiple processes or horizontally-scaled instances of this
middleware — they do not share the in-memory guard, and a deployment that
scales this middleware horizontally needs its own mitigation (e.g. a shared
store such as Redis) for the same race across instances.
