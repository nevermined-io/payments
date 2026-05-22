import { Flags } from '@oclif/core'
import { Environments, EnvironmentName } from '@nevermined-io/payments'
import { BaseCommand } from '../../base-command.js'
import { resolveOrgIdInteractive } from '../../utils/orgs.js'
import {
  mintSelfWidgetSession,
  runWidgetRedirectFlow,
} from '../../utils/widget-redirect-flow.js'

/**
 * Single-purpose card enrolment. Opens the chromeless
 * `/embed/cards/enroll` page in the browser, completes the
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
      const session = await mintSelfWidgetSession({
        backendUrl: env.backend,
        nvmApiKey,
        orgId,
      })

      const result = await runWidgetRedirectFlow({
        backendUrl: env.backend,
        frontendUrl: env.frontend,
        sessionToken: session.sessionToken,
        embedPath: '/embed/cards/enroll',
        extraSearchParams: { provider: flags.provider as string },
        noBrowser: flags['no-browser'],
        log: (msg: string) => this.log(msg),
        successPageTitle: 'Card enrolled',
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
