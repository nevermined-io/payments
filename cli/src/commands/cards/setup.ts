import { Flags } from '@oclif/core'
import { Environments } from '@nevermined-io/payments'
import { BaseCommand } from '../../base-command.js'
import { resolveOrgIdInteractive } from '../../utils/orgs.js'
import {
  mintSelfWidgetSession,
  resolveEmbedNetwork,
  runWidgetRedirectFlow,
} from '../../utils/widget-redirect-flow.js'

/**
 * Combined "set up a card for agent spend" flow. Opens the user's
 * browser at the chromeless `/cards/setup` page of the standalone embed
 * app (`embed.<tier>`), where they
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

      // initPayments() has already resolved env+key with the canonical
      // env-var-first precedence (NVM_API_KEY / NVM_ENVIRONMENT → config
      // file → defaults). Re-using its decision here keeps the SDK
      // instance and the direct `mintSelfWidgetSession` call targeting
      // the same backend + user.
      const environment = this.resolvedEnvironment!
      const nvmApiKey = this.resolvedNvmApiKey!
      const env = Environments[environment]
      if (!env) {
        this.error(`Unknown environment: ${String(environment)}`, { exit: 1 })
      }

      const result = await runWidgetRedirectFlow({
        embedUrl: env.embed,
        embedPath: '/cards/setup',
        network: resolveEmbedNetwork(environment),
        // Mint AFTER the local server binds — `runWidgetRedirectFlow`
        // gives us the actual returnUrl so the backend can validate it
        // at session-creation time (per the documented `isReturnUrlAllowed`
        // contract). A 403 here means either the flag-supplied orgId
        // doesn't match a membership or the user has none at all.
        mintSession: async ({ returnUrl }) => {
          const session = await mintSelfWidgetSession({
            backendUrl: env.backend,
            nvmApiKey,
            orgId,
            returnUrl,
          })
          if (session.isReturnUrlAllowed === false) {
            throw new Error(
              `Backend rejected returnUrl ${returnUrl} — check the widget key's allowedOrigins or fall back to a localhost callback.`,
            )
          }
          return { sessionToken: session.sessionToken }
        },
        extraSearchParams: { provider: flags.provider as string },
        noBrowser: flags['no-browser'],
        log: (msg: string) => this.log(msg),
        successPageTitle: 'Card setup complete',
        timeoutMessage: 'Card setup timed out after 5 minutes. Please try again.',
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
