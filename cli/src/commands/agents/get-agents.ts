import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Lists the AI agents **you** published (the authenticated caller's own agents). This is account management, not a marketplace search — it never returns other users' agents.
 */
export default class GetAgents extends BaseCommand {
  static override description = "Lists the AI agents **you** published (the authenticated caller's own agents). This is account management, not a marketplace search — it never returns other users' agents."

  static override examples = [
    '$ nevermined agents get-agents <orgId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'page': Flags.integer({ required: false }),
    'offset': Flags.integer({ required: false }),
    'sort-by': Flags.string({ required: false }),
    'sort-order': Flags.string({ required: false }),
    'org-id': Flags.string({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.agents.getAgents(flags['page'], flags['offset'], flags['sort-by'], flags['sort-order'], flags['org-id'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
