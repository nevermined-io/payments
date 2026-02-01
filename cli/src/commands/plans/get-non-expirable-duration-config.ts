import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a NON-EXPIRABLE credits configuration (no expiration).
 */
export default class GetNonExpirableDurationConfig extends BaseCommand {
  static override description = "Builds a NON-EXPIRABLE credits configuration (no expiration)."

  static override examples = [
    '$ nvm plans get-non-expirable-duration-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getNonExpirableDurationConfig()

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
