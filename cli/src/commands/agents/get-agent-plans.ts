import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Gets the list of plans that can be ordered to get access to an agent.
 */
export default class GetAgentPlans extends BaseCommand {
  static override description = "Gets the list of plans that can be ordered to get access to an agent."

  static override examples = [
    '$ nvm agents get-agent-plans <agentId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'pagination': Flags.string({
      description: "pagination as JSON string",
      required: false
    }),
  }

  static override args = {
    agent: Args.string({
      description: "agent identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.getAgentPlans(args.agent, await this.parseJsonInput(flags['pagination']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
