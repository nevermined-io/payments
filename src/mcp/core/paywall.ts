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
} from '../types/paywall.types.js'
import { ERROR_CODES, createRpcError } from '../utils/errors.js'

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

      // 2. Execute original handler
      const result = await (handler as any)(...allArgs)

      // 3. Resolve credits to burn (defaults to 1n when undefined)
      const credits = this.creditsContext.resolve(options?.credits, argsOrVars, result, authResult)

      // 4. Redeem credits
      await this.redeemCredits(authResult.requestId, authResult.token, credits, options)

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
  ): Promise<void> {
    try {
      if (credits && credits > 0n) {
        await this.payments.requests.redeemCreditsFromRequest(requestId, token, credits)
      }
    } catch (e) {
      if (options.onRedeemError === 'propagate') {
        throw createRpcError(ERROR_CODES.Misconfiguration, 'Failed to redeem credits')
      }
      // Default: ignore redemption errors
    }
  }
}
