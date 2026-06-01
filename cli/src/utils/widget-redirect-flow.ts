import { createServer, IncomingMessage, ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import type { EnvironmentName } from '@nevermined-io/payments'

import { openBrowser } from './browser.js'

/**
 * The network the embed app resolves its active backend from. The embed
 * app reads `?network=` on mount and defaults to `sandbox` when absent
 * (it never decodes the session token to infer it), so a CLI flow that
 * omits this lands a live-minted session on the sandbox backend and
 * fails. We always forward it explicitly. See issue #362.
 */
export type EmbedNetwork = 'sandbox' | 'live'

/**
 * Map a CLI environment name to the embed app's `network` value. The
 * `embed` origin is shared across the sandbox/live pair within a tier
 * (`embed.nevermined.app` for both `sandbox` and `live`), differentiated
 * only by the backend the session is validated against — so the embed
 * app cannot infer the network from the origin and we must pass it.
 *
 * `custom` has no fixed tier, so we sniff `NVM_BACKEND_URL`: a backend
 * host containing `live` selects `live`, otherwise we fall back to
 * `sandbox` (matching the embed app's own default).
 *
 * NOTE: `live` is only matched as a dot/slash-bounded segment (the
 * `api.live.<host>` convention), so a hyphenated host like
 * `https://api-live.example.com` would fall through to `sandbox`. That's
 * intentional given the naming convention; a `custom` deployment that
 * doesn't follow it should set `NVM_BACKEND_URL` to a conforming host.
 */
export function resolveEmbedNetwork(environment: EnvironmentName): EmbedNetwork {
  switch (environment) {
    case 'live':
    case 'staging_live':
      return 'live'
    case 'sandbox':
    case 'staging_sandbox':
      return 'sandbox'
    case 'custom':
      return /(^|[.\/])live([.\/]|$)/.test((process.env.NVM_BACKEND_URL || '').toLowerCase())
        ? 'live'
        : 'sandbox'
  }
}

const SELF_MINT_FETCH_TIMEOUT_MS = 15_000

/**
 * Default timeout for a redirect-mode CLI flow. Mirrors the existing
 * `nvm login` callback timeout — 5 minutes is enough for the user to
 * tab into the browser, complete a card enrolment + delegation, and
 * land back at the CLI.
 */
const REDIRECT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Constant-time string equality for the CSRF `state` nonce. The state we
 * issue is a 32-char hex string (`randomBytes(16).toString('hex')`), so
 * we ALWAYS allocate fixed 16-byte buffers from `hex` regardless of the
 * caller-supplied value's encoding. Computing buffer length from string
 * length would diverge on non-ASCII input (`a.length` is UTF-16 code
 * units; `Buffer.from(a, 'utf8').length` is byte count), and a crafted
 * non-hex `received` could otherwise throw inside `timingSafeEqual`.
 *
 * Inputs must already have been verified to be 32 hex chars by the
 * caller (or we reject up front).
 */
function safeEqualHexState(received: string, expected: string): boolean {
  if (!/^[0-9a-f]{32}$/i.test(received) || !/^[0-9a-f]{32}$/i.test(expected)) return false
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'))
}

export interface WidgetRedirectFlowOptions {
  /** Embed app base URL — e.g. `Environments[env].embed` (`embed.<tier>`). */
  embedUrl: string
  /**
   * Relative path on the embed app the CLI wants to open, e.g.
   * `/cards/setup` or `/cards/enroll`.
   */
  embedPath: string
  /**
   * Embed-app network (`sandbox` / `live`). Forwarded as `?network=` so
   * the embed app validates the session against the matching backend —
   * derive it from the active environment via `resolveEmbedNetwork`.
   * Required: omitting it lets live flows silently hit sandbox (#362).
   */
  network: EmbedNetwork
  /**
   * Called once the local callback server is listening, with the bound
   * `returnUrl`. The caller mints a widget session against that URL and
   * returns the resulting `sessionToken`. Splitting it this way lets
   * the backend validate `returnUrl` at session-creation time (the
   * spec'd contract) — minting before the port is known would leave
   * the backend's pre-flight allow-list check with no URL to verify.
   */
  mintSession: (args: { returnUrl: string }) => Promise<{ sessionToken: string }>
  /** Extra query params to forward to the embed page (e.g. `provider=stripe`, `paymentMethodId=pm_x`). */
  extraSearchParams?: Record<string, string>
  /** If true, prints the URL instead of opening the browser. */
  noBrowser?: boolean
  /** Caller-supplied logger / printer. The login command uses oclif's formatter; this is the same shape. */
  log: (msg: string) => void
  /** Suggested success-page wording — keeps the wording aligned with whichever command is calling. */
  successPageTitle?: string
  /** Suggested timeout-error wording — keeps it specific to the calling command instead of "Card setup ..." for everything. */
  timeoutMessage?: string
}

export interface WidgetRedirectFlowResult {
  /** Echoed `state` value — the helper has already verified it matches. */
  state: string
  /** All query params the embed page redirected with (paymentMethodId, delegationId, …). */
  query: Record<string, string>
}

/**
 * Shared redirect-mode handshake for any CLI command that hands the user
 * off to a `/cards/*` page on the standalone embed app (`embed.<tier>`)
 * and waits for a localhost callback.
 *
 * Flow:
 *   1. Bind a one-shot HTTP server on `127.0.0.1:0` (the OS picks a free port).
 *   2. Compute `returnUrl = http://127.0.0.1:<port>/callback` and hand it
 *      to `opts.mintSession`. The caller mints a widget session bound to
 *      that exact returnUrl (which the backend can validate against the
 *      session-specific allow-list at creation time). We use the literal
 *      `127.0.0.1` rather than `localhost` because the server binds to
 *      `127.0.0.1` and Node 17+ resolves `localhost` to `::1` first on
 *      modern hosts — the browser would stall on the IPv6 attempt before
 *      falling back to IPv4.
 *   3. Open the browser at `{embed}/<path>?sessionToken=…&returnUrl=…&state=<rand>`.
 *   4. Resolve when the embed page redirects to `/callback?…&state=<echo>`.
 *      `state` is compared in constant time.
 *
 * Rejects on bind failure, mint failure, 5-minute timeout, or
 * state-mismatched callback (the bad request gets a styled error page
 * and the server stays alive — the legitimate callback can still land).
 */
export async function runWidgetRedirectFlow(
  opts: WidgetRedirectFlowOptions,
): Promise<WidgetRedirectFlowResult> {
  const state = randomBytes(16).toString('hex')

  return new Promise<WidgetRedirectFlowResult>((resolve, reject) => {
    let resolved = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finalize = (err?: Error, value?: WidgetRedirectFlowResult): void => {
      if (resolved) return
      resolved = true
      if (timeout) clearTimeout(timeout)
      server.close()
      if (err) reject(err)
      else if (value) resolve(value)
    }

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found')
        return
      }

      const receivedState = url.searchParams.get('state')
      if (!receivedState || !safeEqualHexState(receivedState, state)) {
        // INTENTIONALLY do NOT close the server here. The state nonce
        // is 128 bits of randomness, so brute-forcing one bad callback
        // per request is infeasible. Closing on first 400 would let an
        // attacker (or a misconfigured redirect) DoS the legitimate
        // browser callback that's about to arrive. The 5-minute timer
        // is the upper bound on how long we'll wait either way.
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(
          errorHtml(
            'Callback rejected',
            'State mismatch. This callback did not match the request that started the flow — close this tab and re-run the command.',
          ),
        )
        return
      }

      // Convert URLSearchParams → plain object, dropping the bookkeeping
      // `state` field (the caller doesn't need to re-validate it).
      const query: Record<string, string> = {}
      for (const [key, value] of url.searchParams.entries()) {
        if (key === 'state') continue
        query[key] = value
      }

      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        successHtml(
          opts.successPageTitle ?? 'All done',
          'You can close this tab and return to your terminal.',
        ),
      )
      finalize(undefined, { state, query })
    })

    timeout = setTimeout(() => {
      finalize(new Error(opts.timeoutMessage ?? 'Browser flow timed out after 5 minutes. Please try again.'))
    }, REDIRECT_TIMEOUT_MS)

    server.on('error', (err) => {
      finalize(new Error(`Failed to start local callback server: ${err.message}`))
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        finalize(new Error('Failed to obtain local callback port'))
        return
      }
      // Symmetric with the server bind above (`127.0.0.1` only). Using
      // the `localhost` alias here would cause an IPv6 stall on modern
      // Linux/macOS where Node's `dns.lookup` prefers `::1`. The backend
      // returnUrl allow-list accepts both forms.
      const returnUrl = `http://127.0.0.1:${addr.port}/callback`

      // Mint the session now that returnUrl is known. The backend's
      // allow-list check at session creation can validate the URL the
      // browser will actually be redirected to.
      void (async () => {
        let sessionToken: string
        try {
          const minted = await opts.mintSession({ returnUrl })
          sessionToken = minted.sessionToken
        } catch (mintErr) {
          finalize(mintErr instanceof Error ? mintErr : new Error(String(mintErr)))
          return
        }

        const browserUrl = buildEmbedUrl({
          embedUrl: opts.embedUrl,
          embedPath: opts.embedPath,
          sessionToken,
          returnUrl,
          state,
          network: opts.network,
          extra: opts.extraSearchParams,
        })

        if (opts.noBrowser) {
          opts.log('Open this URL in your browser to continue:')
          opts.log('')
          opts.log(browserUrl)
          opts.log('')
          opts.log('Waiting for completion...')
        } else {
          opts.log('Opening browser...')
          openBrowser(browserUrl).catch(() => {
            opts.log('Could not open the browser automatically. Open this URL manually:')
            opts.log('')
            opts.log(browserUrl)
          })
          opts.log('Waiting for completion...')
        }
      })()
    })
  })
}

