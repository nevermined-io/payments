import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base-command.js'

export default class ConfigShow extends BaseCommand {
  static description = 'Display current configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --profile production',
    '<%= config.bin %> <%= command.id %> --all',
  ]

  static flags = {
    ...BaseCommand.baseFlags,
    all: Flags.boolean({
      char: 'a',
      description: 'Show all profiles',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigShow)

    try {
      const config = await this.configManager.load()

      if (!config) {
        this.formatter.warning('No configuration found. Run: nvm config init')
        return
      }

      if (flags.all) {
        // Show all profiles
        this.formatter.output(config)
      } else {
        // Show active profile
        const profileName = flags.profile || config.activeProfile
        const profileConfig = config.profiles[profileName]

        if (!profileConfig) {
          this.error(`Profile "${profileName}" not found`, { exit: 1 })
        }

        const output = {
          profile: profileName,
          active: profileName === config.activeProfile,
          ...profileConfig,
        }

        this.formatter.output(output)
      }

      if (flags.format === 'table') {
        this.formatter.info(`Config file: ${this.configManager.getDefaultConfigPath()}`)
      }
    } catch (error: any) {
      this.handleError(error)
    }
  }
}
