import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'
import type { X402TokenOptions } from '@nevermined-io/payments'
import { resolveScheme } from '@nevermined-io/payments'

/**
 * Create a delegation and get an X402 access token for the given plan.
 */
export default class GetX402AccessToken extends BaseCommand {
  static override description = "Create a delegation and get an X402 access token for the given plan. Supports both crypto (erc4337) and fiat (card-delegation) payment schemes."

  static override examples = [
    '$ nevermined x402token get-x402-access-token <planId>',
    '$ nevermined x402token get-x402-access-token <planId> --payment-type fiat',
    '$ nevermined x402token get-x402-access-token <planId> --payment-type fiat --payment-method-id pm_1AbCdEfGhIjKlM --spending-limit-cents 5000',
    '$ nevermined x402token get-x402-access-token <planId> --spending-limit-cents 100000 --delegation-duration-secs 604800',
    '$ nevermined x402token get-x402-access-token <planId> --auto-resolve-scheme',
    '$ nevermined x402token get-x402-access-token <planId> --resource-url /api/v1/tasks --http-verb POST --token-version 3',
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'agent-id': Flags.string({ required: false }),
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
      description: 'Max spending limit in cents (default: 1000)',
      default: 1000,
      required: false,
    }),
    'delegation-duration-secs': Flags.integer({
      description: 'Delegation duration in seconds (default: 3600)',
      default: 3600,
      required: false,
    }),
    'auto-resolve-scheme': Flags.boolean({
      description: 'Auto-detect crypto vs fiat from plan metadata (overrides --payment-type)',
      default: false,
      required: false,
    }),
    'resource-url': Flags.string({
      description: 'Protected resource, EXACTLY as the seller advertises it in its 402 (a paymentMiddleware seller advertises a relative path such as /ask). Signed into a v3 token, which then settles only against it; a mismatch fails verification with BCK.X402.0013.',
      required: false,
    }),
    'http-verb': Flags.string({
      description: 'HTTP verb of the protected resource (e.g. POST). Signed into a v3 token alongside --resource-url.',
      required: false,
    }),
    'token-version': Flags.integer({
      description: 'EIP-712 token version to request: 2 (default, reusable) or 3 (single-use, bound to --resource-url/--http-verb). A backend without v3 support silently returns 2 — check the tokenVersion field in the output.',
      min: 2,
      max: 3,
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
        } else {
          tokenOptions = this.buildCryptoTokenOptions(flags)
        }
      } else if (flags['payment-type'] === 'fiat') {
        tokenOptions = await this.buildFiatTokenOptions(payments, flags)
      } else {
        tokenOptions = this.buildCryptoTokenOptions(flags)
      }

      const result = await payments.x402.getX402AccessToken(
        args.plan,
        flags['agent-id'],
        tokenOptions,
      )

      // The printed tokenVersion is detected from the returned token, not echoed
      // from --token-version: a backend that predates v3 drops the request field
      // without an error and mints v2.

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }

  private buildCryptoTokenOptions(flags: any): X402TokenOptions {
    return {
      delegationConfig: {
        spendingLimitCents: flags['spending-limit-cents'],
        durationSecs: flags['delegation-duration-secs'],
      },
      ...this.buildTokenBinding(flags),
    }
  }

  /**
   * Resource/verb/version options shared by the crypto and fiat paths.
   *
   * Omitted rather than sent empty when the flag is absent: a field absent at
   * mint is signed as the empty string and must stay absent from the envelope,
   * so `--resource-url ''` and no flag at all must not produce different bodies.
   */
  private buildTokenBinding(flags: any): Partial<X402TokenOptions> {
    const resourceUrl = flags['resource-url']
    const httpVerb = flags['http-verb']
    const tokenVersion = flags['token-version']

    // The three flags are one set. A resource on a v2 token is not inert — the
    // backend compares it with the URL the seller advertises and rejects a
    // mismatch with BCK.X402.0013 — so binding without asking for v3 can only
    // cost the caller a failed verification. Refuse the combination instead of
    // minting a token that will not verify.
    if ((resourceUrl || httpVerb) && tokenVersion !== 3) {
      this.error(
        '--resource-url / --http-verb bind the token to one seller endpoint, which only ' +
          'takes effect with --token-version 3. Add --token-version 3, or drop the binding flags.',
        { exit: 1 },
      )
    }

    return {
      ...(resourceUrl && { resource: { url: resourceUrl } }),
      ...(httpVerb && { httpVerb: String(httpVerb).toUpperCase() }),
      ...(tokenVersion === 3 && { tokenVersion: 3 as const }),
    }
  }

  private async buildFiatTokenOptions(payments: any, flags: any): Promise<X402TokenOptions> {
    let paymentMethodId = flags['payment-method-id']

    if (!paymentMethodId) {
      const methods = await payments.delegation.listPaymentMethods()
      const card = methods?.find((m: any) => m.type === 'card')
      if (!card) {
        this.error('No enrolled card found. Please add a card at nevermined.app first.', { exit: 1 })
      }
      paymentMethodId = card.id
      console.error(`Auto-selected card: ${card.brand} ****${card.last4}`)
    }

    return {
      scheme: 'nvm:card-delegation',
      delegationConfig: {
        providerPaymentMethodId: paymentMethodId,
        spendingLimitCents: flags['spending-limit-cents'],
        durationSecs: flags['delegation-duration-secs'],
      },
      ...this.buildTokenBinding(flags),
    }
  }
}
