/**
 * Authentication handler for MCP paywall using X402 tokens
 */
import type { Payments } from '../../payments.js'
import { decodeAccessToken } from '../../utils.js'
import { getCurrentRequestContext } from '../http/mcp-handler.js'
import { AuthResult } from '../types/paywall.types.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'
import { Address } from '../../common/types.js'
import { buildLogicalMetaUrl, buildLogicalUrl } from '../utils/logical-url.js'
import { extractAuthHeader, stripBearer } from '../utils/request.js'
import { buildPaymentRequired, type X402PaymentRequired } from '../../x402/facilitator-api.js'

interface VerifyContext {
  accessToken: string
  logicalUrl: string
  httpUrl: string | undefined
  maxAmount: bigint
  agentId: string
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

    // Both attempts failed — enrich denial with suggested plans (best-effort)
    let plansMsg = ''
    try {
      const plans = await this.payments.agents.getAgentPlans(agentId)
      if (plans && Array.isArray(plans.plans) && plans.plans.length > 0) {
        const top = plans.plans.slice(0, 3)
        const summary = top
          .map((p: any) => `${p.planId || p.id || 'plan'}${p.name ? ` (${p.name})` : ''}`)
          .join(', ')
        plansMsg = summary ? ` Available plans: ${summary}...` : ''
      }
    } catch {
      // Ignore errors fetching plans - best effort only
    }

    throw createRpcError(ERROR_CODES.PaymentRequired, `Payment required.${plansMsg}`, {
      reason: 'invalid',
    })
  }

  /**
   * Verify permissions against a single endpoint URL.
   * Resolves planId from the token or from the agent's plans as fallback.
   */
  private async verifyWithEndpoint(
    accessToken: string,
    endpoint: string,
    agentId: string,
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
    if (!planId) {
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

    const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
      endpoint,
      agentId,
      httpVerb: 'POST',
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
    agentId: string,
    serverName: string,
    name: string,
    kind: 'tool' | 'resource' | 'prompt',
    argsOrVars: any,
  ): Promise<AuthResult> {
    const authHeader = this.extractAuthHeaderFromContext(extra)
    if (!authHeader) {
      throw createRpcError(ERROR_CODES.PaymentRequired, 'Authorization required', {
        reason: 'missing',
      })
    }

    return this.verifyWithFallback({
      accessToken: stripBearer(authHeader),
      logicalUrl: buildLogicalUrl({ kind, serverName, name, argsOrVars }),
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
    agentId: string,
    serverName: string,
    method: string,
  ): Promise<AuthResult> {
    const authHeader = this.extractAuthHeaderFromContext(extra)
    if (!authHeader) {
      throw createRpcError(ERROR_CODES.PaymentRequired, 'Authorization required', {
        reason: 'missing',
      })
    }

    return this.verifyWithFallback({
      accessToken: stripBearer(authHeader),
      logicalUrl: buildLogicalMetaUrl(serverName, method),
      httpUrl: this.buildHttpUrlFromContext(),
      maxAmount: options.maxAmount ?? 1n,
      agentId,
      planIdOverride: options.planId,
    })
  }
}
