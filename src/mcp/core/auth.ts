/**
 * Authentication handler for MCP paywall using X402 tokens
 */
import type { Payments } from '../../payments.js'
import { decodeAccessToken } from '../../utils.js'
import { getCurrentRequestContext } from '../http/mcp-handler.js'
import { AuthResult } from '../types/paywall.types.js'
import { PaymentRequiredError } from '../utils/errors.js'
import { Address, isValidScheme } from '../../common/types.js'
import { buildLogicalMetaUrl, buildLogicalUrl } from '../utils/logical-url.js'
import { extractAuthHeader, stripBearer } from '../utils/request.js'
import {
  buildPaymentRequired,
  buildPaymentRequiredForPlans,
  type X402PaymentRequired,
} from '../../x402/facilitator-api.js'

interface VerifyContext {
  accessToken: string
  logicalUrl: string
  httpUrl: string | undefined
  maxAmount: bigint
  agentId?: string
  planIdOverride?: string
}

/**
 * Handles authentication and authorization for MCP requests
 */
export class PaywallAuthenticator {
  constructor(private payments: Payments) {}

  /**
   * Extract authorization header from extra context or AsyncLocalStorage.
   * Tries SDK's extra context first, then falls back to HTTP request context.
   *
   * @param extra - MCP extra context from SDK
   * @returns Authorization header value or undefined
   */
  private extractAuthHeaderFromContext(extra: any): string | undefined {
    // Try to extract auth header from SDK's extra context first
    let authHeader = extractAuthHeader(extra)

    if (!authHeader) {
      const requestContext = getCurrentRequestContext()
      if (requestContext?.headers) {
        // Build an extra-like object for extractAuthHeader
        authHeader = extractAuthHeader({ requestInfo: { headers: requestContext.headers } })
      }
    }

    return authHeader
  }

  /**
   * Build HTTP endpoint URL from request context.
   *
   * @returns HTTP endpoint URL or undefined if context is not available
   */
  private buildHttpUrlFromContext(): string | undefined {
    const requestContext = getCurrentRequestContext()
    if (!requestContext) {
      return undefined
    }

    try {
      const host = requestContext.headers?.['host'] || requestContext.headers?.['x-forwarded-host']
      if (!host || typeof host !== 'string') {
        return undefined
      }

      const protocol = requestContext.headers?.['x-forwarded-proto'] || 'http'
      const baseUrl = `${protocol}://${host}`

      // Use requestContext.url if available (e.g., '/mcp'), otherwise default to '/mcp'
      const path = requestContext.url || '/mcp'
      return `${baseUrl}${path}`
    } catch {
      return undefined
    }
  }

  /**
   * Core verification logic shared by authenticate and authenticateMeta.
   * Tries logical URL first, falls back to HTTP URL if available.
   */
  private async verifyWithFallback(ctx: VerifyContext): Promise<AuthResult> {
    const { accessToken, logicalUrl, httpUrl, maxAmount, agentId, planIdOverride } = ctx

    // Try logical URL first
    try {
      const result = await this.verifyWithEndpoint(
        accessToken,
        logicalUrl,
        agentId,
        maxAmount,
        planIdOverride,
      )
      return {
        token: accessToken,
        agentId,
        logicalUrl,
        httpUrl,
        planId: result.planId,
        subscriberAddress: result.subscriberAddress,
        agentRequest: result.agentRequest,
      }
    } catch {
      // If logical URL fails and we have an HTTP URL, try that
    }

    if (httpUrl) {
      try {
        const result = await this.verifyWithEndpoint(
          accessToken,
          httpUrl,
          agentId,
          maxAmount,
          planIdOverride,
        )
        return {
          token: accessToken,
          agentId,
          logicalUrl,
          httpUrl,
          planId: result.planId,
          subscriberAddress: result.subscriberAddress,
          agentRequest: result.agentRequest,
        }
      } catch {
        // HTTP fallback also failed
      }
    }

    // Both attempts failed — surface a spec-shaped PaymentRequired error
    // (converted in-band to a tool-result error for tools; propagates as a
    // JSON-RPC error for resources/prompts).
    throw await this.buildPaymentRequiredError(agentId, logicalUrl, 'Payment required.', planIdOverride)
  }

