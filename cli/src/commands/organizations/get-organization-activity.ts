import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Lists events emitted into the activity feed of an organization the caller is an
 * active member of (member invites, customer events, subscription transitions,
 * webhook deliveries, …). Requires the caller to be a Member or Admin of `orgId`;
 * the backend returns 403 otherwise. Premium+ entitlement is enforced server-side.
 */
export default class GetOrganizationActivity extends BaseCommand {
  static override description =
    'List activity events for an organization (member, customer, subscription, and webhook events). Filters accept a JSON object with eventType / actorUserId / from / to / page / offset, or a path to a JSON file.'

  static override examples = [
    '$ nvm organizations get-organization-activity org-abc123',
    '$ nvm organizations get-organization-activity org-abc123 --filters \'{"eventType":"MEMBER_INVITED","page":1,"offset":25}\'',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    filters: Flags.string({
      required: false,
      description:
        'OrganizationActivityFilters as a JSON object (or path to a JSON file). Supports eventType, actorUserId, from, to, page, offset.',
    }),
  }

  static override args = {
    org: Args.string({
      description: 'org identifier',
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const filters = flags['filters']
        ? await this.parseJsonInput(flags['filters'])
        : undefined

      const result = await payments.organizations.getOrganizationActivity(
        args.org,
        filters,
      )

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
