import { Flags } from '@oclif/core'
import { Environments, EnvironmentName } from '@nevermined-io/payments'
import { BaseCommand } from '../../base-command.js'
import { resolveOrgIdInteractive } from '../../utils/orgs.js'
import {
  mintSelfWidgetSession,
  runWidgetRedirectFlow,
} from '../../utils/widget-redirect-flow.js'

/**
 * Combined "set up a card for agent spend" flow. Opens the user's
 * browser at the chromeless `/embed/cards/setup` page, where they
 * enrol a card and create a spending delegation in one session, and
 * receives `paymentMethodId` + `delegationId` back at a localhost
 * callback the CLI starts for the duration of the flow.
 *
 * Mirrors the `nvm login` UX: ephemeral HTTP server on a random port,
 * URL printed (or browser opened), 5-minute timeout, single-use
 * `state` echo for CSRF binding. The user must already be authenticated
 * (`nvm login`) and must be a member of at least one organisation —
 * the widgets feature is organisation-scoped (see issue #1671).
 */
export default class CardsSetup extends BaseCommand {
  static override description =
    'Open the browser to enroll a card and create a spending delegation, then redirect both IDs back to this terminal.'

  static override examples = [
    '<%= config.bin %> cards setup',
    '<%= config.bin %> cards setup --org org-abc-123',
    '<%= config.bin %> cards setup --no-browser',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    org: Flags.string({
      description:
        'Organization id to scope the flow to. Required when the authenticated user belongs to multiple organizations and the terminal is non-interactive.',
      required: false,
    }),
    'no-browser': Flags.boolean({
      description: 'Print the setup URL instead of opening the browser.',
      default: false,
    }),
    provider: Flags.string({
      description: 'Tokenization provider used for the card enrolment step.',
      options: ['stripe', 'braintree', 'visa'],
      default: 'stripe',
    }),
  }

  public async run(): Promise<void> {
    try {
      const { flags } = await this.parse(CardsSetup)
      const payments = await this.initPayments()

      // Resolve which org the session should be scoped to. Throws (and
      // we fall through to handleError) on the no-membership / multi-org
      // non-interactive paths.
      const { orgId, orgName } = await resolveOrgIdInteractive({
        payments,
        flagOrgId: flags.org,
        log: (msg: string) => this.log(msg),
      })
      if (orgName) {
        this.formatter.info(`Using organization: ${orgName} (${orgId})`)
      } else {
        this.formatter.info(`Using organization: ${orgId}`)
      }

      // Read the environment + key from local config (the Payments
      // instance keeps them as protected fields). `initPayments()` in the
      // base command has already validated them — these reads are safe.
      const profileName = flags.profile || (await this.configManager.getActiveProfile()) || 'default'
      const profileCfg = await this.configManager.get(undefined, profileName)
      const environment = (profileCfg?.environment as EnvironmentName) || 'sandbox'
      const env = Environments[environment]
      if (!env) {
        this.error(`Unknown environment: ${String(environment)}`, { exit: 1 })
      }
      const nvmApiKey = profileCfg?.nvmApiKey || process.env.NVM_API_KEY
      if (!nvmApiKey) {
        this.error('No NVM API key in the active profile. Run `nvm login` first.', { exit: 1 })
      }

      // Self-mint the widget session against the logged-in API key.
      // Backend gates this on `OrganizationsService.isOrganizationMember`
      // — a 403 here means either the flag-supplied orgId doesn't match
      // a membership or the user has none at all (already caught above
      // for the interactive path, but the membership check is the
      // ground truth).
      const session = await mintSelfWidgetSession({
        backendUrl: env.backend,
        nvmApiKey,
        orgId,
      })

      // Note: we pass `returnUrl` to `runWidgetRedirectFlow` later (the
      // helper builds it from the actual port it binds to). The session
      // we just minted didn't include a returnUrl in the body, so the
      // server returns `isReturnUrlAllowed: null`; the embed page's
      // own `/widgets/session/validate` call (with the
      // `X-Nvm-Widget-Return-Url` header) is the real allow-list check.

      const result = await runWidgetRedirectFlow({
        backendUrl: env.backend,
        frontendUrl: env.frontend,
        sessionToken: session.sessionToken,
        embedPath: '/embed/cards/setup',
        extraSearchParams: { provider: flags.provider as string },
        noBrowser: flags['no-browser'],
        log: (msg: string) => this.log(msg),
        successPageTitle: 'Card setup complete',
      })

      const paymentMethodId = result.query.paymentMethodId
      const delegationId = result.query.delegationId
      if (!paymentMethodId || !delegationId) {
        this.error(
          `Setup callback was missing required parameters (paymentMethodId=${paymentMethodId ?? 'missing'}, delegationId=${delegationId ?? 'missing'}).`,
          { exit: 1 },
        )
      }

      this.formatter.success(
        `Card setup complete!\n` +
          `  paymentMethodId: ${paymentMethodId}\n` +
          `  delegationId:    ${delegationId}\n` +
          `  organization:    ${orgId}`,
      )
      this.formatter.output({ paymentMethodId, delegationId, orgId })
    } catch (error) {
      this.handleError(error)
    }
  }
}
