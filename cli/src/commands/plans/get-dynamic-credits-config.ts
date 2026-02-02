import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a DYNAMIC credits configuration (range-limited per request).
 */
export default class GetDynamicCreditsConfig extends BaseCommand {
  static override description = "Builds a DYNAMIC credits configuration (range-limited per request)."

  static override examples = [
    '$ nvm plans get-dynamic-credits-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-granted': Flags.string({ required: true }),
    'min-credits-per-request': Flags.string({ required: false }),
    'max-credits-per-request': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getDynamicCreditsConfig(flags['credits-granted'], flags['min-credits-per-request'], flags['max-credits-per-request'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
