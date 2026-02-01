import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * It registers a new AI Agent and a Payment Plan associated to this new agent. Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits. When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
 */
export default class RegisterAgentAndPlan extends BaseCommand {
  static override description = "It registers a new AI Agent and a Payment Plan associated to this new agent. Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits. When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent."

  static override examples = [
    '$ nvm agents register-agent-and-plan'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-metadata': Flags.string({
      description: "agentMetadata as JSON string",
      required: true
    }),
    'agent-api': Flags.string({ required: true }),
    'plan-metadata': Flags.string({
      description: "planMetadata as JSON string",
      required: true
    }),
    'price-config': Flags.string({
      description: "priceConfig as JSON string",
      required: true
    }),
    'credits-config': Flags.string({
      description: "creditsConfig as JSON string",
      required: true
    }),
    'access-limit': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.registerAgentAndPlan(await this.parseJsonInput(flags['agent-metadata']), flags['agent-api'], await this.parseJsonInput(flags['plan-metadata']), await this.parseJsonInput(flags['price-config']), await this.parseJsonInput(flags['credits-config']), flags['access-limit'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
