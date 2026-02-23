import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a Pay-As-You-Go price configuration using the template address from the API.
 */
export default class GetPayAsYouGoPriceConfig extends BaseCommand {
  static override description = "Builds a Pay-As-You-Go price configuration using the template address from the API."

  static override examples = [
    '$ nvm plans get-pay-as-you-go-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'receiver': Flags.string({ required: true }),
    'token-address': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getPayAsYouGoPriceConfig(flags['amount'], flags['receiver'], flags['token-address'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
