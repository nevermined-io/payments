import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Gets the list of Agents that have associated a specific Payment Plan. All the agents returned can be accessed by the users that are subscribed to the Payment Plan.
 */
export default class GetAgentsAssociatedToAPlan extends BaseCommand {
  static override description = "Gets the list of Agents that have associated a specific Payment Plan. All the agents returned can be accessed by the users that are subscribed to the Payment Plan."

  static override examples = [
    '$ nvm plans get-agents-associated-to-a-plan <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'pagination': Flags.string({
      description: "pagination as JSON string",
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
      const result = await payments.plans.getAgentsAssociatedToAPlan(args.plan, await this.parseJsonInput(flags['pagination']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
