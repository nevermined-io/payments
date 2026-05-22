import { createServer, IncomingMessage, ServerResponse } from 'http'
import { randomBytes, timingSafeEqual } from 'crypto'
import { execFile } from 'child_process'

const SELF_MINT_FETCH_TIMEOUT_MS = 15_000

/**
 * Constant-time string equality for the CSRF state nonce. Both sides are
 * 32 hex chars (16 random bytes), so a length mismatch alone is enough to
 * reject. timingSafeEqual then compares the bytes without an early
 * short-circuit — closes a (tiny, loopback-only) timing oracle.
 */
function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

/**
 * Default timeout for a redirect-mode CLI flow. Mirrors the existing
 * `nvm login` callback timeout — 5 minutes is enough for the user to
 * tab into the browser, complete a card enrolment + delegation, and
 * land back at the CLI.
 */
const REDIRECT_TIMEOUT_MS = 5 * 60 * 1000

export interface WidgetRedirectFlowOptions {
  /** Backend base URL — e.g. `Environments[env].backend`. */
  backendUrl: string
  /** Frontend base URL — e.g. `Environments[env].frontend`. */
  frontendUrl: string
  /** The session token already minted via `/widgets/session/self`. */
  sessionToken: string
  /**
   * Relative embed path the CLI wants to open, e.g.
   * `/embed/cards/setup` or `/embed/cards/enroll`.
   */
  embedPath: string
  /** Extra query params to forward to the embed page (e.g. `provider=stripe`, `paymentMethodId=pm_x`). */
  extraSearchParams?: Record<string, string>
  /** If true, prints the URL instead of opening the browser. */
  noBrowser?: boolean
  /** Caller-supplied logger / printer. The login command uses oclif's formatter; this is the same shape. */
  log: (msg: string) => void
  /** Suggested success-page wording — keeps the wording aligned with whichever command is calling. */
  successPageTitle?: string
}

export interface WidgetRedirectFlowResult {
  /** Echoed `state` value — the helper has already verified it matches. */
  state: string
  /** All query params the embed page redirected with (paymentMethodId, delegationId, …). */
  query: Record<string, string>
}

/**
 * Shared redirect-mode handshake for any CLI command that hands the user
 * off to an `/embed/*` page and waits for a localhost callback.
 *
 * The flow mirrors `nvm login`: start an ephemeral HTTP server on a
 * random localhost port, build the embed URL with `sessionToken`,
 * `returnUrl`, and `state`, open the browser (or print the URL with
 * `--no-browser`), and resolve when the embed page redirects to
 * `/callback?<params>&state=<state>`. The helper verifies the echoed
 * state to bind the callback to this CLI invocation.
 *
 * Returns when the callback fires; rejects on timeout (5 min) or on
 * server bind failure.
 */
export async function runWidgetRedirectFlow(
  opts: WidgetRedirectFlowOptions,
): Promise<WidgetRedirectFlowResult> {
  const state = randomBytes(16).toString('hex')

  return new Promise<WidgetRedirectFlowResult>((resolve, reject) => {
    let resolved = false

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost')
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('Not found')
        return
      }

      const receivedState = url.searchParams.get('state')
      if (!receivedState || !safeEqualString(receivedState, state)) {
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
      // Symmetry with the other rejection paths below — also stops the
      // 5-minute timer from keeping the process alive after we resolve
      // (#1 in the reviewer's punch list).

      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      server.close()
      resolve({ state, query })
    })

    const timeout = setTimeout(() => {
      if (resolved) return
      resolved = true
      // Clear our own handle for symmetry with the other rejection
      // paths — leaves Jest with no dangling timers (the test runner
      // would otherwise wait one full tick before exiting).
      clearTimeout(timeout)
      server.close()
      reject(new Error('Browser flow timed out after 5 minutes. Please try again.'))
    }, REDIRECT_TIMEOUT_MS)

    server.on('error', (err) => {
      if (resolved) return
      resolved = true
      clearTimeout(timeout)
      server.close()
      reject(new Error(`Failed to start local callback server: ${err.message}`))
    })

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        server.close()
        reject(new Error('Failed to obtain local callback port'))
        return
      }

      const returnUrl = `http://localhost:${addr.port}/callback`
      const browserUrl = buildEmbedUrl({
        frontendUrl: opts.frontendUrl,
        embedPath: opts.embedPath,
        sessionToken: opts.sessionToken,
        returnUrl,
        state,
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
    })
  })
}

interface BuildEmbedUrlOptions {
  frontendUrl: string
  embedPath: string
  sessionToken: string
  returnUrl: string
  state: string
  extra?: Record<string, string>
}

function buildEmbedUrl(opts: BuildEmbedUrlOptions): string {
  const url = new URL(opts.embedPath, opts.frontendUrl)
  url.searchParams.set('sessionToken', opts.sessionToken)
  url.searchParams.set('returnUrl', opts.returnUrl)
  url.searchParams.set('state', opts.state)
  if (opts.extra) {
    for (const [k, v] of Object.entries(opts.extra)) {
      url.searchParams.set(k, v)
    }
  }
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

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    let cmd: string
    let args: string[]
    if (platform === 'darwin') {
      cmd = 'open'
      args = [url]
    } else if (platform === 'win32') {
      cmd = 'cmd'
      args = ['/c', 'start', '""', url]
    } else {
      cmd = 'xdg-open'
      args = [url]
    }
    execFile(cmd, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * POST to the new `/widgets/session/self` endpoint with the caller's
 * NVM API key. Lives here (not in the SDK) because v1 only wires this
 * up for the CLI redirect flow — when the SDK exposes
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

export async function mintSelfWidgetSession(args: {
  backendUrl: string
  nvmApiKey: string
  orgId: string
  returnUrl?: string
}): Promise<SelfMintSessionResponse> {
  const url = new URL('/api/v1/widgets/session/self', args.backendUrl)

  // 15s ceiling for the request — without it, an unreachable backend
  // (DNS failure, TLS handshake hang, network partition) leaves the CLI
  // frozen with no output. The localhost-callback server's own 5-min
  // timer doesn't cover this pre-server call.
  const controller = new AbortController()
  const abortHandle = setTimeout(() => controller.abort(), SELF_MINT_FETCH_TIMEOUT_MS)
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
      signal: controller.signal,
    })
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new Error(
        `Self-mint widget session request timed out after ${SELF_MINT_FETCH_TIMEOUT_MS / 1000}s — check that ${args.backendUrl} is reachable.`,
      )
    }
    throw cause
  } finally {
    clearTimeout(abortHandle)
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
