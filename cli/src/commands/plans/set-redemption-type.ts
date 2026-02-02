import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Sets the redemption type in a credits configuration.
 */
export default class SetRedemptionType extends BaseCommand {
  static override description = "Sets the redemption type in a credits configuration."

  static override examples = [
    '$ nvm plans set-redemption-type'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-config': Flags.string({
      description: "creditsConfig as JSON string",
      required: true
    }),
    'redemption-type': Flags.string({ required: true }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.setRedemptionType(await this.parseJsonInput(flags['credits-config']), flags['redemption-type'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
