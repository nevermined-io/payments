import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * It allows to an AI Builder to create a Payment Plan on Nevermined limited by duration. A Nevermined Credits Plan limits the access by the access/usage of the Plan. With them, AI Builders control the number of requests that can be made to an agent or service. Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits. When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
 */
export default class RegisterTimePlan extends BaseCommand {
  static override description = "It allows to an AI Builder to create a Payment Plan on Nevermined limited by duration. A Nevermined Credits Plan limits the access by the access/usage of the Plan. With them, AI Builders control the number of requests that can be made to an agent or service. Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits. When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service."

  static override examples = [
    '$ nvm plans register-time-plan'
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
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.registerTimePlan(await this.parseJsonInput(flags['plan-metadata']), await this.parseJsonInput(flags['price-config']), await this.parseJsonInput(flags['credits-config']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
