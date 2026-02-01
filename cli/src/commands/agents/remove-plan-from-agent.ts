import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Removes a Payment Plan from an AI Agent. After this operation, users with access to the Payment Plan will no longer be able to access the AI Agent.
 */
export default class RemovePlanFromAgent extends BaseCommand {
  static override description = "Removes a Payment Plan from an AI Agent. After this operation, users with access to the Payment Plan will no longer be able to access the AI Agent."

  static override examples = [
    '$ nvm agents remove-plan-from-agent <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-id': Flags.string({ required: true }),
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
      const result = await payments.agents.removePlanFromAgent(args.plan, flags['agent-id'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
