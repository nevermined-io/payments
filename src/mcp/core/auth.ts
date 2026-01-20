/**
 * Authentication handler for MCP paywall using X402 tokens
 */
import type { Payments } from '../../payments.js'
import { decodeAccessToken } from '../../utils.js'
import { getCurrentRequestContext } from '../http/mcp-handler.js'
import { AuthResult } from '../types/paywall.types.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'
import { buildLogicalMetaUrl, buildLogicalUrl } from '../utils/logical-url.js'
import { extractAuthHeader, stripBearer } from '../utils/request.js'
import { buildPaymentRequired, type X402PaymentRequired } from '../../x402/facilitator-api.js'

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
   * Authenticate an MCP request
   */
  async authenticate(
    extra: any,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options: { planId?: string } = {},
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

    // Validate access with Nevermined - try logical URL first
    try {
      const decodedAccessToken = decodeAccessToken(accessToken)
      if (!decodedAccessToken) {
        throw new Error('Invalid access token')
      }

      const planId = decodedAccessToken.accepted?.planId

      // Extract subscriberAddress from payload.authorization.from per x402 spec
      const subscriberAddress = decodedAccessToken.payload?.authorization?.from

      if (!planId || !subscriberAddress) {
        throw new Error(
          'Cannot determine plan_id or subscriber_address from token (expected payload.authorization.from)',
        )
      }

      const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
        endpoint: logicalUrl,
        agentId,
        httpVerb: 'POST',
      })

      const result = await this.payments.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 1n,
      })

      if (!result.isValid) {
        throw new Error('Permission verification failed')
      }

      return {
        token: accessToken,
        agentId,
        logicalUrl,
        planId,
        subscriberAddress,
      }
    } catch (e) {
      // If logical URL validation fails, try with HTTP endpoint
      const httpUrl = this.buildHttpUrlFromContext()
      if (httpUrl) {
        try {
          const decodedAccessToken = decodeAccessToken(accessToken)
          if (!decodedAccessToken) {
            throw new Error('Invalid access token')
          }
          // Extract planId from accepted.planId per x402 spec
          let planId = decodedAccessToken.accepted?.planId
          // Extract subscriberAddress from payload.authorization.from per x402 spec
          const subscriberAddress = decodedAccessToken.payload?.authorization?.from

          // If planId is not in the token, try to get it from the agent's plans
          if (!planId) {
            try {
              const agentPlans = await this.payments.agents.getAgentPlans(agentId)
              if (agentPlans && Array.isArray(agentPlans.plans) && agentPlans.plans.length > 0) {
                planId = agentPlans.plans[0].planId || agentPlans.plans[0].id
              }
            } catch (planError) {
              // Ignore errors fetching plans
            }
          }

          if (!planId || !subscriberAddress) {
            throw new Error(
              'Cannot determine plan_id or subscriber_address from token (expected accepted.planId and payload.authorization.from)',
            )
          }

          const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
            endpoint: httpUrl,
            agentId,
            httpVerb: 'POST',
          })

          const result = await this.payments.facilitator.verifyPermissions({
            paymentRequired,
            x402AccessToken: accessToken,
            maxAmount: 1n,
          })

          if (!result.isValid) {
            throw new Error('Permission verification failed')
          }

          return {
            token: accessToken,
            agentId,
            logicalUrl,
            planId,
            subscriberAddress,
          }
        } catch (httpError) {
          void httpError
        }
      }

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
        // Ignore errors fetching plans - best effort only
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
    options: { planId?: string } = {},
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
      const decodedAccessToken = decodeAccessToken(accessToken)
      if (!decodedAccessToken) {
        throw new Error('Invalid access token')
      }
      const planId = options.planId
      // Extract subscriberAddress from payload.authorization.from per x402 spec
      const subscriberAddress = decodedAccessToken.payload?.authorization?.from
      if (!planId || !subscriberAddress) {
        throw new Error(
          'Cannot determine plan_id or subscriber_address from token (expected payload.authorization.from)',
        )
      }

      const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
        endpoint: logicalUrl,
        agentId,
        httpVerb: 'POST',
      })

      const result = await this.payments.facilitator.verifyPermissions({
        paymentRequired,
        x402AccessToken: accessToken,
        maxAmount: 1n,
      })
      if (!result.isValid) {
        throw new Error('Permission verification failed')
      }
      return {
        token: accessToken,
        agentId,
        logicalUrl,
        planId,
        subscriberAddress,
      }
    } catch (e) {
      const httpUrl = this.buildHttpUrlFromContext()
      if (httpUrl) {
        try {
          const decodedAccessToken = decodeAccessToken(accessToken)
          if (!decodedAccessToken) {
            throw new Error('Invalid access token')
          }
          // Extract planId from accepted.planId per x402 spec
          const planId = decodedAccessToken.accepted?.planId
          // Extract subscriberAddress from payload.authorization.from per x402 spec
          const subscriberAddress = decodedAccessToken.payload?.authorization?.from
          if (!planId || !subscriberAddress) {
            throw new Error(
              'Cannot determine plan_id or subscriber_address from token (expected accepted.planId and payload.authorization.from)',
            )
          }

          const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
            endpoint: httpUrl,
            agentId,
            httpVerb: 'POST',
          })

          const result = await this.payments.facilitator.verifyPermissions({
            paymentRequired,
            x402AccessToken: accessToken,
            maxAmount: 1n,
          })
          if (!result.isValid) {
            throw new Error('Permission verification failed')
          }
          return {
            token: accessToken,
            agentId,
            logicalUrl: httpUrl,
            planId,
            subscriberAddress,
          }
        } catch (httpError) {
          void httpError
        }
      }

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
