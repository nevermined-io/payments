import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds an EXPIRABLE credits configuration (time-based access).
 */
export default class GetExpirableDurationConfig extends BaseCommand {
  static override description = "Builds an EXPIRABLE credits configuration (time-based access)."

  static override examples = [
    '$ nevermined plans get-expirable-duration-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'duration-of-plan': Flags.string({ required: true }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getExpirableDurationConfig(flags['duration-of-plan'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
