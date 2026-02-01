import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Orders a Payment Plan requiring the payment in crypto. The user must have enough balance in the selected token.
 */
export default class OrderPlan extends BaseCommand {
  static override description = "Orders a Payment Plan requiring the payment in crypto. The user must have enough balance in the selected token."

  static override examples = [
    '$ nvm plans order-plan <planId>'
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
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.orderPlan(args.plan)

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
