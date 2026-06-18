/**
 * Main paywall decorator for MCP handlers (tools, resources, prompts)
 */
import { Address, isValidScheme } from '../../common/types.js'
import type { Payments } from '../../payments.js'
import { decodeAccessToken, encodeAccessToken } from '../../utils.js'
import {
  buildPaymentRequired,
  buildPaymentRequiredForPlans,
  type SettlePermissionsResult,
  type X402PaymentRequired,
} from '../../x402/facilitator-api.js'
import {
  AuthResult,
  McpConfig,
  PaywallOptions,
  PromptOptions,
  ResourceOptions,
  ToolOptions,
} from '../types/paywall.types.js'
import {
  ERROR_CODES,
  PaymentRequiredError,
  SettlementFailedError,
  createRpcError,
} from '../utils/errors.js'
import {
  NEVERMINED_CREDITS_META_KEY,
  X402_PAYMENT_RESPONSE_META_KEY,
  paymentRequiredResult,
  readPaymentPayload,
} from '../utils/meta.js'
import { PaywallAuthenticator } from './auth.js'
import { CreditsContextProvider } from './credits-context.js'

// Emit the Authorization-header deprecation notice at most once per process to
// avoid log spam on high-traffic servers still using the legacy header path.
let authHeaderDeprecationWarned = false

/**
 * Main class for creating paywall-protected MCP handlers
 */
