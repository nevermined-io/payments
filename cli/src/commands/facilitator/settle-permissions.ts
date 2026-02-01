import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Settle (burn) credits from a subscriber's payment plan. This method executes the actual credit consumption, burning the specified number of credits from the subscriber's balance. If the subscriber doesn't have enough credits, it will attempt to order more before settling. The planId and subscriberAddress are extracted from the x402AccessToken.
 */
export default class SettlePermissions extends BaseCommand {
  static override description = "Settle (burn) credits from a subscriber's payment plan. This method executes the actual credit consumption, burning the specified number of credits from the subscriber's balance. If the subscriber doesn't have enough credits, it will attempt to order more before settling. The planId and subscriberAddress are extracted from the x402AccessToken."

  static override examples = [
    '$ nvm facilitator settle-permissions'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'params': Flags.string({
      description: "params as JSON string",
      required: true
    }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.facilitator.settlePermissions(await this.parseJsonInput(flags['params']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
