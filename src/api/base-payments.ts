import { jsonReplacer } from '../common/helper.js'
import { EnvironmentInfo, EnvironmentName, Environments } from '../environments.js'
import { PaymentOptions } from '../common/types.js'
import { PaymentsError } from '../common/payments.error.js'
import { decodeJwt } from 'jose'

/**
 * Base class extended by all Payments API classes.
 * It provides common functionality such as parsing the NVM API Key and getting the account address.
 */
export abstract class BasePaymentsAPI {
  protected nvmApiKey: string
  protected environment: EnvironmentInfo
  protected returnUrl: string
  protected appId?: string
  protected version?: string
  protected accountAddress?: string
  public isBrowserInstance = true

  constructor(options: PaymentOptions) {
    this.nvmApiKey = options.nvmApiKey
    this.returnUrl = options.returnUrl || ''
    this.environment = Environments[options.environment as EnvironmentName]
    this.appId = options.appId
    this.version = options.version
    this.parseNvmApiKey()
  }

  /**
   * Parses the NVM API Key to extract the account address.
   * @throws PaymentsError if the API key is invalid.
   */
  protected parseNvmApiKey() {
    try {
      if (!this.nvmApiKey) {
        throw new PaymentsError('NVM API Key is required')
      }
      const jwt = decodeJwt(this.nvmApiKey)
      this.accountAddress = jwt.sub
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
}
