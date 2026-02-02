import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a native token price configuration for a plan.
 */
export default class GetNativeTokenPriceConfig extends BaseCommand {
  static override description = "Builds a native token price configuration for a plan."

  static override examples = [
    '$ nvm plans get-native-token-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'receiver': Flags.string({
      description: "receiver as JSON string",
      required: true
    }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getNativeTokenPriceConfig(flags['amount'], await this.parseJsonInput(flags['receiver']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
