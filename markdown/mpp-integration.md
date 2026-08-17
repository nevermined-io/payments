---
title: 'MPP Integration'
description: 'Protect Express routes with the Machine Payments Protocol (MPP), a second payment framing over the same plans, delegations and credits as x402'
icon: 'handshake'
---

# MPP Integration

> **Experimental.** The `mpp` route option and the `payments.mpp.*` surface ship
> ahead of their epic's declared MVP scope. The names are settled — `payments.mpp`
> beside `payments.x402` is what you would guess, and renaming it after a tag
> costs a major — but the shapes may change in a minor release until the epic
> adopts them.

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
infrastructure failure (a network error, a `5xx` from the seller's own backend)
is stripped rather than forwarded, so a **codeless** `402` is exactly what a
verify-side infrastructure failure looks like from the buyer's side.

Absence of a `code` is therefore not a rejection signal, and not a retry signal
either. What the buyer keys on instead is whether the same `402` carries a
genuinely **fresh** challenge (a different `id`): a fresh challenge means "here
is a new price, pay it", a replayed `id` means "your credential was refused".
See [Which backend codes are retryable](#which-backend-codes-are-retryable).

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
refusals, challenge-issuance failures, a settle that definitively fails, and
a buyer disconnecting while settlement was still in flight — but **not** for
the initial credential-less request. In MPP the first request of every
payment cycle is unpaid by design, so notifying there would fire the hook on
every successful payment and drown the failures it exists to surface.

It **does** fire when an `Authorization` header is present but carries no
`Payment` scheme at all — that shape means an intermediary rewrote it (a
gateway injecting its own `Bearer`, a reverse proxy with its own auth), which
otherwise puts the buyer in a silent infinite loop with no error visible on
either side. A hook that throws — synchronously or as a rejected `async`
function — is logged and the challenge is still sent.

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

Two guards do it, both **within one Node process** and both keyed on the
credential's `challenge.id` — not on the raw header bytes, which the buyer
can vary (scheme case, whitespace, JSON key order) without changing which
credential they are:

- **Concurrent** — a second request presenting a credential that is verified
  but not yet settled is refused with `409 Conflict`. Check-and-claim is one
  atomic step with no `await` in between, so two requests racing the same
  credential cannot both pass.
- **Sequential** — a credential that has already bought a response is
  refused with a `402` carrying a **fresh challenge** and
  `code: "BCK.MPP.0003"` (`retryable: false`), for the 300-second lifetime
  of the challenge it came from. After that the challenge has expired and
  the backend refuses the credential anyway.

A credential that cannot be decoded into a `challenge.id` at all is refused
the same way, without a backend round-trip — the backend would reject it too.

A credential is only marked spent when a `2xx` is **actually delivered** for
it — a status code alone is not delivery, since an aborted request still
reports `200`. If the buyer disconnects before any of the response reaches
them, settlement never runs and the credential stays theirs to retry with;
`onPaymentError` still fires so the loss is visible on the seller's side,
since MPP has no void or reversal for a burn that already committed before
the disconnect was noticed. A request your handler answers with a `4xx`/`5xx`
never settles either, so the buyer keeps their claim there too.

**The reverse also holds, and it matters most for streaming endpoints.** On a
streamed response (SSE, token streaming — the shape most agent endpoints
take) the buyer receives the value at `res.write()`, well before your handler
calls `res.end()`. A buyer who reads the payload and then hangs up **has been
served**, so that request settles and the credential is marked spent. Delivery
is measured as bytes actually put on the wire for that response, not as a
socket still being open at the end of it — otherwise a buyer could stream the
answer, disconnect, and replay the same credential for the rest of the
challenge TTL.

Neither guard extends across multiple processes or horizontally-scaled
instances of this middleware — they do not share the in-memory state, and a
deployment that scales this middleware horizontally needs its own mitigation
(e.g. a shared store such as Redis) for both races across instances.

## Settlement outcomes your accounting has to distinguish

`settleCredential` can end three ways: a definite success, a definite
failure, or **unknown** — the backend answered with a `5xx`/`408`, or timed
out, or returned a `2xx` whose body could not be read, or the connection was
reset after the request had already been written (`ECONNRESET`, `EPIPE`,
`UND_ERR_SOCKET`). In all of those the credits may already be burned;
reporting them as a definite failure would make a real burn silently vanish
from your records. Failures that prove nothing was reached — `ECONNREFUSED`,
`ENOTFOUND`, `EAI_AGAIN`, and the backend's own `4xx` rejections — stay
definite, because inflating your records with burns that never happened is
the same corruption in the other direction.

`onAfterSettle`'s third parameter is `unknown` precisely so a definite
failure and an unknown outcome cannot be confused for the same shape — a
definite failure reports `creditsToSettle: 0` (nothing burned, as far as this
side can prove), while an unknown outcome reports the charged amount and
`{ outcome: 'unknown', reason }`. Narrow to `MppSettlementOutcomeUnknown`
explicitly before reading `outcome`.

Two consequences worth knowing before you wire up accounting:

- **A definite settlement failure still delivers the response.** The buyer
  gets what they asked for even though the burn did not happen — the
  alternative would be destroying a response your handler already produced.
  `onPaymentError` fires so you can reconcile, but the resource is gone.
- **`paymentContext.creditsToSettle` is only reliable on the buffered path.**
  When the handler streams (headers already flushed before `res.end()`),
  settlement is detached and `res.on('finish')` fires before it resolves, so
  the context still holds the optimistic pre-settle amount. On the buffered
  path the response is held until settlement resolves, so it is accurate
  there. **Read the settled amount from `onAfterSettle`, not from
  `paymentContext`** — that is the only place correct on both paths.

## Paying an MPP endpoint

> **`payments.mpp.*` is `@experimental`.** The buyer surface — `MppFetchOptions`,
> `MppFetchResult` and the fields on them — may change in a minor release.
> `MppFetchResult` gained `settled` and `creditsPresented` between two rounds of
> a single review; pin the package version if that matters to you.

```typescript
const { delegationId } = await payments.delegation.createDelegation({
  provider: 'erc4337',
  spendingLimitCents: 10000,
  durationSecs: 604800,
  currency: 'usdc',
})

const { response, receipt, paid, settled, credentialsPresented } = await payments.mpp.fetch(
  'https://agent.example/ask',
  {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: 'hello' }),
  },
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

`maxCredits` is a budget for the **whole call**, not for one challenge: the
credits a challenge asks for are added to what earlier turns of the same call
already committed, and the call is refused as soon as the running total would
exceed the cap. `creditsPresented` on the result is that same running total —
the sum across every credential presented, not the last challenge's price. It
must be a non-negative integer (decimal string, safe integer or `bigint`);
anything else is refused with a `PaymentsError` before the first request, not
mid-flight on whatever 402 arrives.

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
  seller is `settled: true, paid: false`. `settled` is exactly "a receipt
  decoded cleanly": `receipt.status` is a seller-set string with no agreed
  vocabulary beyond `'success'`, so it is deliberately not interpreted —
  read it yourself if you are paying a third-party seller and it matters.
  This SDK's own middleware attaches a receipt only when settlement succeeded.

A request to an endpoint that never challenges (no 402 at all) comes back
untouched, with `paid: false` and `credentialsPresented: 0` — this holds for
any body type, including a `ReadableStream`.

**`response.ok === true` with `paid: false` and `credentialsPresented: 1` is a
routine outcome, not an exotic one.** A seller whose handler streams or flushes
has already sent its headers by the time settlement runs, so it cannot attach
`Payment-Receipt` to a response that is on the wire — this SDK's own middleware
settles detached in exactly that case and says so in its own log line. The
credits **were** burned. Never read that combination as "the payment did not
happen" and retry it.

#### What comes back as a 402 instead of throwing

Only a rejection the remote **named** throws. Three dead ends resolve with the
402 as `response`, because that response is evidence you may need and throwing
would discard it:

1. A 402 with no **usable** `Payment` challenge, on either turn: no
   `WWW-Authenticate` header, a different scheme, or a `Payment` challenge
   missing a required param — the decoder returns nothing for all three, so a
   seller that announced `Payment` but sent it malformed lands here too, not
   only one that does not speak MPP. `credentialsPresented: 0`.
2. A retry-turn 402 that is retryable but carries no challenge to retry
   against, so there is nothing to mint for.
3. The one re-challenge cycle spent: two credentials presented and the seller
   still answering 402.

Cases 2 and 3 come back with a **non-zero** `credentialsPresented`, so a
resolved promise on its own does not mean the request was free. Check
`response.ok`.

### Streaming request bodies

A `ReadableStream` request body works exactly like plain `fetch` **as long as
the endpoint never challenges the request** — the single underlying `fetch()`
consumes it once, safely. The one caveat: if the endpoint _does_ answer with a
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
  accepted here), a malformed `maxCredits`, a challenge naming a different plan
  than `planId` pinned, a challenge that would take the call over `maxCredits`,
  or a `ReadableStream` body that a retry would need to replay.
- **`MppError`** and its typed subclasses — what the wire actually said:
  `MppNotConfiguredError` when the environment has MPP switched off,
  `MppCredentialRejectedError` when the backend names that code explicitly, a
  generic `MppError` for a rejection the backend answers without a code
  (including the seller replaying an identical challenge, or an unreadable/
  non-JSON 402 body), and a generic `MppError` for a 402 whose challenge could
  not be decoded at all.
- **`MppSpendOutcomeUnknownError`** (a subclass of `MppError`, code
  `spend_outcome_unknown`) — the credential-bearing retry failed at the
  transport level: a disconnect, a DNS failure, or your own `AbortSignal`
  firing between the mint and the retry. The credential was on the wire, so the
  seller may already have verified and burned it. The original failure is on
  `.cause`. This exists so such a failure cannot reach you as a raw `TypeError`
  that the `instanceof MppError` pattern below misses.

#### Errors report what was already spent

An argument guard on the **first** turn throws before anything is minted. A
guard on the **re-challenge** turn does not — a credential has already been
presented by then — so every error raised after a credential went out carries
the same accounting the success path returns. Read it with `mppSpendOf`, which
works across both error families (they share no base class):

```typescript
import { mppSpendOf, MppError } from '@nevermined-io/payments'

try {
  await payments.mpp.fetch(url, init, { delegationConfig: { delegationId }, maxCredits: 100 })
} catch (err) {
  const spend = mppSpendOf(err) // undefined => nothing was spent
  if (spend) {
    // spend.credentialsPresented, spend.creditsPresented, spend.challengeId
    // Do NOT blindly retry: those credits may already be burned.
  }
  if (err instanceof MppError) {
    /* the wire refused, or the retry never completed */
  }
}
```

#### Which backend codes are retryable

A 402 that comes back after a credential was presented carries a backend
code. Only two are retryable — everything else is terminal and surfaces as a
typed error instead of a second mint:

| Code                                                                                                                    | Meaning                                                                                                                                                                                                                                                | Retryable?                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BCK.MPP.0004`                                                                                                          | The challenge expired                                                                                                                                                                                                                                  | Yes — retried automatically, once, with the fresh challenge the 402 carries                                                                       |
| `BCK.MPP.0005`                                                                                                          | The request body did not match the digest sealed in the challenge                                                                                                                                                                                      | Yes — the fresh challenge is sealed to the body that just arrived, so a new credential for it (same body) matches; retried automatically, once    |
| `BCK.MPP.0003`                                                                                                          | The credential was refused (replay, forgery, wrong plan, insufficient balance)                                                                                                                                                                         | No — terminal, throws `MppCredentialRejectedError`                                                                                                |
| `BCK.MPP.0002`                                                                                                          | MPP is not configured on this environment                                                                                                                                                                                                              | No — terminal, throws `MppNotConfiguredError` (surfaces from the mint, before any challenge is even presented)                                    |
| **No code at all**, and the 402 carries a genuinely fresh challenge (different `id`)                                    | A seller that publishes no codes — a third party, or **this SDK's own middleware** when verification fails for infrastructure reasons: it forwards a code only when it starts with `BCK.MPP.`, so a synthesized `network_error`/`http_500` is stripped | Yes — treated as a real re-challenge and retried once, against the NEW challenge                                                                  |
| **No code at all**, and no fresh challenge — same `id` replayed, no parseable challenge, or an unreadable/non-JSON body | A seller refusing the credential it just issued that challenge for, or a proxy/WAF page                                                                                                                                                                | No — terminal, throws a generic `MppError`: minting against the same challenge again cannot help and would only spend twice                       |
| Any other code on a credential-bearing retry                                                                            | A non-compliant seller, or a backend failure surfacing a non-`BCK.MPP.*` code                                                                                                                                                                          | No — terminal, throws a generic `MppError`. When a code is present it decides alone; the fresh-challenge fallback applies only when there is none |

Both retryable codes share the same one-shot budget: `payments.mpp.fetch`
follows at most one re-challenge cycle per call, so a seller that keeps
challenging a freshly paid credential is not satisfied by looping.
`MppChallengeExpiredError` and `MppBodyDigestMismatchError` are therefore
never thrown by the **retry gate** — they name exactly the two cases it retries
automatically. They can still reach a caller from the **mint**, the other call
in the turn: `MppAPI.post` forwards the backend's `code` into the typed
hierarchy, so a mint answering `BCK.MPP.0004` surfaces as
`MppChallengeExpiredError` before any credential is presented — the same way
`BCK.MPP.0002` does in the row above.

### Note on schemes

This helper mints `nvm:erc4337` access tokens only in this release. A buyer
holding an `nvm:card-delegation` delegation cannot use `payments.mpp.fetch`
yet — use `payments.x402.getX402AccessToken` with `scheme: 'nvm:card-delegation'`
against an x402-only route instead.
