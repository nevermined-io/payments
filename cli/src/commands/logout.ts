import { Flags } from '@oclif/core'
import { BaseCommand } from '../base-command.js'

export default class Logout extends BaseCommand {
  static description = 'Log out by removing the API key from your CLI configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --profile production',
  ]

  static flags = {
    ...BaseCommand.baseFlags,
    'all-profiles': Flags.boolean({
      description: 'Remove API keys from all profiles',
      default: false,
    }),
  }

  async run(): Promise<void> {
    try {
      const { flags } = await this.parse(Logout)
      const profileName = flags.profile || await this.configManager.getActiveProfile()

      if (flags['all-profiles']) {
        const profiles = await this.configManager.listProfiles()
        if (profiles.length === 0) {
          this.formatter.warning('No profiles found. Nothing to log out.')
          return
        }
        for (const name of profiles) {
          await this.configManager.remove('nvmApiKey', name)
        }
        this.formatter.success(
          `Logged out of all profiles (${profiles.join(', ')})\n` +
            `  Config file: ${this.configManager.getDefaultConfigPath()}`
        )
      } else {
        const existing = await this.configManager.get('nvmApiKey', profileName)
        if (!existing) {
          this.formatter.warning(`Profile "${profileName}" has no API key configured.`)
          return
        }

        await this.configManager.remove('nvmApiKey', profileName)
        this.formatter.success(
          `Logged out of profile "${profileName}"\n` +
            `  Config file: ${this.configManager.getDefaultConfigPath()}`
        )
      }

      this.formatter.info('\nTo authenticate again, run: nvm login')
    } catch (error) {
      this.handleError(error)
    }
  }
}
