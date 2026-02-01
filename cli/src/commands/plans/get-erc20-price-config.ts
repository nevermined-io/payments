import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds an ERC20 price configuration for a plan.
 */
export default class GetERC20PriceConfig extends BaseCommand {
  static override description = "Builds an ERC20 price configuration for a plan."

  static override examples = [
    '$ nvm plans get-erc20-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'token-address': Flags.string({
      description: "tokenAddress as JSON string",
      required: true
    }),
    'receiver': Flags.string({
      description: "receiver as JSON string",
      required: true
    }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getERC20PriceConfig(flags['amount'], await this.parseJsonInput(flags['token-address']), await this.parseJsonInput(flags['receiver']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
