import { Command, Flags } from '@oclif/core'
import { Payments, EnvironmentName } from '@nevermined-io/payments'
import { ConfigManager } from './utils/config-manager.js'
import { OutputFormatter, OutputFormat } from './utils/output-formatter.js'

const BIG_INT_FIELDS = new Set([
  'durationSecs', 'minAmount', 'maxAmount', 'amount', 'price', 'amountOfCredits',
])

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
  /**
   * Environment + API key resolved by `initPayments()`. Stored here so
   * subclasses that need to talk to the backend directly (e.g. commands
   * that POST to endpoints the SDK does not yet wrap) don't have to
   * re-implement the env-var-first → config-file fallback and
   * accidentally diverge from the precedence the Payments instance was
   * actually constructed with.
   */
  protected resolvedEnvironment?: EnvironmentName
  protected resolvedNvmApiKey?: string

  async init(): Promise<void> {
    await super.init()
    this.configManager = ConfigManager.getInstance()

    const { flags } = await this.parse(this.constructor as any)
    this.formatter = new OutputFormatter((flags.format as OutputFormat) || 'table')
  }

  /**
   * Initialize Payments SDK instance with configuration
   */
  protected async initPayments(): Promise<Payments> {
    if (this.payments) {
      return this.payments
    }

    const { flags } = await this.parse(this.constructor as any)
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
        'NVM API Key not found. Set NVM_API_KEY environment variable, run: nevermined login, or run: nevermined config init',
        { exit: 1 }
      )
    }

    if (!environment) {
      this.formatter.warning('Environment not set, using "sandbox" as default')
      environment = 'sandbox' as EnvironmentName
    }

    this.payments = Payments.getInstance({
      nvmApiKey,
      environment: environment as EnvironmentName,
    })
    // Expose for subclasses that need to talk to backend endpoints the
    // SDK does not yet wrap — see `nevermined cards setup/enroll/delegate`.
    this.resolvedEnvironment = environment as EnvironmentName
    this.resolvedNvmApiKey = nvmApiKey

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
      this.formatter.info('   Run: nevermined login (or nevermined config init)')
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
      this.formatter.info('   Run: nevermined login (or nevermined config init)')
    } else if (errorMessage.includes('JSON') || errorMessage.includes('parse')) {
      this.formatter.error('Invalid JSON: ' + errorMessage)
      this.formatter.info('\n💡 Helpful tip:')
      this.formatter.info('   Check your JSON syntax')
      this.formatter.info('   Use a JSON validator: https://jsonlint.com')
    } else {
      this.formatter.error(errorMessage)
    }

    // Show stack trace in verbose mode
    const { flags } = this.parse(this.constructor as any) as any
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
   * Convert integer payment fields without promoting an already-rounded Number
   * to BigInt. Large values must arrive as quoted decimal integers instead.
   */
  private parseBigIntValue(value: unknown, field: string): unknown {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new Error(
          `Field "${field}" must be a safe integer; use a quoted decimal string for exact large amounts.`,
        )
      }
      return BigInt(value)
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
      return BigInt(value)
    }
    return value
  }

  /** Convert known scalar integer fields and PlanPriceConfig.amounts entries. */
  private bigIntReviver(_key: string, value: any): any {
    if (BIG_INT_FIELDS.has(_key)) {
      return this.parseBigIntValue(value, _key)
    }
    if (_key === 'amounts' && Array.isArray(value)) {
      return value.map((amount, index) => this.parseBigIntValue(amount, `amounts[${index}]`))
    }
    return value
  }

  /** Whether a JSON number denotes an integer before floating-point rounding. */
  private isIntegerLiteral(source: string): boolean {
    const [coefficient, exponent = '0'] = source.toLowerCase().split('e')
    const digits = coefficient.replace(/[-.]/g, '')
    // Zero stays exact even with an exponent too large for Number to represent.
    if (!/[1-9]/.test(digits)) return true
    const fractionLength = coefficient.split('.')[1]?.length ?? 0
    const trailingZeros = digits.length - digits.replace(/0+$/, '').length
    return Number(exponent) >= fractionLength - trailingZeros
  }

  private parsePaymentJson(source: string): unknown {
    // Native parsing validates the grammar and rejects unsafe integer Numbers.
    const parsed = JSON.parse(source, this.bigIntReviver.bind(this))
    // Node 20 has no reviver context.source. Inspect tokens from the validated
    // JSON to catch fractional literals rounded to safe integers (or to zero).
    // Strings remain single tokens, so text containing JSON is never inspected.
    const tokens = source.match(
      /"(?:[^"\\]|\\[\s\S])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\]:,]|true|false|null/g,
    ) ?? []
    const stack: Array<{ kind: 'object' | 'array'; key?: string }> = []
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]
      const parent = stack.at(-1)
      if (token === '{') {
        stack.push({ kind: 'object' })
      } else if (token === '[') {
        stack.push({ kind: 'array', key: parent?.kind === 'object' ? parent.key : undefined })
      } else if (token === '}' || token === ']') {
        stack.pop()
      } else if (token.startsWith('"') && tokens[index + 1] === ':' && parent?.kind === 'object') {
        parent.key = JSON.parse(token)
      } else if (/^-?\d/.test(token)) {
        const field = parent?.key ?? ''
        const integerField = parent?.kind === 'object'
          ? BIG_INT_FIELDS.has(field)
          : parent?.kind === 'array' && field === 'amounts'
        if (integerField && !this.isIntegerLiteral(token)) {
          throw new Error(
            `Field "${field}" must contain an exact integer; use a quoted decimal string for exact amounts.`,
          )
        }
      }
    }
    return parsed
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
        return this.parsePaymentJson(content)
      }

      // Otherwise parse as JSON string
      return this.parsePaymentJson(input)
    } catch (error: any) {
      this.error(`Failed to parse JSON input: ${error.message}`, { exit: 1 })
    }
  }
}
