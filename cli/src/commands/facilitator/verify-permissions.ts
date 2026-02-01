import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Verify if a subscriber has permission to use credits from a payment plan. This method simulates the credit usage without actually burning credits, checking if the subscriber has sufficient balance and permissions. The planId and subscriberAddress are extracted from the x402AccessToken.
 */
export default class VerifyPermissions extends BaseCommand {
  static override description = "Verify if a subscriber has permission to use credits from a payment plan. This method simulates the credit usage without actually burning credits, checking if the subscriber has sufficient balance and permissions. The planId and subscriberAddress are extracted from the x402AccessToken."

  static override examples = [
    '$ nvm facilitator verify-permissions'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'params': Flags.string({
      description: "params as JSON string",
      required: true
    }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.facilitator.verifyPermissions(await this.parseJsonInput(flags['params']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
