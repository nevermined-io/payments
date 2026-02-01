import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * getMembers command
 */
export default class GetMembers extends BaseCommand {
  static override description = "OrganizationsAPI getMembers"

  static override examples = [
    '$ nvm organizations get-members'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'role': Flags.string({ required: false }),
    'is-active': Flags.string({ required: false }),
    'page': Flags.integer({ required: false }),
    'offset': Flags.integer({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.getMembers(flags['role'], flags['is-active'], flags['page'], flags['offset'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
