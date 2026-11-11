import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Builds a Fiat price configuration for a plan. `amount` is in **6-decimal units** (USDC convention, NOT cents). To charge $2.00, pass `2_000_000n`. Minimum is `1_000_000n` ($1.00) — lower values are rejected server-side with `BCK.PROTOCOL.0047`.
 */
export default class GetFiatPriceConfig extends BaseCommand {
  static override description = "Builds a Fiat price configuration for a plan. `amount` is in **6-decimal units** (USDC convention, NOT cents). To charge $2.00, pass `2_000_000n`. Minimum is `1_000_000n` ($1.00) — lower values are rejected server-side with `BCK.PROTOCOL.0047`."

  static override examples = [
    '$ nevermined plans get-fiat-price-config'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'amount': Flags.string({ required: true }),
    'receiver': Flags.string({ required: true }),
    'currency': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getFiatPriceConfig(flags['amount'], flags['receiver'], flags['currency'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
