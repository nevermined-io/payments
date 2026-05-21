import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Lists every organization the authenticated user is an active member of, with their role and the organization's tier. Powers workspace pickers in third-party tools built on the SDK, and the "where will this publish?" UX when a user belongs to multiple orgs.
 */
export default class GetMyMemberships extends BaseCommand {
  static override description = "Lists every organization the authenticated user is an active member of, with their role and the organization's tier. Powers workspace pickers in third-party tools built on the SDK, and the \"where will this publish?\" UX when a user belongs to multiple orgs."

  static override examples = [
    '$ nvm organizations get-my-memberships'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,

  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.getMyMemberships()

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
