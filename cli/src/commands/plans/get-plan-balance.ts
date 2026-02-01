import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Gets the balance of an account for a Payment Plan.
 */
export default class GetPlanBalance extends BaseCommand {
  static override description = "Gets the balance of an account for a Payment Plan."

  static override examples = [
    '$ nvm plans get-plan-balance <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'account-address': Flags.string({
      description: "accountAddress as JSON string",
      required: false
    }),
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
      const result = await payments.plans.getPlanBalance(args.plan, await this.parseJsonInput(flags['account-address']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
