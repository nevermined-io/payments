import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'
import type { X402TokenOptions } from '@nevermined-io/payments'
import { resolveScheme } from '@nevermined-io/payments'

/**
 * Create a permission and get an X402 access token for the given plan. This token allows the agent to verify and settle permissions on behalf of the subscriber. The token contains cryptographically signed session keys that delegate specific permissions (order, burn) to the agent.
 */
export default class GetX402AccessToken extends BaseCommand {
  static override description = "Create a permission and get an X402 access token for the given plan. This token allows the agent to verify and settle permissions on behalf of the subscriber. The token contains cryptographically signed session keys that delegate specific permissions (order, burn) to the agent."

  static override examples = [
    '$ nvm x402token get-x402-access-token <planId>',
    '$ nvm x402token get-x402-access-token <planId> --payment-type fiat',
    '$ nvm x402token get-x402-access-token <planId> --payment-type fiat --payment-method-id pm_1AbCdEfGhIjKlM --spending-limit-cents 5000',
    '$ nvm x402token get-x402-access-token <planId> --auto-resolve-scheme',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-id': Flags.string({ required: false }),
    'redemption-limit': Flags.string({ required: false }),
    'order-limit': Flags.string({ required: false }),
    'expiration': Flags.string({ required: false }),
    'payment-type': Flags.string({
      description: 'Payment type: "crypto" (default) or "fiat" (card-delegation)',
      options: ['crypto', 'fiat'],
      default: 'crypto',
      required: false,
    }),
    'payment-method-id': Flags.string({
      description: 'Stripe payment method ID (pm_...). Only for fiat. If omitted, auto-selects first enrolled card.',
      required: false,
    }),
    'spending-limit-cents': Flags.integer({
      description: 'Max spending limit in cents. Only for fiat. (default: 1000)',
      default: 1000,
      required: false,
    }),
    'delegation-duration-secs': Flags.integer({
      description: 'Delegation duration in seconds. Only for fiat. (default: 3600)',
      default: 3600,
      required: false,
    }),
    'auto-resolve-scheme': Flags.boolean({
      description: 'Auto-detect crypto vs fiat from plan metadata (overrides --payment-type)',
      default: false,
      required: false,
    }),
  }

  static override args = {
    plan: Args.string({
      description: "plan identifier",
      required: true,
    }),
  }

  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      let tokenOptions: X402TokenOptions | undefined

      if (flags['auto-resolve-scheme']) {
        const scheme = await resolveScheme(payments, args.plan)
        if (scheme === 'nvm:card-delegation') {
          tokenOptions = await this.buildFiatTokenOptions(payments, flags)
        }
        // If scheme is 'nvm:erc4337', tokenOptions stays undefined (crypto default)
      } else if (flags['payment-type'] === 'fiat') {
        tokenOptions = await this.buildFiatTokenOptions(payments, flags)
      }

      const result = await payments.x402.getX402AccessToken(
        args.plan,
        flags['agent-id'],
        flags['redemption-limit'],
        flags['order-limit'],
        flags['expiration'],
        tokenOptions,
      )

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }

  private async buildFiatTokenOptions(payments: any, flags: any): Promise<X402TokenOptions> {
    let paymentMethodId = flags['payment-method-id']

    if (!paymentMethodId) {
      const methods = await payments.delegation.listPaymentMethods()
      if (!methods || methods.length === 0) {
        this.error('No enrolled payment methods found. Please add a card at nevermined.app first.', { exit: 1 })
      }
      paymentMethodId = methods[0].id
      this.formatter.info(`Auto-selected payment method: ${methods[0].brand} ****${methods[0].last4}`)
    }

    return {
      scheme: 'nvm:card-delegation',
      delegationConfig: {
        providerPaymentMethodId: paymentMethodId,
        spendingLimitCents: flags['spending-limit-cents'],
        durationSecs: flags['delegation-duration-secs'],
      },
    }
  }
}
