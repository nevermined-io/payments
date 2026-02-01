import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * getPlans command
 */
export default class GetPlans extends BaseCommand {
  static override description = "PlansAPI getPlans"

  static override examples = [
    '$ nvm plans get-plans'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'page': Flags.integer({ required: false }),
    'offset': Flags.integer({ required: false }),
    'sort-by': Flags.string({ required: false }),
    'sort-order': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getPlans(flags['page'], flags['offset'], flags['sort-by'], flags['sort-order'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
