import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * It registers a new AI Agent on Nevermined. The agent must be associated to one or multiple Payment Plans. Users that are subscribers of a payment plan can query the agent. Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits. When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
 */
export default class RegisterAgent extends BaseCommand {
  static override description = "It registers a new AI Agent on Nevermined. The agent must be associated to one or multiple Payment Plans. Users that are subscribers of a payment plan can query the agent. Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits. When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent."

  static override examples = [
    '$ nvm agents register-agent'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-metadata': Flags.string({
      description: "agentMetadata as JSON string",
      required: true
    }),
    'agent-api': Flags.string({ required: true }),
    'payment-plans': Flags.string({ required: true }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.registerAgent(await this.parseJsonInput(flags['agent-metadata']), flags['agent-api'], flags['payment-plans'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
