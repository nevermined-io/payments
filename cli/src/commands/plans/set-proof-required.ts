import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Marks whether proof is required in a credits configuration.
 */
export default class SetProofRequired extends BaseCommand {
  static override description = "Marks whether proof is required in a credits configuration."

  static override examples = [
    '$ nvm plans set-proof-required'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-config': Flags.string({
      description: "creditsConfig as JSON string",
      required: true
    }),
    'proof-required': Flags.boolean({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.setProofRequired(await this.parseJsonInput(flags['credits-config']), flags['proof-required'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
