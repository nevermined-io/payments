/**
 * Authentication handler for MCP paywall
 */
import type { Payments } from '../../payments.js'
import { extractAuthHeader, stripBearer } from '../utils/request.js'
import { buildLogicalUrl, buildLogicalMetaUrl } from '../utils/logical-url.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'
import { AuthResult, PaywallOptions } from '../types/paywall.types.js'
import { getCurrentRequestContext } from '../http/mcp-handler.js'

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
   * Authenticate an MCP request
   */
  async authenticate(
    extra: any,
    options: PaywallOptions,
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

    const accessToken = stripBearer(authHeader)
    const logicalUrl = buildLogicalUrl({ kind, serverName, name, argsOrVars })

    // Validate access with Nevermined
    try {
      const start = await this.payments.requests.startProcessingRequest(
        agentId,
        accessToken,
        logicalUrl,
        'POST',
      )

      if (!start?.balance?.isSubscriber) {
        throw new Error('Not a subscriber')
      }

      return {
        requestId: start.agentRequestId,
        token: accessToken,
        agentId,
        logicalUrl,
        agentRequest: start,
      }
    } catch (e) {
      // Enrich denial with suggested plans (best-effort)
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
        // Ignore plan fetching errors
      }

      throw createRpcError(ERROR_CODES.PaymentRequired, `Payment required.${plansMsg}`, {
        reason: 'invalid',
      })
    }
  }

  /**
   * Authenticate generic MCP meta operations (e.g., initialize, tools/list, resources/list, prompts/list).
   * Returns an AuthResult compatible with paywall flows (without redeem step).
   */
  async authenticateMeta(
    extra: any,
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
    const accessToken = stripBearer(authHeader)
    const logicalUrl = buildLogicalMetaUrl(serverName, method)

    try {
      const start = await this.payments.requests.startProcessingRequest(
        agentId,
        accessToken,
        logicalUrl,
        'POST',
      )

      if (!start?.balance?.isSubscriber) {
        throw new Error('Not a subscriber')
      }

      return {
        requestId: start.agentRequestId,
        token: accessToken,
        agentId,
        logicalUrl,
        agentRequest: start,
      }
    } catch (e) {
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
      } catch (_err) {
        void _err
      }

      throw createRpcError(ERROR_CODES.PaymentRequired, `Payment required.${plansMsg}`, {
        reason: 'invalid',
      })
    }
  }
}
