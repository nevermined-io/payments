import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Adds an existing Payment Plan to an AI Agent. After this operation, users with access to the Payment Plan will be able to access the AI Agent.
 */
export default class AddPlanToAgent extends BaseCommand {
  static override description = "Adds an existing Payment Plan to an AI Agent. After this operation, users with access to the Payment Plan will be able to access the AI Agent."

  static override examples = [
    '$ nvm agents add-plan-to-agent <planId>'
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
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.addPlanToAgent(args.plan, flags['agent-id'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
