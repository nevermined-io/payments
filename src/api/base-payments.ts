import { jsonReplacer } from '../common/helper'
import { EnvironmentInfo, Environments } from '../environments'
import { PaymentOptions } from '../common/types'
import { decodeJwt } from 'jose'
import { PaymentsError } from '../common/payments.error'

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
    this.environment = Environments[options.environment]
    this.appId = options.appId
    this.version = options.version
  }

  public getAccountAddress(): string | undefined {
    return this.accountAddress
  }

  /**
   * Parses the NVM API Key to extract the account address.
   * @throws PaymentsError if the API key is invalid.
   */
  protected parseNvmApiKey() {
    try {
      const jwt = decodeJwt(this.nvmApiKey!)
      this.accountAddress = jwt.sub
    } catch (error) {
      throw new PaymentsError('Invalid NVM API Key')
    }
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
