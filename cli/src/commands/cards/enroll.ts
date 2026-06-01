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
 * Single-purpose card enrolment. Opens the chromeless
 * `/cards/enroll` page of the standalone embed app (`embed.<tier>`)
 * in the browser, completes the
 * tokenization step against the chosen provider, and redirects the
 * resulting `paymentMethodId` back to a localhost callback.
 *
 * For the common case of "add a card AND a delegation in one flow",
 * use `nvm cards setup` instead — the combined command emits both IDs
 * in a single callback.
 */
export default class CardsEnroll extends BaseCommand {
  static override description =
    'Open the browser to enroll a credit/debit card and redirect the resulting paymentMethodId back to this terminal.'

  static override examples = [
    '<%= config.bin %> cards enroll',
    '<%= config.bin %> cards enroll --org org-abc-123',
    '<%= config.bin %> cards enroll --provider braintree',
    '<%= config.bin %> cards enroll --no-browser',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    org: Flags.string({
      description:
        'Organization id to scope the flow to. Required when the authenticated user belongs to multiple organizations and the terminal is non-interactive.',
      required: false,
    }),
    'no-browser': Flags.boolean({
      description: 'Print the enrolment URL instead of opening the browser.',
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
      const { flags } = await this.parse(CardsEnroll)
      const payments = await this.initPayments()

      const { orgId } = await resolveOrgIdInteractive({
        payments,
        flagOrgId: flags.org,
        log: (msg: string) => this.log(msg),
      })

      const environment = this.resolvedEnvironment!
      const nvmApiKey = this.resolvedNvmApiKey!
      const env = Environments[environment]
      if (!env) {
        this.error(`Unknown environment: ${String(environment)}`, { exit: 1 })
      }

      const result = await runWidgetRedirectFlow({
        embedUrl: env.embed,
        embedPath: '/cards/enroll',
        network: resolveEmbedNetwork(environment),
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
        successPageTitle: 'Card enrolled',
        timeoutMessage: 'Card enrolment timed out after 5 minutes. Please try again.',
      })

      const paymentMethodId = result.query.paymentMethodId
      if (!paymentMethodId) {
        this.error('Enrolment callback was missing paymentMethodId.', { exit: 1 })
      }
      this.formatter.success(`Card enrolled. paymentMethodId: ${paymentMethodId}`)
      this.formatter.output({ paymentMethodId, orgId })
    } catch (error) {
      this.handleError(error)
    }
  }
}