interface BuildEmbedUrlOptions {
  embedUrl: string
  embedPath: string
  sessionToken: string
  returnUrl: string
  state: string
  network: EmbedNetwork
  extra?: Record<string, string>
}

function buildEmbedUrl(opts: BuildEmbedUrlOptions): string {
  const url = new URL(opts.embedPath, opts.embedUrl)
  url.searchParams.set('sessionToken', opts.sessionToken)
  url.searchParams.set('returnUrl', opts.returnUrl)
  url.searchParams.set('state', opts.state)
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      url.searchParams.set(k, v)
    }
  }
  // Set AFTER `extra` so a caller can never accidentally clobber the
  // network the embed app keys its backend selection off of —
  // `URLSearchParams.set` overwrites, so writing it last makes it win.
  url.searchParams.set('network', opts.network)
  return url.toString()
}

function successHtml(title: string, message: string): string {
  // Plain HTML, no third-party assets, no scripts. The page is shown
  // once and the user closes the tab; keep it self-contained so a
  // captive-portal-style network doesn't break the success state.
  return buildHtmlPage(title, message, '#f8f9fa', '#0f5132', '#d1e7dd')
}

function errorHtml(title: string, message: string): string {
  // Same shell as the success page (so the layout looks consistent if
  // the user sees both back-to-back), but tinted red so a state mismatch
  // or other 4xx response is visually distinct from "we're done".
  return buildHtmlPage(title, message, '#f8f9fa', '#842029', '#f8d7da')
}

