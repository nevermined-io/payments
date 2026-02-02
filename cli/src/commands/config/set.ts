import { Args } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

export default class ConfigSet extends BaseCommand {
  static description = 'Set a configuration value'

  static examples = [
    '<%= config.bin %> <%= command.id %> nvmApiKey nvm-xxx',
    '<%= config.bin %> <%= command.id %> environment sandbox',
    '<%= config.bin %> <%= command.id %> nvmApiKey nvm-yyy --profile production',
  ]

  static flags = {
    ...BaseCommand.baseFlags,
  }

  static args = {
    key: Args.string({
      description: 'Configuration key (nvmApiKey, environment)',
      required: true,
      options: ['nvmApiKey', 'environment'],
    }),
    value: Args.string({
      description: 'Configuration value',
      required: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ConfigSet)

    try {
      const profileName = flags.profile

      // Validate environment value
      if (args.key === 'environment') {
        const validEnvironments = ['staging_sandbox', 'staging_live', 'sandbox', 'live']
        if (!validEnvironments.includes(args.value)) {
          this.error(
            `Invalid environment. Must be one of: ${validEnvironments.join(', ')}`,
            { exit: 1 }
          )
        }
      }

      await this.configManager.set(args.key, args.value, profileName)

      const profile = profileName || (await this.configManager.getActiveProfile())
      this.formatter.success(`Set ${args.key} = ${args.value} for profile "${profile}"`)
    } catch (error: any) {
      this.handleError(error)
    }
  }
}
