import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a FREE price configuration (no payment required).
 */
export default class GetFreePriceConfig extends BaseCommand {
  static override description = "Builds a FREE price configuration (no payment required)."

  static override examples = [
    '$ nvm plans get-free-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getFreePriceConfig()

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
