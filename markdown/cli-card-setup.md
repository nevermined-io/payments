---
title: "CLI Card Setup (Top-Level Redirect Flow)"
description: "Hand a user off to the Nevermined webapp to enrol a card and create a spending delegation from a CLI or other top-level browser-tab integration"
icon: "browser"
---

# CLI Card Setup (Top-Level Redirect Flow)

Nevermined ships a standalone embed app (served at `embed.<tier>` — e.g. `embed.nevermined.app`) with a chromeless **card setup** page at `/cards/setup` that walks a user through:

1. Enrolling a credit / debit card (via Stripe Elements — sensitive data never touches your servers).
2. Creating a spending delegation against that card (a per-card budget the user pre-authorises for agent spend).

This guide explains how a **CLI or any other non-iframe integrator** can drive that page in a top-level browser tab and receive `paymentMethodId` + `delegationId` back at a localhost HTTP callback. The pattern mirrors `nvm login`: print a URL, the user clicks it, the browser redirects back to a one-shot port on the user's machine, your process resolves with the result.

The official `nvm` CLI ships three commands implementing this flow out of the box — see [`nvm cards setup`](#using-the-nvm-cli) below. If you are building your own CLI or backend integration, the rest of this guide is the contract you need to honour.

## When to Use This Flow

- You are building a CLI, terminal tool, or other application that runs on the user's machine and wants to attach a card to the user's Nevermined account without forcing them into your own UI for the tokenization step.
- You want a **white-labeled** card setup page that respects the parent organisation's branding (logo, panel colours, button colours), but you do not want to host an iframe.
- You need both the `paymentMethodId` and the `delegationId` in one round-trip — the combined `setup` flow emits both in a single callback.

For the classic iframe integration (a website embedding `/cards/enroll` etc. inside an `<iframe>` and listening for `postMessage`), see the `@nevermined-io/ui-widgets` package instead.

## Two Authentication Paths

| Path | Who uses it | Authentication |
|------|-------------|---------------|
| **Widget-key** | A third-party (website backend, CLI) acting on behalf of an organisation's own end-users. The end-users do not necessarily have their own Nevermined accounts. | Server signs an init-token with the organisation's widget-key secret and exchanges it at `POST /widgets/session` for a session token. |
| **Self-mint** | A user with their own NVM API key (typically after running `nvm login`) who wants to attach a card to their *own* Nevermined identity. | `POST /widgets/session/self` with `Authorization: Bearer <nvmApiKey>`. |

Both paths produce the same response shape (`WidgetSessionResponse`); the embed routes don't branch on which one was used.

Card setup is **organization-scoped**. Self-mint callers must be members of at least one Nevermined organisation. Widget-key sessions are inherently org-scoped through the widget key itself.

## Basic Flow

```text
┌──────┐                            ┌────────────┐                             ┌─────────────┐                     ┌────────────────┐
│ CLI  │                            │ Backend    │                             │ User Browser│                     │ Local Callback │
│      │                            │ (Nevermined│                             │             │                     │  HTTP Server   │
└──┬───┘                            └─────┬──────┘                             └──────┬──────┘                     └────────┬───────┘
   │                                      │                                           │                                     │
   │ start one-shot server on             │                                           │                                     │
   │ 127.0.0.1:<random> /callback ───────────────────────────────────────────────────────────────────────────────────────────▶ listening
   │                                      │                                           │                                     │
   │ POST /widgets/session/self           │                                           │                                     │
   │   Bearer <nvmApiKey>                 │                                           │                                     │
   │   body { orgId, returnUrl }          │                                           │                                     │
   ├────────────────────────────────────▶│ verify org membership                     │                                     │
   │                                      │ mint session JWT (kind:'self-mint')       │                                     │
   │◀────────────────────────────────────┤ { sessionToken, isReturnUrlAllowed }      │                                     │
   │                                      │                                           │                                     │
   │ open browser at                      │                                           │                                     │
   │ {embed}/cards/setup                  │                                           │                                     │
   │  ?sessionToken=...                   │                                           │                                     │
   │  &returnUrl=http://127.0.0.1:<port>  │                                           │                                     │
   │  &state=<rand>  &provider=stripe     │                                           │                                     │
   ├──────────────────────────────────────────────────────────────────────────────────▶ navigate                            │
   │                                      │                                           │                                     │
   │                                      │ GET /widgets/session/validate            │                                     │
   │                                      │  Bearer <sessionToken>                   │                                     │
   │                                      │  X-Nvm-Widget-Return-Url: <returnUrl>    │                                     │
   │                                      │◀──────────────────────────────────────────│                                     │
   │                                      │ { valid, isReturnUrlAllowed, ... }       │                                     │
   │                                      │──────────────────────────────────────────▶│                                     │
   │                                      │                                           │                                     │
   │                                      │ Step 1: Enroll card                      │                                     │
   │                                      │   Stripe Elements + SetupIntent          │                                     │
   │                                      │   POST /delegation/setup-intent          │                                     │
   │                                      │   POST /delegation/finalize-enrollment   │                                     │
   │                                      │   → paymentMethodId                      │                                     │
   │                                      │                                           │                                     │
   │                                      │ Step 2: Create delegation                │                                     │
   │                                      │   POST /delegation/create                │                                     │
   │                                      │   → delegationId                         │                                     │
   │                                      │                                           │                                     │
   │                                      │ window.location.replace(returnUrl + ?    │                                     │
   │                                      │   paymentMethodId&delegationId&state)    │                                     │
   │                                      │──────────────────────────────────────────▶ GET callback                         │
   │                                      │                                           │                                     │
   │◀──────────────────────────────────────────────────────────────────────────────────────────────────resolved { ids, state }
   │                                      │                                           │                                     │
   │ verify state matches → resolve        │                                           │                                     │
   │ shutdown server                       │                                           │                                     │
```

The browser ends up on a friendly "All done — close this tab" page so the user knows the flow finished; your CLI prints the IDs and exits.

## Using the `nvm` CLI

Three commands are available out of the box:

```bash
# Combined: enroll a card AND create a delegation in one flow.
# Returns both paymentMethodId and delegationId.
nvm cards setup

# Single-purpose: only enroll a card. Returns paymentMethodId.
nvm cards enroll

# Single-purpose: only create a delegation against an already-enrolled card.
# Returns delegationId.
nvm cards delegate --card pm_1234
```

All three accept:
- `--org <id>` — Required if you belong to multiple organisations and the terminal is non-interactive (CI). Inferred silently when you belong to exactly one org. In an interactive terminal with two or more memberships, the CLI prompts you to pick.
- `--no-browser` — Print the URL instead of opening the browser automatically (useful over SSH or in CI).
- `--provider stripe|braintree|visa` — Tokenization provider for the enrolment step. Defaults to `stripe`.

Pre-requisite: run `nvm login` first to authenticate against the target environment.

```bash
$ nvm cards setup
ℹ Using organization: Acme AI (org-abc-123)
Opening browser...
Waiting for completion...
✓ Card setup complete!
  paymentMethodId: pm_1ABCD…
  delegationId:    9719d8b5-…
  organization:    org-abc-123
```

## Implementing the Flow Yourself

If you are building your own CLI (in a non-Node language, or with stricter packaging requirements), implement the four steps below. The pattern works in any language with an HTTP client, a way to open a browser, and the ability to bind a local TCP port.

### 1. Start a one-shot localhost HTTP server

Bind to `127.0.0.1:0` (the OS picks a free port). Listen on `/callback`. Note the port — you need it for `returnUrl`.

Bind to `127.0.0.1` only, **never `0.0.0.0`** — your callback should not be reachable from the network.

### 2. Mint a session token

For the **self-mint** path (a user with their own `nvmApiKey`):

```http
POST {api}/api/v1/widgets/session/self
Authorization: Bearer <nvmApiKey>
Content-Type: application/json

{
  "orgId": "org-abc-123",
  "returnUrl": "http://127.0.0.1:54321/callback"
}
```

Response:

```json
{
  "sessionToken": "eyJ...",
  "userId": "us-...",
  "userWallet": "0x...",
  "apiKeyHash": "sandbox:eyJ...",
  "expiresAt": "2026-05-22T19:00:00.000Z",
  "isReturnUrlAllowed": true
}
```

If the user is not a member of the requested org you get `403 BCK.WIDGET_SESSION.0019`. If they have no org memberships at all, `403 BCK.WIDGET_SESSION.0018`.

For the **widget-key** path, see the existing `POST /widgets/session` documentation in the `@nevermined-io/ui-widgets-server` SDK.

### 3. Open the browser

Construct the URL and open it (`xdg-open` / `open` / `start`):

```
{embed}/cards/setup?sessionToken=<token>&returnUrl=<urlEncoded callback>&state=<random>&provider=stripe
```

`{embed}` is the standalone embed app origin for your environment (`https://embed.nevermined.app` for live/sandbox, `https://embed.nevermined.dev` for staging) — formed by prepending `embed.` to the webapp host.

Required query parameters:
- `sessionToken` — from step 2.
- `returnUrl` — your localhost callback URL.
- `state` — a cryptographically random nonce (16+ bytes, hex-encoded). The browser echoes it back in the redirect; you reject any callback that doesn't echo this value (CSRF binding).
- `provider` — `stripe`, `braintree`, or `visa`.

Three other routes exist if you only need one step of the flow:

| Route | Result fields in the callback |
|-------|--------------------------------|
| `/cards/setup` | `paymentMethodId`, `delegationId` |
| `/cards/enroll` | `paymentMethodId` |
| `/cards/delegate?paymentMethodId=<id>` | `delegationId` |

### 4. Wait for the callback

The browser redirects to `<returnUrl>?paymentMethodId=…&delegationId=…&state=<echo>` on success. Your local server should:

1. Verify the `state` query parameter matches the one you issued. Use a constant-time string comparison (the `nvm` CLI uses `crypto.timingSafeEqual`).
2. Extract `paymentMethodId` and `delegationId` (or just one, depending on which embed route you opened).
3. Respond `200 OK` with a friendly "you can close this tab" HTML page.
4. Close the server.

Recommended timeout: **5 minutes**. Match the `nvm login` flow so users have time to switch contexts in their browser.

### Pseudocode

```ts
// TypeScript / Node — the same shape works in any language.
import { createServer } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'

const orgId = process.env.NVM_ORG_ID!
const nvmApiKey = process.env.NVM_API_KEY!
const state = randomBytes(16).toString('hex')

const server = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://localhost')
  if (url.pathname !== '/callback') {
    res.writeHead(404).end()
    return
  }
  const received = url.searchParams.get('state') ?? ''
  // Validate hex shape FIRST so we never feed UTF-8 buffers of unequal
  // byte length into timingSafeEqual (it throws on length mismatch).
  // Both sides are 32-char hex (16 random bytes) by construction.
  const HEX_32 = /^[0-9a-f]{32}$/i
  if (
    !HEX_32.test(received) ||
    !timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(state, 'hex'))
  ) {
    res.writeHead(400, { 'Content-Type': 'text/html' }).end(
      '<h2>State mismatch</h2><p>Close this tab and re-run the command.</p>',
    )
    return
  }
  const paymentMethodId = url.searchParams.get('paymentMethodId')
  const delegationId = url.searchParams.get('delegationId')
  res.writeHead(200, { 'Content-Type': 'text/html' }).end(
    '<h2>Card setup complete</h2><p>You can close this tab.</p>',
  )
  console.log({ paymentMethodId, delegationId })
  server.close()
})

server.listen(0, '127.0.0.1', async () => {
  const port = (server.address() as { port: number }).port
  // Use 127.0.0.1 (not the `localhost` alias) to match the server bind
  // above. Node 17+ prefers ::1 for `localhost` on IPv6-capable hosts
  // and the browser would stall on the IPv6 attempt before falling back.
  const returnUrl = `http://127.0.0.1:${port}/callback`

  // Mint a session token bound to one of the user's orgs.
  const mint = await fetch('https://api.sandbox.nevermined.app/api/v1/widgets/session/self', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nvmApiKey}` },
    body: JSON.stringify({ orgId, returnUrl }),
  }).then((r) => r.json())

  const setupUrl = new URL('/cards/setup', 'https://embed.nevermined.app')
  setupUrl.searchParams.set('sessionToken', mint.sessionToken)
  setupUrl.searchParams.set('returnUrl', returnUrl)
  setupUrl.searchParams.set('state', state)
  setupUrl.searchParams.set('provider', 'stripe')

  console.log('Open this URL in your browser:\n')
  console.log(setupUrl.toString())
})
```

## Allowed `returnUrl` Hosts

The server validates `returnUrl` against the session's allow-list. The same allow-list runs at **session-creation time** (response field `isReturnUrlAllowed`) and again at **page-load time** (via the `X-Nvm-Widget-Return-Url` header the embed page forwards on `/validate`). The page refuses to mount if the URL is not allowed, so a stale or wrong `returnUrl` can never leak the result IDs to an unauthorised destination.

Rules:
- `localhost`, `127.0.0.1`, `[::1]` (any port, any path) — accepted for **both** session kinds.
- Other `https://` origins — accepted only for **widget-key** sessions whose key has the origin in its `allowedOrigins` list. **Self-mint sessions reject any non-localhost host** (there is no widget-key allow-list to widen).

## Error Codes

| Code | Meaning |
|------|---------|
| `BCK.WIDGET_SESSION.0018` | Caller has no active organisation memberships. Self-mint is members-only — create or join an organisation in the dashboard first. |
| `BCK.WIDGET_SESSION.0019` | The `orgId` in the request is not one of the caller's memberships. |
| `BCK.WIDGET_SESSION.0001` | Invalid widget credentials (widget-key path only). |
| `BCK.APIKEY.0004` | Invalid or expired NVM API key (self-mint path only). |

## Security Notes

- **Bind only to `127.0.0.1`**, not `0.0.0.0`. Your callback server is for the local user, not the network.
- **Use a per-flow random `state` value** (16+ bytes, hex-encoded). Compare callbacks in constant time. Reject any callback whose `state` does not match.
- **Treat the session token like a bearer credential.** It carries the user's `apiKeyHash` and expires in 2 hours. Don't log it, don't persist it past the flow.
- **Page lifecycle is single-use.** The embed page strips `sessionToken` from the URL immediately after the page consumes it, so it never lands in the browser back-forward history or in any later `document.referrer`. If the user hits "back" after the redirect, they will not land on a re-playable URL.

## See Also

- [`nvm login`](./installation.md) — the equivalent flow for authentication.
- [Payment Plans](./payment-plans.md) — once a card is delegated, you can use it to subscribe to plans.
- [Initialising the Library](./initializing-the-library.md) — bootstrap the SDK.
