import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a Pay-As-You-Go credits configuration.
 */
export default class GetPayAsYouGoCreditsConfig extends BaseCommand {
  static override description = "Builds a Pay-As-You-Go credits configuration."

  static override examples = [
    '$ nvm plans get-pay-as-you-go-credits-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getPayAsYouGoCreditsConfig()

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
