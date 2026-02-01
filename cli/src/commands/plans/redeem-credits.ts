import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Burns/redeem credits for a given Payment Plan.
 */
export default class RedeemCredits extends BaseCommand {
  static override description = "Burns/redeem credits for a given Payment Plan."

  static override examples = [
    '$ nvm plans redeem-credits <agentRequestId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'plan-id': Flags.string({ required: true }),
    'redeem-from': Flags.string({
      description: "redeemFrom as JSON string",
      required: true
    }),
    'credits-amount-to-redeem': Flags.string({ required: true }),
  }

  static override args = {
    agentRequest: Args.string({
      description: "agentRequest identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.redeemCredits(args.agentRequest, flags['plan-id'], await this.parseJsonInput(flags['redeem-from']), flags['credits-amount-to-redeem'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
