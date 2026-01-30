/**
 * Main paywall decorator for MCP handlers (tools, resources, prompts)
 */
import { Address } from '../../common/types.js'
import type { Payments } from '../../payments.js'
import {
  buildPaymentRequired,
  type SettlePermissionsResult,
  type X402PaymentRequired,
} from '../../x402/facilitator-api.js'
import {
  McpConfig,
  PaywallOptions,
  PromptOptions,
  ResourceOptions,
  ToolOptions,
} from '../types/paywall.types.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'
import { PaywallAuthenticator } from './auth.js'
import { CreditsContextProvider } from './credits-context.js'

/**
 * Main class for creating paywall-protected MCP handlers
 */
export class PaywallDecorator {
  // Internal config ensures serverName is always a concrete string
  private config: { agentId: string; serverName: string } = {
    agentId: '',
    serverName: 'mcp-server',
  }

  constructor(
    private payments: Payments,
    private authenticator: PaywallAuthenticator,
    private creditsContext: CreditsContextProvider,
  ) {}

  /**
   * Configure the paywall with agent and server information
   */
  configure(options: McpConfig): void {
    this.config = {
      agentId: options.agentId || this.config.agentId,
      serverName: options.serverName ?? this.config.serverName,
    }
  }

  /**
   * Create a paywall-protected handler (uncurried version only)
   */
  // Overloads per kind for stronger typing
  protect<TArgs = any>(
    handler: (args: TArgs, extra?: any) => Promise<any> | any,
    options: ToolOptions | PromptOptions,
  ): (args: TArgs, extra?: any) => Promise<any>
  protect(
    handler: (
      uri: URL,
      variables: Record<string, string | string[]>,
      extra?: any,
    ) => Promise<any> | any,
    options: ResourceOptions,
  ): (uri: URL, variables: Record<string, string | string[]>, extra?: any) => Promise<any>
  protect(handler: any, options: PaywallOptions): any {
    return this.createWrappedHandler(handler, options)
  }

  /**
   * Internal method to create the wrapped handler
   */
  private createWrappedHandler<TArgs = any>(
    handler: (args: TArgs, extra?: any) => Promise<any> | any,
    options: PaywallOptions,
  ): (...allArgs: any[]) => Promise<any> {
    return async (...allArgs: any[]): Promise<any> => {
      // Validate configuration
      if (!this.config.agentId) {
        throw createRpcError(
          ERROR_CODES.Misconfiguration,
          'Server misconfiguration: missing agentId',
        )
      }

      const kind = options?.kind ?? 'tool'
      const name = options?.name ?? 'unnamed'

      // Detect resource signature: (url, variables, extra)
      const isResource = allArgs.length >= 2 && allArgs[0] instanceof URL
      const extra = isResource ? allArgs[2] : allArgs[1]
      const argsOrVars = isResource ? allArgs[1] : allArgs[0]

      // 1. Authenticate request
      const authResult = await this.authenticator.authenticate(
        extra,
        { planId: options?.planId, maxAmount: options?.maxAmount },
        this.config.agentId,
        this.config.serverName,
        name,
        kind,
        argsOrVars,
      )

      // 2. Pre-calculate credits if they are fixed (not a function)
      // This allows handlers to access credits during execution
      const creditsOption = options?.credits
      const isFixedCredits = typeof creditsOption === 'bigint' || creditsOption === undefined
      const preCalculatedCredits = isFixedCredits
        ? this.creditsContext.resolve(creditsOption, argsOrVars, null, authResult)
        : undefined

      // Determine effective planId: explicit option overrides token-derived value
      const effectivePlanId = options?.planId ?? authResult.planId

      // 3. Build PaywallContext for handler (with extra wrapper for backward compatibility)
      const paywallContext = {
        authResult,
        credits: preCalculatedCredits,
        planId: authResult.planId,
        subscriberAddress: authResult.subscriberAddress,
        agentRequest: authResult.agentRequest,
      }

      // 4. Execute original handler with context
      const result = await (handler as any)(...allArgs, paywallContext)

      // 5. Resolve final credits to burn (may be different if credits are dynamic)
      const credits = isFixedCredits
        ? (preCalculatedCredits ?? 1n)
        : this.creditsContext.resolve(creditsOption, argsOrVars, result, authResult)

      // Update context with final resolved credits
      paywallContext.credits = credits

      // 6. If the result is an AsyncIterable (stream), redeem on completion
      if (isAsyncIterable(result)) {
        const onFinally = async () => {
          return await this.redeemCredits(
            effectivePlanId,
            authResult.token,
            authResult.subscriberAddress,
            credits,
            options,
            authResult.agentId,
            authResult.logicalUrl,
            authResult.httpUrl,
            'POST',
          )
        }
        return wrapAsyncIterable(
          result,
          onFinally,
          effectivePlanId,
          authResult.subscriberAddress,
          credits,
        )
      }

      // 7. Non-streaming: redeem immediately
      const creditsResult = await this.redeemCredits(
        effectivePlanId,
        authResult.token,
        authResult.subscriberAddress,
        credits,
        options,
        authResult.agentId,
        authResult.logicalUrl,
        'POST',
        authResult.httpUrl,
      )
      result._meta = {
        ...result._meta,
        ...(creditsResult.transaction && { txHash: creditsResult.transaction }),
        creditsRedeemed: creditsResult.success ? (creditsResult.creditsRedeemed ?? credits.toString()) : '0',
        remainingBalance: creditsResult.remainingBalance,
        planId: authResult.planId,
        subscriberAddress: authResult.subscriberAddress,
        success: creditsResult.success,
        ...(creditsResult.errorReason && { errorReason: creditsResult.errorReason }),
      }
      return result
    }
  }

