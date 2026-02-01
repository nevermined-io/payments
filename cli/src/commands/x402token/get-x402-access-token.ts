import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Create a permission and get an X402 access token for the given plan. This token allows the agent to verify and settle permissions on behalf of the subscriber. The token contains cryptographically signed session keys that delegate specific permissions (order, burn) to the agent.
 */
export default class GetX402AccessToken extends BaseCommand {
  static override description = "Create a permission and get an X402 access token for the given plan. This token allows the agent to verify and settle permissions on behalf of the subscriber. The token contains cryptographically signed session keys that delegate specific permissions (order, burn) to the agent."

  static override examples = [
    '$ nvm x402token get-x402-access-token <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-id': Flags.string({ required: false }),
    'redemption-limit': Flags.string({ required: false }),
    'order-limit': Flags.string({ required: false }),
    'expiration': Flags.string({ required: false }),
  }

  static override args = {
    plan: Args.string({
      description: "plan identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.x402.getX402AccessToken(args.plan, flags['agent-id'], flags['redemption-limit'], flags['order-limit'], flags['expiration'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
