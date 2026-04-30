import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Marks whether burns of these credits are mirrored on-chain.
 */
export default class SetOnchainMirror extends BaseCommand {
  static override description = "Marks whether burns of these credits are mirrored on-chain."

  static override examples = [
    '$ nvm plans set-onchain-mirror'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'credits-config': Flags.string({
      description: "creditsConfig as JSON string",
      required: true
    }),
    'onchain-mirror': Flags.boolean({ required: false }),
  }



  public async run(): Promise<void> {
    const { flags } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.plans.setOnchainMirror(await this.parseJsonInput(flags['credits-config']), flags['onchain-mirror'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
