import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Mints expirable credits for a given Payment Plan and transfers them to a receiver.
 */
export default class MintPlanExpirable extends BaseCommand {
  static override description = "Mints expirable credits for a given Payment Plan and transfers them to a receiver."

  static override examples = [
    '$ nvm plans mint-plan-expirable <planId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-amount': Flags.string({ required: true }),
    'credits-receiver': Flags.string({
      description: "creditsReceiver as JSON string",
      required: true
    }),
    'credits-duration': Flags.string({ required: false }),
  }

  static override args = {
    plan: Args.string({
      description: "plan identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.mintPlanExpirable(args.plan, flags['credits-amount'], await this.parseJsonInput(flags['credits-receiver']), flags['credits-duration'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
