import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * It allows to an AI Builder to create a Trial Payment Plan on Nevermined limited by duration. A Nevermined Trial Plan allow subscribers of that plan to test the Agents associated to it. A Trial plan is a plan that only can be purchased once by a user. Trial plans, as regular plans, can be limited by duration (i.e 1 week of usage) or by credits (i.e 100 credits to use the agent).
 */
export default class RegisterCreditsTrialPlan extends BaseCommand {
  static override description = "It allows to an AI Builder to create a Trial Payment Plan on Nevermined limited by duration. A Nevermined Trial Plan allow subscribers of that plan to test the Agents associated to it. A Trial plan is a plan that only can be purchased once by a user. Trial plans, as regular plans, can be limited by duration (i.e 1 week of usage) or by credits (i.e 100 credits to use the agent)."

  static override examples = [
    '$ nvm plans register-credits-trial-plan'
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
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.registerCreditsTrialPlan(await this.parseJsonInput(flags['plan-metadata']), await this.parseJsonInput(flags['price-config']), await this.parseJsonInput(flags['credits-config']))

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
