import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Updates the metadata and API attributes of an existing AI Agent.
 */
export default class UpdateAgentMetadata extends BaseCommand {
  static override description = "Updates the metadata and API attributes of an existing AI Agent."

  static override examples = [
    '$ nvm agents update-agent-metadata <agentId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-metadata': Flags.string({
      description: "agentMetadata as JSON string",
      required: true
    }),
    'agent-api': Flags.string({ required: true }),
  }

  static override args = {
    agent: Args.string({
      description: "agent identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.updateAgentMetadata(args.agent, await this.parseJsonInput(flags['agent-metadata']), flags['agent-api'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
