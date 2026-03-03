import { BaseCommand } from '../../base-command.js'

/**
 * List enrolled credit/debit cards available for card-delegation (fiat) payments.
 */
export default class ListPaymentMethods extends BaseCommand {
  static override description = 'List enrolled credit/debit cards available for card-delegation (fiat) payments.'

  static override examples = [
    '$ nvm delegation list-payment-methods',
    '$ nvm delegation list-payment-methods --format json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
  }

  public async run(): Promise<void> {
    await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const methods = await payments.delegation.listPaymentMethods()
      this.formatter.output(methods)
    } catch (error) {
      this.handleError(error)
    }
  }
}