function buildHtmlPage(
  title: string,
  message: string,
  pageBg: string,
  fgColor: string,
  panelBg: string,
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: system-ui, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; background:${pageBg};">
  <div style="text-align:center; max-width: 480px; padding: 24px; background:${panelBg}; color:${fgColor}; border-radius:8px;">
    <h2 style="margin: 0 0 12px;">${escapeHtml(title)}</h2>
    <p style="margin: 0;">${escapeHtml(message)}</p>
  </div>
</body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * POST to the `/widgets/session/self` endpoint with the caller's NVM
 * API key. Lives here (not in the SDK) because v1 only wires this up
 * for the CLI redirect flow — when the SDK exposes
 * `payments.widgets.createSelfSession()` we can swap this for the SDK
 * call without touching command callers.
 */
export interface SelfMintSessionResponse {
  sessionToken: string
  userId: string
  userWallet: string
  apiKeyHash: string
  expiresAt: string
  isReturnUrlAllowed?: boolean | null
}

/**
 * Hosts a request to `mintSelfWidgetSession` may be sent over plaintext
 * without warning. Loopback addresses are always safe; every other host
 * must use `https:` because we're about to send the user's NVM API key
 * in the `Authorization` header. The `custom` environment variable
 * (`NVM_BACKEND_URL`) is the only realistic way a user could accidentally
 * point this at a plaintext non-localhost URL.
 */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
])

export async function mintSelfWidgetSession(args: {
  backendUrl: string
  nvmApiKey: string
  orgId: string
  returnUrl?: string
}): Promise<SelfMintSessionResponse> {
  const url = new URL('/api/v1/widgets/session/self', args.backendUrl)

  // Refuse to send the API key over plaintext to a non-loopback host.
  // All four built-in environments are `https://`, so this only bites
  // when a user has set `NVM_BACKEND_URL` to a custom plaintext
  // endpoint — exactly the case where they'd otherwise leak the key
  // without realising.
  if (
    url.protocol === 'http:' &&
    !LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase())
  ) {
    throw new Error(
      `Refusing to send the NVM API key over plaintext to ${url.host}. Set NVM_BACKEND_URL to an https:// endpoint, or use a loopback host (localhost / 127.0.0.1 / [::1]).`,
    )
  }

  // 15s ceiling for the request — without it, an unreachable backend
  // (DNS failure, TLS handshake hang, network partition) leaves the CLI
  // frozen with no output. `AbortSignal.timeout` (Node 17.3+) is the
  // idiomatic replacement for a hand-rolled `AbortController` + setTimeout.
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.nvmApiKey}`,
      },
      body: JSON.stringify({
        orgId: args.orgId,
        ...(args.returnUrl ? { returnUrl: args.returnUrl } : {}),
      }),
      signal: AbortSignal.timeout(SELF_MINT_FETCH_TIMEOUT_MS),
    })
  } catch (cause) {
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
      throw new Error(
        `Self-mint widget session request timed out after ${SELF_MINT_FETCH_TIMEOUT_MS / 1000}s — check that ${args.backendUrl} is reachable.`,
      )
    }
    throw cause
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .catch(() => ({ message: response.statusText }))
    const message =
      (detail as { message?: string }).message ??
      `Self-mint widget session failed (HTTP ${response.status})`
    const err = new Error(message) as Error & { status?: number; apiCode?: string }
    err.status = response.status
    err.apiCode = (detail as { code?: string }).code
    throw err
  }
  return (await response.json()) as SelfMintSessionResponse
}
