import { Flags } from '@oclif/core'
import { Environments } from '@nevermined-io/payments'
import { BaseCommand } from '../../base-command.js'
import { resolveOrgIdInteractive } from '../../utils/orgs.js'
import {
  mintSelfWidgetSession,
  runWidgetRedirectFlow,
} from '../../utils/widget-redirect-flow.js'

/**
 * Single-purpose delegation creation. Opens the chromeless
 * `/embed/cards/delegate?paymentMethodId=<id>` page where the user
 * fills in spending limit / duration / max-transactions and submits;
 * the resulting `delegationId` is redirected back to a localhost
 * callback.
 *
 * The combined `nvm cards setup` flow is preferred for first-time
 * card setup; use this when the card already exists and only the
 * delegation needs to be (re-)created.
 */
export default class CardsDelegate extends BaseCommand {
  static override description =
    'Open the browser to create a spending delegation for an already-enrolled card.'

  static override examples = [
    '<%= config.bin %> cards delegate --card pm_1234',
    '<%= config.bin %> cards delegate --card pm_1234 --org org-abc-123',
    '<%= config.bin %> cards delegate --card pm_1234 --no-browser',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    card: Flags.string({
      description: 'paymentMethodId of the already-enrolled card to delegate from.',
      required: true,
    }),
    org: Flags.string({
      description:
        'Organization id to scope the flow to. Required when the authenticated user belongs to multiple organizations and the terminal is non-interactive.',
      required: false,
    }),
    'no-browser': Flags.boolean({
      description: 'Print the delegation URL instead of opening the browser.',
      default: false,
    }),
  }

  public async run(): Promise<void> {
    try {
      const { flags } = await this.parse(CardsDelegate)
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
        frontendUrl: env.frontend,
        embedPath: '/embed/cards/delegate',
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
        extraSearchParams: { paymentMethodId: flags.card as string },
        noBrowser: flags['no-browser'],
        log: (msg: string) => this.log(msg),
        successPageTitle: 'Delegation created',
        timeoutMessage: 'Delegation creation timed out after 5 minutes. Please try again.',
      })

      const delegationId = result.query.delegationId
      if (!delegationId) {
        this.error('Delegation callback was missing delegationId.', { exit: 1 })
      }
      this.formatter.success(`Delegation created. delegationId: ${delegationId}`)
      this.formatter.output({ delegationId, paymentMethodId: flags.card, orgId })
    } catch (error) {
      this.handleError(error)
    }
  }
}
