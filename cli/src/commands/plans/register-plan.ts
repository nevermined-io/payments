import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * It allows to an AI Builder to register a Payment Plan on Nevermined in a flexible manner. A Payment Plan defines 2 main aspects: 1. What a subscriber needs to pay to get the plan (i.e. 100 USDC, 5 USD, etc). 2. What the subscriber gets in return to access the AI agents associated to the plan (i.e. 100 credits, 1 week of usage, etc). With Payment Plans, AI Builders control the usage to their AI Agents. Every time a user accesses an AI Agent to the Payment Plan, the usage consumes from a capped amount of credits (or when the plan duration expires). When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
 */
export default class RegisterPlan extends BaseCommand {
  static override description = "It allows to an AI Builder to register a Payment Plan on Nevermined in a flexible manner. A Payment Plan defines 2 main aspects: 1. What a subscriber needs to pay to get the plan (i.e. 100 USDC, 5 USD, etc). 2. What the subscriber gets in return to access the AI agents associated to the plan (i.e. 100 credits, 1 week of usage, etc). With Payment Plans, AI Builders control the usage to their AI Agents. Every time a user accesses an AI Agent to the Payment Plan, the usage consumes from a capped amount of credits (or when the plan duration expires). When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service."

  static override examples = [
    '$ nvm plans register-plan'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
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
    'nonce': Flags.string({ required: false }),
    'access-limit': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.registerPlan(await this.parseJsonInput(flags['plan-metadata']), await this.parseJsonInput(flags['price-config']), await this.parseJsonInput(flags['credits-config']), flags['nonce'], flags['access-limit'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
