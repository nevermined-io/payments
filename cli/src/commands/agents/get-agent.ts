import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Gets the metadata for a given Agent identifier.
 */
export default class GetAgent extends BaseCommand {
  static override description = "Gets the metadata for a given Agent identifier."

  static override examples = [
    '$ nvm agents get-agent <agentId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

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
      const result = await payments.agents.getAgent(args.agent)

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
