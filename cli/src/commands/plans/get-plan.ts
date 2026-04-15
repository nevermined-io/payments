import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Gets the information about a Payment Plan by its identifier.
 */
export default class GetPlan extends BaseCommand {
  static override description = "Gets the information about a Payment Plan by its identifier."

  static override examples = [
    '$ nvm plans get-plan <planId>'
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
      const result = await payments.plans.getPlan(args.plan)

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
