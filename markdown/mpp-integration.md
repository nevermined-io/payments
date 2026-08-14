---
title: 'MPP Integration'
description: 'Protect Express routes with the Machine Payments Protocol (MPP), a second payment framing over the same plans, delegations and credits as x402'
icon: 'handshake'
---

# MPP Integration

The Machine Payments Protocol (MPP) is a second payment framing over the same
Nevermined plans, delegations and credits that x402 uses. Turning it on for a
route does not change the plan, the credits or the route configuration.

## Header table

| Header             | Direction                 | Purpose                            |
| ------------------ | ------------------------- | ---------------------------------- |
| `WWW-Authenticate` | Server → Client (402)     | Carries the `Payment …` challenge  |
| `Authorization`    | Client → Server           | Carries the `Payment …` credential |
| `Payment-Receipt`  | Server → Client (success) | Carries the settlement receipt     |

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
    the endpoint cannot be used to probe _which_ check failed). Paying again
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

A request that carries **no body at all** on a `bindBody` route is bound to
the digest of zero bytes rather than left unbound. Minting unbound would
reopen the same hole from the other side: the backend only compares digests
when the challenge carries one, so a buyer could mint with an empty request
and then attach any body they liked to the paid retry. A bodyless retry
reproduces the empty digest and passes; one that grew a body does not.

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
`MppError`, and carries the stable `code` `'settlement_outcome_unknown'` —
outside the `BCK.MPP.*` namespace the backend owns) rather than a generic
network error, so a seller calling `settleCredential` directly can check it
by `instanceof` **or** by `error.code`. Prefer `code` where two copies of
this package could end up in one dependency tree, or across a process or
serialization boundary: `instanceof` is false there for a genuinely-MPP
error, and the check degrades silently to the "nothing was burned" path.

The same unknown-outcome treatment covers a settle whose `2xx` body cannot be
read: the backend answered, so the burn committed, and only the response was
lost. `onAfterSettle`'s third parameter is typed
`unknown`, so narrow to `MppSettlementOutcomeUnknown` explicitly before
reading `outcome` — a blind cast to `MppSettleResult` reads `undefined` for
`creditsRedeemed` on this branch with no compile-time or runtime signal.

### `onPaymentError` on an MPP route

On MPP routes `onPaymentError` **notifies**; the middleware keeps ownership of
the response unless your handler answers the request itself. This differs from
the x402 branch, where the hook takes over: an MPP `402` has to carry a fresh
`WWW-Authenticate` challenge for the buyer to make any progress, and a hook
wired purely for observability must not strip it.

It fires for rejected credentials, expiries, digest mismatches, body-binding
refusals and challenge-issuance failures — but **not** for the initial
credential-less request. In MPP the first request of every payment cycle is
unpaid by design, so notifying there would fire the hook on every successful
payment and drown the failures it exists to surface. A hook that throws is
logged and the challenge is still sent.

A `credits` function is evaluated once per _request_ handled by this
middleware — once when the challenge is minted, and again when the paid
request presents its credential — so twice per full payment cycle, not once.
Anything with a side effect (metering, a counter, a DB write) in that
function runs twice.

## A credential buys exactly one response

Verifying a credential burns nothing, and settling the same credential twice
burns once — that idempotency is what makes settlement safe to retry. On its
own it would also make a **replay** free: a buyer who presents the same
credential again passes verification (nothing was burned to notice), is
served again, and the second settlement collapses onto the first burn. The
backend cannot refuse that — a replayed settle succeeding _is_ its
idempotency contract working as designed — so single-use is enforced at the
seller edge.

Two guards do it, both **within one Node process**:

- **Concurrent** — a second request presenting a credential that is verified
  but not yet settled is refused with `409 Conflict`.
- **Sequential** — a credential that has already bought a response is
  refused with a `402` carrying a **fresh challenge** and
  `code: "BCK.MPP.0003"` (`retryable: false`), for the 300-second lifetime
  of the challenge it came from. After that the challenge has expired and
  the backend refuses the credential anyway.

A credential is only marked spent when a `2xx` is actually delivered for it.
A request your handler answers with a `4xx`/`5xx` never settles, so the buyer
keeps their claim and can retry with the same credential.

Neither guard extends across multiple processes or horizontally-scaled
instances of this middleware — they do not share the in-memory state, and a
deployment that scales this middleware horizontally needs its own mitigation
(e.g. a shared store such as Redis) for both races across instances.
