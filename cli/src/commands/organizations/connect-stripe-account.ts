import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Connect user with Stripe
 */
export default class ConnectStripeAccount extends BaseCommand {
  static override description = "Connect user with Stripe"

  static override examples = [
    '$ nvm organizations connect-stripe-account'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'user-email': Flags.string({ required: true }),
    'user-country-code': Flags.string({ required: true }),
    'return-url': Flags.string({ required: true }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.connectStripeAccount(flags['user-email'], flags['user-country-code'], flags['return-url'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
