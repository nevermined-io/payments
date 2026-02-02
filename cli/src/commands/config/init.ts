import { Flags } from '@oclif/core'
import inquirer from 'inquirer'
import { BaseCommand } from '../../base-command.js'

export default class ConfigInit extends BaseCommand {
  static description = 'Initialize CLI configuration'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --profile production',
  ]

  static flags = {
    ...BaseCommand.baseFlags,
    'api-key': Flags.string({
      description: 'Nevermined API key',
      required: false,
    }),
    environment: Flags.string({
      description: 'Environment to use',
      options: ['staging_sandbox', 'staging_live', 'sandbox', 'live', 'custom'],
      required: false,
    }),
    interactive: Flags.boolean({
      char: 'i',
      description: 'Interactive mode',
      default: true,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ConfigInit)

    try {
      let nvmApiKey = flags['api-key']
      let environment = flags.environment
      const profileName = flags.profile || 'default'

      // Interactive mode
      if (flags.interactive && (!nvmApiKey || !environment)) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'nvmApiKey',
            message: 'Enter your Nevermined API key:',
            default: nvmApiKey,
            validate: (input) => (input ? true : 'API key is required'),
            when: !nvmApiKey,
          },
          {
            type: 'list',
            name: 'environment',
            message: 'Select environment:',
            choices: [
              { name: 'Staging Sandbox (recommended for testing)', value: 'staging_sandbox' },
              { name: 'Staging Live', value: 'staging_live' },
              { name: 'Sandbox', value: 'sandbox' },
              { name: 'Live (production)', value: 'live' },
            ],
            default: environment || 'staging_sandbox',
            when: !environment,
          },
        ])

        nvmApiKey = nvmApiKey || answers.nvmApiKey
        environment = environment || answers.environment
      }

      if (!nvmApiKey || !environment) {
        this.error('API key and environment are required', { exit: 1 })
      }

      // Save configuration
      await this.configManager.set('nvmApiKey', nvmApiKey, profileName)
      await this.configManager.set('environment', environment, profileName)
      await this.configManager.setActiveProfile(profileName)

      this.formatter.success(
        `Configuration initialized for profile "${profileName}"\n` +
          `  Config file: ${this.configManager.getDefaultConfigPath()}\n` +
          `  Environment: ${environment}`
      )

      this.formatter.info('You can now use the CLI with: nvm plans list')
    } catch (error: any) {
      this.handleError(error)
    }
  }
}
