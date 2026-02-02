import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a FIXED credits configuration.
 */
export default class GetFixedCreditsConfig extends BaseCommand {
  static override description = "Builds a FIXED credits configuration."

  static override examples = [
    '$ nvm plans get-fixed-credits-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-granted': Flags.string({ required: true }),
    'credits-per-request': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getFixedCreditsConfig(flags['credits-granted'], flags['credits-per-request'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
