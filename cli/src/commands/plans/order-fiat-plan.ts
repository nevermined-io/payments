import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Initiates the purchase of a Plan requiring the payment in Fiat. This method will return a URL where the user can complete the payment.
 */
export default class OrderFiatPlan extends BaseCommand {
  static override description = "Initiates the purchase of a Plan requiring the payment in Fiat. This method will return a URL where the user can complete the payment."

  static override examples = [
    '$ nvm plans order-fiat-plan <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

  }

  static override args = {
    plan: Args.string({
      description: "plan identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.orderFiatPlan(args.plan)

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