export class PaywallDecorator {
  // Internal config ensures serverName is always a concrete string
  private config: { planId: string; agentId?: string; serverName: string } = {
    planId: '',
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
      planId: options.planId || this.config.planId,
      agentId: options.agentId ?? this.config.agentId,
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
      // Validate configuration: a planId must be resolvable (per-tool option or
      // server-level config). agentId is optional under the plan-centric model
      // (the facilitator resolves everything from planId + token).
      const configuredPlanId = options?.planId ?? this.config.planId
      if (!configuredPlanId) {
        throw createRpcError(
          ERROR_CODES.Misconfiguration,
          'Server misconfiguration: missing planId',
        )
      }

      const kind = options?.kind ?? 'tool'
      const name = options?.name ?? 'unnamed'

      // Detect resource signature: (url, variables, extra)
      const isResource = allArgs.length >= 2 && allArgs[0] instanceof URL
      const extra = isResource ? allArgs[2] : allArgs[1]
      const argsOrVars = isResource ? allArgs[1] : allArgs[0]

      try {
        // x402 v2 MCP transport: prefer the in-band payment payload from
        // params._meta["x402/payment"]. Re-encode it into the access token
        // string the verify/settle path expects and present it via the same
        // extra/headers shape the auth flow reads, so the in-band payload takes
        // precedence over the Authorization header (kept as a deprecated
        // fallback when the in-band payload is absent). The RAW extra is still
        // forwarded to the user handler below.
        const paymentPayload = readPaymentPayload(extra)
        let authExtra = extra
        if (paymentPayload) {
          const token = encodeAccessToken(paymentPayload)
          // Synthesize an auth-only extra carrying the in-band token. This
          // intentionally drops the rest of `extra` for the AUTH call only; the
          // RAW `extra` (with `_meta`) is still forwarded to the user handler below.
          authExtra = { requestInfo: { headers: { authorization: `Bearer ${token}` } } }
        } else if (!authHeaderDeprecationWarned) {
          authHeaderDeprecationWarned = true
          console.warn(
            '[x402] No _meta["x402/payment"] on the MCP request; falling back to the ' +
              'Authorization header (deprecated under the x402 v2 MCP transport).',
          )
        }

        // 1. Authenticate request
        const authResult = await this.authenticator.authenticate(
          authExtra,
          { planId: configuredPlanId, maxAmount: options?.maxAmount },
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
          // fix: pre-existing arg order — fallbackEndpoint=httpUrl, httpVerb='POST'
          // (matches the streaming site above)
          authResult.httpUrl,
          'POST',
        )

        // Settlement failed AFTER the tool executed: per the x402 v2 MCP
        // transport spec, do NOT return the tool's content — surface only the
        // payment error so a paid result is never delivered without payment
        // landing. (onRedeemError "ignore" therefore no longer delivers paid
        // content; "propagate" already threw a Misconfiguration in redeemCredits.)
        if (creditsResult && !creditsResult.success) {
          console.error(
            `[x402] settlement failed after tool execution; suppressing tool content. reason=${creditsResult.errorReason}`,
          )
          throw new SettlementFailedError(this.buildPaymentRequiredFromAuth(authResult))
        }

        // creditsResult is undefined for free / no-credit calls (no settlement
        // performed) — in that case the spec receipt is omitted. On success the
        // full receipt goes under the spec key; Nevermined observability is kept
        // under a namespaced key so it never collides with the spec shape.
        result._meta = {
          ...result._meta,
          ...(creditsResult && { [X402_PAYMENT_RESPONSE_META_KEY]: creditsResult }),
          [NEVERMINED_CREDITS_META_KEY]: {
            ...(creditsResult?.transaction && { txHash: creditsResult.transaction }),
            creditsRedeemed: creditsResult?.success
              ? (creditsResult.creditsRedeemed ?? credits.toString())
              : '0',
            remainingBalance: creditsResult?.remainingBalance,
            planId: authResult.planId,
            subscriberAddress: authResult.subscriberAddress,
            success: creditsResult ? creditsResult.success : true,
          },
        }
        return result
      } catch (error) {
        // Payment-required (pre-execution, from auth) and settlement-failure
        // (post-execution) are surfaced in band as an error tool result for
        // tools. Resources/prompts have no tool-result error channel, so the
        // error propagates as a JSON-RPC error instead.
        if (error instanceof PaymentRequiredError && kind === 'tool') {
          return paymentRequiredResult(error.paymentRequired)
        }
        throw error
      }
    }
  }

  /**
   * Build a spec-shaped `PaymentRequired` dict for a settlement failure, from
   * the authenticated request context. Surfaced (with tool content suppressed)
   * when settlement fails after the tool has executed.
   */
  private buildPaymentRequiredFromAuth(authResult: AuthResult): Record<string, any> {
    const planId = authResult.planId || ''
    const paymentRequired = buildPaymentRequiredForPlans(planId ? [planId] : [''], {
      endpoint: authResult.logicalUrl || authResult.httpUrl,
      agentId: authResult.agentId,
      httpVerb: 'POST',
      environment: this.payments.getEnvironmentName(),
    }) as X402PaymentRequired & { error?: string }
    paymentRequired.error = 'settlement failed'
    return paymentRequired
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
  ): Promise<SettlePermissionsResult | undefined> {
    // No settlement for free / no-credit calls — signalled to the caller as
    // `undefined` so the spec receipt (_meta["x402/payment-response"]) is omitted.
    if (!(credits && credits > 0n && subscriberAddress && planId)) {
      return undefined
    }

    const decoded = decodeAccessToken(token)
    const scheme = isValidScheme(decoded?.accepted?.scheme)
      ? decoded.accepted.scheme
      : 'nvm:erc4337'
    try {
      const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
        endpoint: endpoint || '',
        agentId,
        httpVerb,
        scheme,
        environment: this.payments.getEnvironmentName(),
      })

      return await this.payments.facilitator.settlePermissions({
        paymentRequired,
        x402AccessToken: token,
        maxAmount: credits,
      })
    } catch (primaryError) {
      // If logical URL fails and we have an HTTP URL fallback, retry with it
      let lastError: unknown = primaryError
      if (fallbackEndpoint) {
        try {
          const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
            endpoint: fallbackEndpoint,
            agentId,
            httpVerb,
            scheme,
            environment: this.payments.getEnvironmentName(),
          })

          return await this.payments.facilitator.settlePermissions({
            paymentRequired,
            x402AccessToken: token,
            maxAmount: credits,
          })
        } catch (fallbackError) {
          // Fallback also failed, use fallback error as the reported error
          lastError = fallbackError
        }
      }

      const errorReason = lastError instanceof Error ? lastError.message : String(lastError)
      console.error(`[x402] settle failed: ${errorReason}`)
      if (options.onRedeemError === 'propagate') {
        throw createRpcError(
          ERROR_CODES.Misconfiguration,
          `Failed to redeem credits: ${errorReason}`,
        )
      }
      // Default ("ignore"): return a failed result so the caller suppresses the
      // tool content and surfaces the in-band payment error (always-suppress
      // under the x402 v2 MCP transport).
      return { success: false, transaction: '', network: '', errorReason }
    }
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

    // Yield a _meta chunk at the end with the redemption result.
    // NOTE: a stream cannot retroactively suppress already-yielded chunks, so a
    // post-execution settlement failure on a stream is only reported here in the
    // final _meta chunk (under nevermined/credits) — it cannot withhold content
    // the way a non-streaming tool result does. `creditsResult` is undefined for
    // free / no-credit calls.
    const settlement = creditsResult || undefined
    const metadataChunk = {
      _meta: {
        // Spec receipt only on a successful settlement.
        ...(settlement?.success && { [X402_PAYMENT_RESPONSE_META_KEY]: settlement }),
        // Nevermined-namespaced observability (NOT part of the x402 spec).
        [NEVERMINED_CREDITS_META_KEY]: {
          ...(settlement?.transaction && { txHash: settlement.transaction }),
          creditsRedeemed: settlement?.success
            ? (settlement.creditsRedeemed ?? credits.toString())
            : '0',
          remainingBalance: settlement?.remainingBalance,
          planId,
          subscriberAddress,
          success: settlement ? settlement.success : true,
          ...(settlement?.errorReason && { errorReason: settlement.errorReason }),
        },
      },
    }
    yield metadataChunk as T
  }
  return generator()
}
