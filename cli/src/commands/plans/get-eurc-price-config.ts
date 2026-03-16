import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds an EURC (Euro stablecoin) price configuration for a plan.
 */
export default class GetEURCPriceConfig extends BaseCommand {
  static override description = "Builds an EURC (Euro stablecoin) price configuration for a plan."

  static override examples = [
    '$ nvm plans get-eurc-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'receiver': Flags.string({ required: true }),
    'eurc-address': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getEURCPriceConfig(flags['amount'], flags['receiver'], flags['eurc-address'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
