import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a CARD (fiat) Pay-As-You-Go price configuration (`isCrypto: false`) using the template address from the API.
 */
export default class GetFiatPayAsYouGoPriceConfig extends BaseCommand {
  static override description = "Builds a CARD (fiat) Pay-As-You-Go price configuration (`isCrypto: false`) using the template address from the API."

  static override examples = [
    '$ nevermined plans get-fiat-pay-as-you-go-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'receiver': Flags.string({ required: true }),
    'currency': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getFiatPayAsYouGoPriceConfig(flags['amount'], flags['receiver'], flags['currency'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
