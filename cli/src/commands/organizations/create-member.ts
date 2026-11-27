import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

/**
 * Invite a member to the organization
 */
export default class CreateMember extends BaseCommand {
  static override description = "Invite a member to the organization"

  static override examples = [
    '$ nevermined organizations create-member <userId> --user-email colleague@example.com',
    '$ nevermined organizations create-member <userId> --user-email colleague@example.com --user-role Admin'
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
    const { flags, args } = await this.parse(this.constructor as any)

    const payments = await this.initPayments()

    try {
      const result = await payments.organizations.createMember(args.user, flags['user-email'], flags['user-role'])

      this.formatter.output(result)
    } catch (error) {
      this.handleError(error)
    }
  }
}
