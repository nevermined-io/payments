import type { Payments } from '@nevermined-io/payments'
import { buildPaymentRequired } from '@nevermined-io/payments'
import type { NeverminedPluginConfig } from './config.js'
import type { OpenClawPluginAPI, HttpRouteHandler } from './index.js'

export type AgentHandler = (body: { prompt: string }) => Promise<unknown>

/**
 * Registers a paid HTTP endpoint on the OpenClaw gateway.
 * The endpoint handles x402 payment verification, processes requests,
 * and settles credits after successful processing.
 */
export function registerPaidEndpoint(
  api: OpenClawPluginAPI,
  getPayments: () => Payments,
  config: NeverminedPluginConfig,
  agentHandler?: AgentHandler,
): void {
  const path = config.agentEndpointPath ?? '/nevermined/agent'
  const handler = agentHandler ?? mockWeatherHandler

  const routeHandler: HttpRouteHandler = async (req, res) => {
    // 1. Build payment required descriptor
    const planId = config.planId
    if (!planId) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Server misconfigured — planId not set' }))
      return
    }

    const paymentRequired = buildPaymentRequired(planId, {
      endpoint: path,
      agentId: config.agentId,
      httpVerb: 'POST',
    })

    const paymentRequiredHeader = Buffer.from(JSON.stringify(paymentRequired)).toString('base64')
    const maxAmount = BigInt(config.creditsPerRequest ?? 1)

    // 2. Extract payment signature
    const accessToken =
      getHeader(req.headers, 'payment-signature') ??
      getHeader(req.headers, 'PAYMENT-SIGNATURE')

    if (!accessToken) {
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'payment-required': paymentRequiredHeader,
      })
      res.end(JSON.stringify({ error: 'Payment required — missing payment-signature header' }))
      return
    }

    // 3. Verify permissions (check credits without burning)
    try {
      const verification = await getPayments().facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount,
      })

      if (!verification.isValid) {
        res.writeHead(402, {
          'Content-Type': 'application/json',
          'payment-required': paymentRequiredHeader,
        })
        res.end(JSON.stringify({
          error: 'Insufficient credits — order the plan first',
          details: verification,
        }))
        return
      }
    } catch (err) {
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'payment-required': paymentRequiredHeader,
      })
      res.end(JSON.stringify({
        error: 'Payment verification failed',
        message: err instanceof Error ? err.message : String(err),
      }))
      return
    }

    // 4. Parse request body and process
    const body = await parseBody(req)
    const prompt = typeof body === 'object' && body !== null && 'prompt' in body
      ? (body as { prompt: string }).prompt
      : String(body)

    let result: unknown
    try {
      result = await handler({ prompt })
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: 'Agent processing failed',
        message: err instanceof Error ? err.message : String(err),
      }))
      return
    }

    // 5. Settle permissions (burn credits)
    let settlement: unknown
    try {
      settlement = await getPayments().facilitator.settlePermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount,
      })
    } catch (err) {
      // Log settlement failure but still return the result — the agent already processed
      api.logger.warn(`Credit settlement failed: ${err instanceof Error ? err.message : String(err)}`)
      settlement = { error: 'settlement_failed' }
    }

    // 6. Return response with payment-response header
    const paymentResponse = Buffer.from(JSON.stringify(settlement)).toString('base64')
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'payment-response': paymentResponse,
    })
    res.end(JSON.stringify(result))
  }

  api.registerHttpRoute!({ path, handler: routeHandler })
  api.logger.info(`Registered paid endpoint at ${path}`)
}

/**
 * Mock weather forecast handler for demonstration purposes.
 * Returns simulated weather data based on the prompt.
 */
export async function mockWeatherHandler(body: { prompt: string }): Promise<unknown> {
  const city = extractCity(body.prompt) ?? 'Unknown'
  return {
    city,
    forecast: 'Partly cloudy with a chance of innovation',
    temperature: Math.floor(Math.random() * 30) + 5,
    unit: 'celsius',
    humidity: Math.floor(Math.random() * 60) + 30,
    source: 'Weather Oracle (Nevermined demo)',
  }
}

function extractCity(prompt: string): string | undefined {
  // Simple heuristic: look for "in <City>" or "for <City>" patterns
  // Use word boundary to avoid matching partial words
  // Use a lookbehind for word boundary + space to avoid matching "at" inside "What"
  const match = prompt.match(/(?:^|\s)(?:in|for|at)\s+([A-Z][a-zA-Z\s]{1,30}?)(?:\?|$|\.|\s*,)/)
  return match ? match[1].trim() : undefined
}

// --- HTTP helpers ---

interface IncomingMessage {
  headers: Record<string, string | string[] | undefined>
  on(event: string, cb: (data?: unknown) => void): void
}

function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()]
  if (Array.isArray(value)) return value[0]
  return value
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: unknown) => chunks.push(Buffer.from(chunk as Uint8Array)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        resolve(raw)
      }
    })
    req.on('error', reject)
  })
}
