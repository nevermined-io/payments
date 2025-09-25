/**
 * Main paywall decorator for MCP handlers (tools, resources, prompts)
 */
import type { Payments } from '../../payments.js'
import { PaywallAuthenticator } from './auth.js'
import { CreditsContextProvider } from './credits-context.js'
import {
  PaywallOptions,
  McpConfig,
  ToolOptions,
  ResourceOptions,
  PromptOptions,
  PaywallContext,
} from '../types/paywall.types.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'
import { NvmAPIResult } from '../../common/types.js'

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
        options,
        this.config.agentId,
        this.config.serverName,
        name,
        kind,
        argsOrVars,
      )

      // 2. Resolve initial credits (for context)
      const initialCredits = this.creditsContext.resolve(
        options?.credits,
        argsOrVars,
        null,
        authResult,
      )

      // 3. Create paywall context
      const paywallContext: PaywallContext = {
        authResult,
        credits: initialCredits,
        agentRequest: authResult.agentRequest,
      }

      // 4. Execute original handler with context
      const result = await (handler as any)(...allArgs, paywallContext)

      // 5. Resolve final credits to burn (may be different if credits are dynamic)
      const credits = this.creditsContext.resolve(options?.credits, argsOrVars, result, authResult)

      // 6. If the result is an AsyncIterable (stream), redeem on completion
      if (isAsyncIterable(result)) {
        const onFinally = async () => {
          return await this.redeemCredits(authResult.requestId, authResult.token, credits, options)
        }
        return wrapAsyncIterable(result, onFinally, authResult.requestId, credits)
      }

      // 7. Non-streaming: redeem immediately
      const creditsResult = await this.redeemCredits(
        authResult.requestId,
        authResult.token,
        credits,
        options,
      )
      if (creditsResult.success) {
        result.metadata = {
          ...result.metadata,
          txHash: creditsResult.txHash,
          requestId: authResult.requestId,
          creditsRedeemed: credits.toString(),
          success: true,
        }
      }
      return result
    }
  }

  /**
   * Redeem credits after successful request
   */
  private async redeemCredits(
    requestId: string,
    token: string,
    credits: bigint,
    options: PaywallOptions,
  ): Promise<NvmAPIResult> {
    let ret: NvmAPIResult = {
      success: true,
      txHash: '',
    }
    try {
      if (credits && credits > 0n) {
        ret = await this.payments.requests.redeemCreditsFromRequest(requestId, token, credits)
      }
    } catch (e) {
      if (options.onRedeemError === 'propagate') {
        throw createRpcError(ERROR_CODES.Misconfiguration, 'Failed to redeem credits')
      }
      // Default: ignore redemption errors
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
  requestId: string,
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

    // Yield a metadata chunk at the end with the redemption result
    const metadataChunk = {
      metadata: {
        txHash: creditsResult?.txHash,
        requestId: requestId,
        creditsRedeemed: credits.toString(),
        success: creditsResult?.success || false,
      },
    }
    yield metadataChunk as T
  }
  return generator()
}
