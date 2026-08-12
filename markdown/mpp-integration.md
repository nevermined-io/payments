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
  (including the seller replaying an identical challenge, or an unreadable/
  non-JSON 402 body), and a generic `MppError` for a 402 whose challenge could
  not be decoded at all.

#### Which backend codes are retryable

A 402 that comes back after a credential was presented carries a backend
code. Only two are retryable — everything else is terminal and surfaces as a
typed error instead of a second mint:

| Code | Meaning | Retryable? |
|---|---|---|
| `BCK.MPP.0004` | The challenge expired | Yes — retried automatically, once, with the fresh challenge the 402 carries |
| `BCK.MPP.0005` | The request body did not match the digest sealed in the challenge | Yes — the fresh challenge is sealed to the body that just arrived, so a new credential for it (same body) matches; retried automatically, once |
| `BCK.MPP.0003` | The credential was refused (replay, forgery, wrong plan, insufficient balance) | No — terminal, throws `MppCredentialRejectedError` |
| `BCK.MPP.0002` | MPP is not configured on this environment | No — terminal, throws `MppNotConfiguredError` (surfaces from the mint, before any challenge is even presented) |
| Any other code, or none at all, on a credential-bearing retry | A non-compliant or third-party seller, a proxy/WAF page, or an unexpected backend failure (e.g. a `network_error`/`http_500`-shaped code) | No — terminal, throws a generic `MppError` |

Both retryable codes share the same one-shot budget: `payments.mpp.fetch`
follows at most one re-challenge cycle per call, so a seller that keeps
challenging a freshly paid credential is not satisfied by looping.
`MppChallengeExpiredError` and `MppBodyDigestMismatchError` are therefore
never thrown by this helper — they name exactly the two cases it retries
automatically, so the caller never sees them as exceptions.

### Note on schemes

This helper mints `nvm:erc4337` access tokens only in this release. A buyer
holding an `nvm:card-delegation` delegation cannot use `payments.mpp.fetch`
yet — use `payments.x402.getX402AccessToken` with `scheme: 'nvm:card-delegation'`
against an x402-only route instead.
