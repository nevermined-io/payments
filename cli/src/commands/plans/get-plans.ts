import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * getPlans command
 */
export default class GetPlans extends BaseCommand {
  static override description = "Get the list of payment plans"

  static override examples = [
    '$ nvm plans get-plans',
    '$ nvm plans get-plans --page 1 --offset 10',
    '$ nvm plans get-plans -f json',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'page': Flags.integer({ required: false }),
    'offset': Flags.integer({ required: false }),
    'sort-by': Flags.string({ required: false }),
    'sort-order': Flags.string({ required: false }),
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.getPlans(flags['page'], flags['offset'], flags['sort-by'], flags['sort-order'])

      this.formatter.output(result, {
        columns: [
          { header: 'Name', key: 'metadata.main.name' },
          { header: 'Plan ID', key: 'id', formatter: (v: string) => v ? `${v.slice(0, 20)}...` : '' },
          { header: 'Owner', key: 'registry.owner', formatter: (v: string) => v ? `${v.slice(0, 10)}...${v.slice(-6)}` : '' },
          { header: 'Credits', key: 'registry.credits.amount' },
          { header: 'Listed', key: 'metadata.curation.isListed', formatter: (v: boolean) => v ? 'Yes' : 'No' },
          { header: 'Created', key: 'created', formatter: (v: string) => v ? v.split('T')[0] : '' },
        ],
        dataKey: 'plans',
        summary: { total: result.total, page: result.page, offset: result.offset },
      })
    } catch (error) {
      this.handleError(error)
    }
  }
}