  /**
   * Redeem credits after successful request
   */
  private async redeemCredits(
    planId: string,
    token: string,
    subscriberAddress: Address,
    credits: bigint,
    options: PaywallOptions,
    agentId?: string,
    endpoint?: string,
    fallbackEndpoint?: string,
    httpVerb?: string,
  ): Promise<SettlePermissionsResult> {
    let ret: SettlePermissionsResult = {
      success: true,
      transaction: '',
      network: '',
    }
    try {
      if (credits && credits > 0n && subscriberAddress && planId) {
        const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
          endpoint: endpoint || '',
          agentId,
          httpVerb: httpVerb,
        })

        ret = await this.payments.facilitator.settlePermissions({
          paymentRequired,
          x402AccessToken: token,
          maxAmount: credits,
        })
      }
    } catch (e) {
      // If logical URL fails and we have an HTTP URL fallback, retry with it
      if (fallbackEndpoint) {
        try {
          const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
            endpoint: fallbackEndpoint,
            agentId,
            httpVerb: httpVerb,
          })

          ret = await this.payments.facilitator.settlePermissions({
            paymentRequired,
            x402AccessToken: token,
            maxAmount: credits,
          })
          return ret
        } catch (fallbackError) {
          // Fallback also failed, use fallback error as the reported error
          e = fallbackError
        }
      }

      ret.success = false
      ret.errorReason = e instanceof Error ? e.message : String(e)
      if (options.onRedeemError === 'propagate') {
        throw createRpcError(ERROR_CODES.Misconfiguration, `Failed to redeem credits: ${ret.errorReason}`)
      }
      // Default: attach error to result but don't throw
    }
    return ret
  }
}

/**
 * Type guard to detect AsyncIterable values.
 */
function isAsyncIterable<T = unknown>(value: any): value is AsyncIterable<T> {
  return value != null && typeof value[Symbol.asyncIterator] === 'function'
}

/**
 * Wrap an AsyncIterable with metadata injection at the end of the stream
 */
function wrapAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  onFinally: () => Promise<any>,
  planId: string,
  subscriberAddress: Address,
  credits: bigint,
) {
  async function* generator() {
    let creditsResult: any = null
    try {
      for await (const chunk of iterable) {
        yield chunk as T
      }
    } finally {
      creditsResult = await onFinally()
    }

    // Yield a _meta chunk at the end with the redemption result
    const metadataChunk = {
      _meta: {
        // Only include txHash if it has a value
        ...(creditsResult?.transaction && { txHash: creditsResult.transaction }),
        creditsRedeemed: creditsResult?.success ? (creditsResult.creditsRedeemed ?? credits.toString()) : '0',
        remainingBalance: creditsResult?.remainingBalance,
        planId: planId,
        subscriberAddress: subscriberAddress,
        success: creditsResult?.success || false,
        ...(creditsResult?.errorReason && { errorReason: creditsResult.errorReason }),
      },
    }
    yield metadataChunk as T
  }
  return generator()
}