  /**
   * Build a spec-shaped {@link PaymentRequiredError} from the agent's plans.
   *
   * Fetches the agent's plans (best-effort) to populate the `accepts` array of
   * the `PaymentRequired` object and a human-readable list of plan names in the
   * error message. Falls back to an empty plan id when no plans can be resolved
   * so the structured shape is still valid.
   *
   * @param agentId - Agent identifier used to look up purchasable plans.
   * @param endpoint - Logical resource URL placed in `PaymentRequired.resource`.
   * @param message - Leading human-readable message (e.g. "Authorization required.").
   * @returns A `PaymentRequiredError` carrying the `PaymentRequired` object.
   */
  private async buildPaymentRequiredError(
    agentId: string | undefined,
    endpoint: string,
    message = 'Payment required.',
    fallbackPlanId?: string,
  ): Promise<PaymentRequiredError> {
    const planIds: string[] = []
    const names: string[] = []
    let plansLookupFailed = false
    // Only look up the agent's plans when an agentId is configured. Under the
    // plan-centric model agentId is optional, so we advertise the configured
    // plan directly (below) instead of requiring an agent lookup.
    if (agentId) {
      try {
        const plans = await this.payments.agents.getAgentPlans(agentId)
        if (plans && Array.isArray(plans.plans)) {
          for (const p of plans.plans) {
            const pid = p.planId || p.id
            if (pid) planIds.push(pid)
            if (pid) names.push(`${pid}${p.name ? ` (${p.name})` : ''}`)
          }
        }
      } catch (error) {
        // Best-effort: a backend failure must not look like a clean "unpaid".
        plansLookupFailed = true
        console.error(
          `[x402] Failed to fetch agent plans while building payment-required (agentId=${agentId}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    // Plan-centric fallback: advertise the configured plan when no plans were
    // resolved via the agent (or no agentId was provided).
    if (planIds.length === 0 && fallbackPlanId) {
      planIds.push(fallbackPlanId)
    }

    const plansMsg = names.length > 0 ? ` Available plans: ${names.slice(0, 3).join(', ')}...` : ''

    const paymentRequired = buildPaymentRequiredForPlans(planIds, {
      endpoint,
      agentId,
      httpVerb: 'POST',
      environment: this.payments.getEnvironmentName(),
    }) as X402PaymentRequired & { error?: string }
    // When the plans lookup itself failed (backend outage) the `accepts` array
    // falls back to an empty plan id; flag it so a client can't mistake the
    // resulting payment-required for a clean "free / no plan needed" response.
    paymentRequired.error = plansLookupFailed ? 'plans unavailable' : 'payment required'

    return new PaymentRequiredError(paymentRequired, `${message}${plansMsg}`)
  }

  /**
   * Verify permissions against a single endpoint URL.
   * Resolves planId from the token or from the agent's plans as fallback.
   */
  private async verifyWithEndpoint(
    accessToken: string,
    endpoint: string,
    agentId: string | undefined,
    maxAmount: bigint,
    planIdOverride?: string,
  ): Promise<{ planId: string; subscriberAddress: Address; agentRequest?: any }> {
    const decodedAccessToken = decodeAccessToken(accessToken)
    if (!decodedAccessToken) {
      throw new Error('Invalid access token')
    }

    let planId = planIdOverride ?? decodedAccessToken.accepted?.planId
    const subscriberAddress = decodedAccessToken.payload?.authorization?.from

    // If planId is not available, try to get it from the agent's plans
    // (only possible when an agentId is configured).
    if (!planId && agentId) {
      try {
        const agentPlans = await this.payments.agents.getAgentPlans(agentId)
        if (agentPlans && Array.isArray(agentPlans.plans) && agentPlans.plans.length > 0) {
          planId = agentPlans.plans[0].planId || agentPlans.plans[0].id
        }
      } catch {
        // Ignore errors fetching plans
      }
    }

    if (!planId || !subscriberAddress) {
      throw new Error(
        'Cannot determine plan_id or subscriber_address from token (expected accepted.planId and payload.authorization.from)',
      )
    }

    const scheme = isValidScheme(decodedAccessToken?.accepted?.scheme)
      ? decodedAccessToken.accepted.scheme
      : 'nvm:erc4337'
    const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
      endpoint,
      agentId,
      httpVerb: 'POST',
      scheme,
      environment: this.payments.getEnvironmentName(),
    })

    const result = await this.payments.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: accessToken,
      maxAmount,
    })

    if (!result.isValid) {
      throw new Error('Permission verification failed')
    }

    return { planId, subscriberAddress, agentRequest: result.agentRequest }
  }

  /**
   * Authenticate an MCP request
   */
  async authenticate(
    extra: any,
    options: { planId?: string; maxAmount?: bigint } = {},
    agentId: string | undefined,
    serverName: string,
    name: string,
    kind: 'tool' | 'resource' | 'prompt',
    argsOrVars: any,
  ): Promise<AuthResult> {
    const logicalUrl = buildLogicalUrl({ kind, serverName, name, argsOrVars })

    const authHeader = this.extractAuthHeaderFromContext(extra)
    if (!authHeader) {
      throw await this.buildPaymentRequiredError(
        agentId,
        logicalUrl,
        'Authorization required.',
        options.planId,
      )
    }

    return this.verifyWithFallback({
      accessToken: stripBearer(authHeader),
      logicalUrl,
      httpUrl: this.buildHttpUrlFromContext(),
      maxAmount: options.maxAmount ?? 1n,
      agentId,
      planIdOverride: options.planId,
    })
  }

  /**
   * Authenticate generic MCP meta operations (e.g., initialize, tools/list, resources/list, prompts/list).
   * Returns an AuthResult compatible with paywall flows (without redeem step).
   */
  async authenticateMeta(
    extra: any,
    options: { planId?: string; maxAmount?: bigint } = {},
    agentId: string | undefined,
    serverName: string,
    method: string,
  ): Promise<AuthResult> {
    const logicalUrl = buildLogicalMetaUrl(serverName, method)

    const authHeader = this.extractAuthHeaderFromContext(extra)
    if (!authHeader) {
      throw await this.buildPaymentRequiredError(
        agentId,
        logicalUrl,
        'Authorization required.',
        options.planId,
      )
    }

    return this.verifyWithFallback({
      accessToken: stripBearer(authHeader),
      logicalUrl,
      httpUrl: this.buildHttpUrlFromContext(),
      maxAmount: options.maxAmount ?? 1n,
      agentId,
      planIdOverride: options.planId,
    })
  }
}
