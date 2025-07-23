import { AIQueryApi } from './api/query-api'
import { PaymentsError } from './common/payments.error'
import { PaymentOptions } from './common/types'
import { BasePaymentsAPI } from './api/base-payments'
import { PlansAPI } from './api/plans-api'
import { AgentsAPI } from './api/agents-api'
import { AgentRequestsAPI } from './api/requests-api'

/**
 * Main class that interacts with the Nevermined payments API.
 * Use `Payments.getInstance` for server-side usage or `Payments.getBrowserInstance` for browser usage.
 * @remarks This API requires a Nevermined API Key, which can be obtained by logging in to the Nevermined App.
 *
 * The library provides methods to manage AI Agents, Plans & process AI Agent Requests.
 *
 * Each of these functionalities is encapsulated in its own API class:
 * - `plans`: Manages AI Plans, including registration and ordering and retrieving plan details.
 * - `agents`: Handles AI Agents, including registration of AI Agents and access token generation.
 * - `requests`: Manages requests received by AI Agents, including validation and tracking.
 */
export class Payments extends BasePaymentsAPI {
  public query!: AIQueryApi
  public plans!: PlansAPI
  public agents!: AgentsAPI
  public requests!: AgentRequestsAPI

  /**
   * Get an instance of the Payments class for server-side usage.
   *
   * @param options - The options to initialize the payments class.
   * @example
   * ```
   * const payments = Payments.getInstance({1
   *   nvmApiKey: 'your-nvm-api-key',
   *   environment: 'testing'
   * })
   * ```
   * @returns An instance of {@link Payments}
   * @throws PaymentsError if nvmApiKey is missing.
   */
  static getInstance(options: PaymentOptions) {
    if (!options.nvmApiKey) {
      throw new PaymentsError('Nevermined API Key is required')
    }
    return new Payments(options, false)
  }

  /**
   * Get an instance of the Payments class for browser usage.
   *
   * @remarks
   * This is a browser-only function.
   *
   * @param options - The options to initialize the payments class.
   * @example
   * ```
   * const payments = Payments.getBrowserInstance({
   *   returnUrl: 'https://mysite.example',
   *   environment: 'testing',
   *   appId: 'my-app-id',
   *   version: '1.0.0'
   * })
   * ```
   * @returns An instance of {@link Payments}
   * @throws PaymentsError if returnUrl is missing.
   */
  static getBrowserInstance(options: PaymentOptions) {
    if (!options.returnUrl) {
      throw new PaymentsError('returnUrl is required')
    }
    const url = new URL(window.location.href)
    const urlNvmApiKey = url.searchParams.get('nvmApiKey') as string
    if (urlNvmApiKey) {
      url.searchParams.delete('nvmApiKey')
    }

    const urlAccountAddress = url.searchParams.get('accountAddress') as string
    if (urlAccountAddress) {
      url.searchParams.delete('accountAddress')
    }

    history.replaceState(history.state, '', url.toString())

    return new Payments(options, true)
  }

  /**
   * Initializes the Payments class.
   *
   * @param options - The options to initialize the payments class.
   * @param isBrowserInstance - Whether this instance is for browser usage.
   */
  private constructor(options: PaymentOptions, isBrowserInstance = true) {
    super(options)

    this.isBrowserInstance = isBrowserInstance
    this.initializeApi(options)
  }

  /**
   * Initializes the AI Query Protocol API.
   */
  private initializeApi(options: PaymentOptions) {
    this.plans = PlansAPI.getInstance(options)
    this.agents = AgentsAPI.getInstance(options)
    this.requests = AgentRequestsAPI.getInstance(options)
    this.query = AIQueryApi.getInstance()
  }

  /**
   * Initiates the connect flow. The user's browser will be redirected to
   * the Nevermined App login page.
   *
   * @remarks
   * This is a browser-only function.
   * @example
   * ```
   * payments.connect()
   * ```
   */
  public connect() {
    if (!this.isBrowserInstance) return
    const url = new URL(`/login?returnUrl=${this.returnUrl}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Logs out the user by removing the NVM API key.
   *
   * @remarks
   * This is a browser-only function.
   * @example
   * ```
   * payments.logout()
   * ```
   */
  public logout() {
    this.nvmApiKey = ''
  }

  /**
   * Checks if a user is logged in.
   * @example
   * ```
   * payments.isLoggedIn
   * ```
   * @returns True if the user is logged in.
   */
  get isLoggedIn(): boolean {
    return this.nvmApiKey.length > 0
  }
}
