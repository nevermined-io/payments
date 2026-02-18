import { decodeJwt } from 'jose'
import { jsonReplacer } from '../common/helper.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions, PaymentScheme } from '../common/types.js'
import { EnvironmentInfo, EnvironmentName, Environments } from '../environments.js'

/**
 * Base class extended by all Payments API classes.
 * It provides common functionality such as parsing the NVM API Key and getting the account address.
 */
export abstract class BasePaymentsAPI {
  protected nvmApiKey: string
  protected scheme: PaymentScheme
  protected environment: EnvironmentInfo
  protected environmentName: EnvironmentName
  protected returnUrl: string
  protected appId?: string
  protected version?: string
  protected accountAddress: string
  protected heliconeApiKey: string
  public isBrowserInstance = true

  constructor(options: PaymentOptions) {
    this.nvmApiKey = options.nvmApiKey
    this.scheme = options.scheme || 'nvm'
    this.returnUrl = options.returnUrl || ''
    this.environment = Environments[options.environment as EnvironmentName]
    this.environmentName = options.environment
    this.appId = options.appId
    this.version = options.version

    if (this.scheme === 'visa') {
      // Visa scheme does not use JWT-based NVM API keys
      this.accountAddress = ''
      this.heliconeApiKey = ''
    } else {
      const { accountAddress, heliconeApiKey } = this.parseNvmApiKey()
      this.accountAddress = accountAddress
      this.heliconeApiKey = heliconeApiKey
    }
  }

  /**
   * Parses the NVM API Key to extract the account address.
   * @throws PaymentsError if the API key is invalid.
   */
  protected parseNvmApiKey(): { accountAddress: string; heliconeApiKey: string } {
    try {
      if (!this.nvmApiKey) {
        throw new PaymentsError('NVM API Key is required')
      }
      const jwt = decodeJwt(this.nvmApiKey)
      const accountAddress = jwt.sub as string
      const heliconeApiKey = jwt.o11y as string
      return { accountAddress, heliconeApiKey }
    } catch (error) {
      throw new PaymentsError('Invalid NVM API Key')
    }
  }

  /**
   * It returns the account address associated with the NVM API Key used to initialize the Payments Library instance.
   * @returns The account address extracted from the NVM API Key
   */
  public getAccountAddress(): string | undefined {
    return this.accountAddress
  }

  /**
   * Returns the HTTP options required to query the backend.
   * @param method - HTTP method.
   * @param body - Optional request body.
   * @returns HTTP options object.
   * @internal
   */
  protected getBackendHTTPOptions(method: string, body?: any) {
    return {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      ...(body && { body: JSON.stringify(body, jsonReplacer) }),
    }
  }

  /**
   * Get HTTP options for public backend requests (no authorization header).
   * Converts body keys from snake_case to camelCase for consistency.
   *
   * @param method - HTTP method
   * @param body - Optional request body (keys will be converted to camelCase)
   * @returns HTTP options object
   * @internal
   */
  protected getPublicHTTPOptions(method: string, body?: any) {
    const options: {
      method: string
      headers: {
        Accept: string
        'Content-Type': string
      }
      body?: string
    } = {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    if (body) {
      options.body = JSON.stringify(body, jsonReplacer)
    }

    return options
  }
}
