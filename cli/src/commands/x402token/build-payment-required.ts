import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'
import { buildPaymentRequired, EnvironmentName } from '@nevermined-io/payments'

const SCHEME_OPTIONS = ['nvm:erc4337', 'nvm:card-delegation'] as const
type SchemeOption = (typeof SCHEME_OPTIONS)[number]

/**
 * Build an X402PaymentRequired payload for verify-permissions / settle-permissions.
 */
export default class BuildPaymentRequired extends BaseCommand {
  static override description =
    'Build an X402PaymentRequired payload for the given plan. The output can be passed verbatim into the `paymentRequired` field of `nvm facilitator verify-permissions` and `nvm facilitator settle-permissions`.'

  static override examples = [
    '$ nvm x402token build-payment-required <planId> --resource-url https://example.com/api/test',
    '$ nvm x402token build-payment-required <planId> --resource-url https://example.com/api/test --agent-id <agentId> --http-verb POST',
    '$ nvm x402token build-payment-required <planId> --scheme nvm:card-delegation --network stripe',
    '$ nvm x402token build-payment-required <planId> --resource-url https://example.com/api/test -f json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'resource-url': Flags.string({
      description: 'Protected resource URL (maps to the `endpoint` option in the SDK)',
      required: false,
    }),
    'agent-id': Flags.string({ required: false }),
    'http-verb': Flags.string({
      description: 'HTTP verb of the protected resource (e.g. POST)',
      required: false,
    }),
    scheme: Flags.string({
      description: 'x402 payment scheme',
      options: [...SCHEME_OPTIONS],
      default: 'nvm:erc4337',
      required: false,
    }),
    network: Flags.string({
      description:
        'Override the network. Defaults to the scheme/environment default (e.g. eip155:84532 for nvm:erc4337 on sandbox).',
      required: false,
    }),
    description: Flags.string({
      description: 'Human-readable description of the protected resource',
      required: false,
    }),
    'mime-type': Flags.string({
      description: 'MIME type of the protected resource',
      required: false,
    }),
    environment: Flags.string({
      description:
        'Environment used to resolve the default network. Falls back to the active profile when omitted.',
      required: false,
    }),
  }

  static override args = {
    plan: Args.string({
      description: 'plan identifier',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    try {
      const environment = await this.resolveEnvironment(flags)

      const paymentRequired = buildPaymentRequired(args.plan, {
        endpoint: flags['resource-url'],
        agentId: flags['agent-id'],
        httpVerb: flags['http-verb'],
        scheme: flags.scheme as SchemeOption,
        network: flags.network,
        description: flags.description,
        mimeType: flags['mime-type'],
        environment,
      })

      this.formatter.output(paymentRequired)
    } catch (error) {
      this.handleError(error)
    }
  }

  private async resolveEnvironment(flags: any): Promise<EnvironmentName | undefined> {
    if (flags.environment) {
      return flags.environment as EnvironmentName
    }

    const envVar = process.env.NVM_ENVIRONMENT
    if (envVar) {
      return envVar as EnvironmentName
    }

    const config = await this.configManager.get(undefined, flags.profile)
    return config?.environment as EnvironmentName | undefined
  }
}
