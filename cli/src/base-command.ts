import { Command, Flags } from '@oclif/core'
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { ConfigManager } from './utils/config-manager.js'
import { OutputFormatter, OutputFormat } from './utils/output-formatter.js'

export abstract class BaseCommand extends Command {
  static baseFlags = {
    profile: Flags.string({
      char: 'p',
      description: 'Configuration profile to use',
      required: false,
    }),
    format: Flags.string({
      char: 'f',
      description: 'Output format',
      options: ['table', 'json', 'quiet'],
      default: 'table',
    }),
    verbose: Flags.boolean({
      char: 'v',
      description: 'Verbose output',
      default: false,
    }),
  }

  protected configManager!: ConfigManager
  protected formatter!: OutputFormatter
  protected payments?: Payments

  async init(): Promise<void> {
    await super.init()
    this.configManager = ConfigManager.getInstance()

    const { flags } = await this.parse(this.ctor as any)
    this.formatter = new OutputFormatter((flags.format as OutputFormat) || 'table')
  }

  /**
   * Initialize Payments SDK instance with configuration
   */
  protected async initPayments(): Promise<Payments> {
    if (this.payments) {
      return this.payments
    }

    const { flags } = await this.parse(this.ctor as any)
    const profile = flags.profile as string | undefined

    // Try environment variables first
    let nvmApiKey = process.env.NVM_API_KEY
    let environment = process.env.NVM_ENVIRONMENT as EnvironmentName | undefined

    // Then try config file
    if (!nvmApiKey || !environment) {
      const config = await this.configManager.get(undefined, profile)
      if (config) {
        nvmApiKey = nvmApiKey || config.nvmApiKey
        environment = environment || config.environment
      }
    }

    if (!nvmApiKey) {
      this.error(
        'NVM API Key not found. Set NVM_API_KEY environment variable or run: nvm config init',
        { exit: 1 }
      )
    }

    if (!environment) {
      this.formatter.warning('Environment not set, using "staging_sandbox" as default')
      environment = 'staging_sandbox' as EnvironmentName
    }

    this.payments = Payments.getInstance({
      nvmApiKey,
      environment: environment as EnvironmentName,
    })

    return this.payments
  }

  /**
   * Handle errors consistently with helpful messages
   */
  protected handleError(error: any): void {
    if (!this.formatter) {
      console.error(error.message || 'An unexpected error occurred')
      this.exit(1)
      return
    }

    // Extract error message
    const errorMessage = error.message || 'An unexpected error occurred'

    // Provide helpful context based on error type
    if (errorMessage.includes('API Key') || errorMessage.includes('apiKey')) {
      this.formatter.error('API Key Error: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Run: nvm config init')
      this.formatter.info('   Or set: export NVM_API_KEY=your-key-here')
    } else if (errorMessage.includes('network') || errorMessage.includes('ECONNREFUSED')) {
      this.formatter.error('Network Error: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Check your internet connection')
      this.formatter.info('   Verify the environment is accessible')
    } else if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      this.formatter.error('Resource Not Found: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Verify the ID is correct')
      this.formatter.info('   Check you\'re using the right environment')
    } else if (errorMessage.includes('unauthorized') || errorMessage.includes('401')) {
      this.formatter.error('Authentication Error: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Your API key may be invalid or expired')
      this.formatter.info('   Run: nvm config init')
    } else if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
      this.formatter.error('Invalid JSON: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Check your JSON syntax')
      this.formatter.info('   Use a JSON validator: https://jsonlint.com')
    } else {
      this.formatter.error(errorMessage)
    }

    // Show stack trace in verbose mode
    const { flags } = this.parse(this.ctor as any) as any
    if (flags?.verbose && error.stack) {
      console.error('\n📋 Stack trace:')
      console.error(error.stack)
    }

    this.exit(1)
  }

  /**
   * Validate required flags
   */
  protected validateRequired(value: any, name: string): void {
    if (value === undefined || value === null || value === '') {
      this.error(`${name} is required`, { exit: 1 })
    }
  }

  /**
   * Show success message with optional next steps
   */
  protected showSuccess(message: string, nextSteps?: string[]): void {
    this.formatter.success(message)

    if (nextSteps && nextSteps.length > 0) {
      this.formatter.info('\n✨ Next steps:')
      nextSteps.forEach((step, index) => {
        this.formatter.info(`   ${index + 1}. ${step}`)
      })
    }
  }

  /**
   * Parse JSON input from string, file, or stdin
   */
  protected async parseJsonInput(input?: string): Promise<any> {
    if (!input) {
      return undefined
    }

    try {
      // If it looks like a file path, read it
      if (input.endsWith('.json')) {
        const fs = await import('fs/promises')
        const content = await fs.readFile(input, 'utf-8')
        return JSON.parse(content)
      }

      // Otherwise parse as JSON string
      return JSON.parse(input)
    } catch (error: any) {
      this.error(`Failed to parse JSON input: ${error.message}`, { exit: 1 })
    }
  }
}
