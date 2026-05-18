import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Lists events emitted into the activity feed of an organization the caller is an active member of (member invites, customer events, subscription transitions, webhook deliveries, …). Requires the caller to be a Member or Admin of `orgId`; the backend returns 403 otherwise. Premium+ entitlement is enforced server-side.
 */
export default class GetOrganizationActivity extends BaseCommand {
  static override description = "Lists events emitted into the activity feed of an organization the caller is an active member of (member invites, customer events, subscription transitions, webhook deliveries, …). Requires the caller to be a Member or Admin of `orgId`; the backend returns 403 otherwise. Premium+ entitlement is enforced server-side."

  static override examples = [
    '$ nvm organizations get-organization-activity <orgId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'filters': Flags.string({ required: false }),
  }

  static override args = {
    org: Args.string({
      description: "org identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.getOrganizationActivity(args.org, flags['filters'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
