import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a crypto price configuration for a plan.
 */
export default class GetCryptoPriceConfig extends BaseCommand {
  static override description = "Builds a crypto price configuration for a plan."

  static override examples = [
    '$ nvm plans get-crypto-price-config'
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
      const result = await payments.plans.getCryptoPriceConfig(flags['amount'], flags['receiver'], flags['token-address'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
