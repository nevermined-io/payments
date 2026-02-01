import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Create a new member in the organization
 */
export default class CreateMember extends BaseCommand {
  static override description = "Create a new member in the organization"

  static override examples = [
    '$ nvm organizations create-member <userId>'
  ]

  static override flags = {
    ...BaseCommand.baseFlags,
    'user-email': Flags.string({ required: false }),
    'user-role': Flags.string({ required: false }),
  }

  static override args = {
    user: Args.string({
      description: "user identifier",
      required: true,
    }),
  }


  public async run(): Promise<void> {
    const { flags, args } = await this.parse(this.ctor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.createMember(args.user, flags['user-email'], flags['user-role'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
