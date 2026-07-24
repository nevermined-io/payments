import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Onboard a **white-label customer** into the organization (#2418). Provisions a Nevermined account for `email` under the caller's organization without consuming a member seat, and returns a usable, scoped NVM API key the org can use to transparently act on the customer's behalf (purchase plans / redeem credits). The customer is recorded in the org's Customers list. If the email already belongs to an account the org does NOT own, no key is issued: an email challenge is sent to the owner and the result carries `consentRequired: true`. Call again once the owner has consented to complete onboarding.
 */
export default class OnboardCustomer extends BaseCommand {
  static override description = "Onboard a **white-label customer** into the organization (#2418). Provisions a Nevermined account for `email` under the caller's organization without consuming a member seat, and returns a usable, scoped NVM API key the org can use to transparently act on the customer's behalf (purchase plans / redeem credits). The customer is recorded in the org's Customers list. If the email already belongs to an account the org does NOT own, no key is issued: an email challenge is sent to the owner and the result carries `consentRequired: true`. Call again once the owner has consented to complete onboarding."

  static override examples = [
    '$ nevermined organizations onboard-customer'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'email': Flags.string({ required: true }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.onboardCustomer(flags['email'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
