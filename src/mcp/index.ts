import type { Payments } from '../payments.js'
import { PaywallDecorator } from './core/paywall.js'
import { PaywallAuthenticator } from './core/auth.js'
import { CreditsContextProvider } from './core/credits-context.js'
import type {
  PaywallOptions,
  ToolOptions,
  ResourceOptions,
  PromptOptions,
} from './types/paywall.types.js'
export type {
  CreditsContext,
  CreditsOption,
  PaywallOptions,
  McpConfig,
} from './types/paywall.types.js'
export { buildExtraFromHttpHeaders, buildExtraFromHttpRequest } from './utils/extra.js'

/**
 * Build MCP integration with modular architecture.
 * Only non-curried API is exposed per product requirement.
 */
export function buildMcpIntegration(paymentsService: Payments) {
  const authenticator = new PaywallAuthenticator(paymentsService)
  const creditsContext = new CreditsContextProvider()
  const paywallDecorator = new PaywallDecorator(paymentsService, authenticator, creditsContext)

  function configure(options: { agentId: string; serverName?: string }) {
    paywallDecorator.configure(options)
  }

  function withPaywall<TArgs = any>(
    handler: (args: TArgs, extra?: any) => Promise<any> | any,
    options: ToolOptions | PromptOptions,
  ): (args: TArgs, extra?: any) => Promise<any>
  function withPaywall<TArgs = any>(
    handler: (args: TArgs, extra?: any) => Promise<any> | any,
  ): (args: TArgs, extra?: any) => Promise<any>
  function withPaywall(
    handler: (
      uri: URL,
      variables: Record<string, string | string[]>,
      extra?: any,
    ) => Promise<any> | any,
    options: ResourceOptions,
  ): (uri: URL, variables: Record<string, string | string[]>, extra?: any) => Promise<any>
  function withPaywall(handler: any, options?: ToolOptions | PromptOptions | ResourceOptions): any {
    const opts =
      (options as PaywallOptions | undefined) ?? ({ kind: 'tool', name: 'unnamed' } as any)
    return (paywallDecorator.protect as any)(handler, opts)
  }

  function attach(server: {
    registerTool: (name: string, config: any, handler: any) => void
    registerResource: (name: string, template: any, config: any, handler: any) => void
    registerPrompt: (name: string, config: any, handler: any) => void
  }) {
    return {
      registerTool<TArgs = any>(
        name: string,
        config: any,
        handler: (args: TArgs, extra?: any) => Promise<any> | any,
        options?: Omit<ToolOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, { kind: 'tool', name, ...(options || {}) })
        server.registerTool(name, config, protectedHandler)
      },
      registerResource(
        name: string,
        template: any,
        config: any,
        handler: (
          uri: URL,
          variables: Record<string, string | string[]>,
          extra?: any,
        ) => Promise<any> | any,
        options?: Omit<ResourceOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, {
          kind: 'resource',
          name,
          ...(options || {}),
        })
        server.registerResource(name, template, config, protectedHandler)
      },
      registerPrompt<TArgs = any>(
        name: string,
        config: any,
        handler: (args: TArgs, extra?: any) => Promise<any> | any,
        options?: Omit<PromptOptions, 'kind' | 'name'>,
      ) {
        const protectedHandler = withPaywall(handler, { kind: 'prompt', name, ...(options || {}) })
        server.registerPrompt(name, config, protectedHandler)
      },
    }
  }

  return { configure, withPaywall, attach }
}
