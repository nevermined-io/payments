import { AIQueryApi } from './api/query-api'
import { PaymentsError } from './common/payments.error'
import { decodeAccessToken } from './utils'
import {
  PaymentOptions,
  AgentAccessParams,
  ValidationAgentRequest,
  TrackAgentSubTaskResponseDto,
  TrackAgentSubTaskDto,
  NvmAPIResult,
  StripeCheckoutResult,
} from './common/types'
import {
  API_URL_ADD_PLAN_AGENT,
  API_URL_BURN_PLAN,
  API_URL_GET_AGENT_ACCESS_TOKEN,
  API_URL_MINT_EXPIRABLE_PLAN,
  API_URL_MINT_PLAN,
  API_URL_ORDER_PLAN,
  API_URL_REMOVE_PLAN_AGENT,
  API_URL_STRIPE_CHECKOUT,
  API_URL_TRACK_AGENT_SUB_TASK,
  API_URL_INITIALIZE_AGENT,
  API_URL_VALIDATE_AGENT_ACCESS_TOKEN,
} from './api/nvm-api'
import * as a2aModule from './a2a'
import type { PaymentsA2AServerOptions, PaymentsA2AServerResult } from './a2a/server'
import { BasePaymentsAPI } from './api/base-payments'
import { PlansAPI } from './api/plans-api'
import { AgentsAPI } from './api/agents-api'

/**
 * Main class that interacts with the Nevermined payments API.
 * Use `Payments.getInstance` for server-side usage or `Payments.getBrowserInstance` for browser usage.
 * @remarks This API requires a Nevermined API Key, which can be obtained by logging in to the Nevermined App.
 */
export class Payments extends BasePaymentsAPI {
  public query!: AIQueryApi
  public plans!: PlansAPI
  public agents!: AgentsAPI

  /**
   * Exposes A2A agent/server functionality for this Payments instance.
   * @example
   * ```
   * payments.a2a.start({ agentCard, executor, port, ... })
   * ```
   */
  public readonly a2a: {
    /**
     * Starts the A2A server using this Payments instance for payment logic.
     * @param options - All PaymentsA2AServerOptions except 'paymentsService'.
     * @returns Server result containing app, server, adapter, and handler instances.
     */
    start: (options: Omit<PaymentsA2AServerOptions, 'paymentsService'>) => PaymentsA2AServerResult
  }

  /**
   * Get an instance of the Payments class for server-side usage.
   *
   * @param options - The options to initialize the payments class.
   * @example
   * ```
   * const payments = Payments.getInstance({
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
    this.parseNvmApiKey()
    this.initializeApi(options)
    // ---
    // Attach the a2a server API to this instance
    this.a2a = {
      start: (options) => {
        return a2aModule.PaymentsA2AServer.start({
          ...options,
          paymentsService: this,
        })
      },
    }
    // ---
  }

  /**
   * Initializes the AI Query Protocol API.
   */
  private initializeApi(options: PaymentOptions) {
    this.plans = PlansAPI.getInstance(options)
    this.agents = AgentsAPI.getInstance(options)

    this.query = new AIQueryApi({
      backendHost: this.environment.backend,
      apiKey: this.nvmApiKey!,
      proxyHost: this.environment.proxy,
    })
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

  /**
   * Orders a Payment Plan requiring the payment in crypto. The user must have enough balance in the selected token.
   *
   * @remarks
   * The payment is done using crypto in the token (ERC20 or native) defined in the plan.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if unable to order the plan.
   */
  public async orderPlan(planId: string): Promise<NvmAPIResult> {
    const options = this.getBackendHTTPOptions('POST')
    const url = new URL(API_URL_ORDER_PLAN.replace(':planId', planId), this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to order plan. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Initiates the purchase of a Plan requiring the payment in Fiat. This method will return a URL where the user can complete the payment.
   *
   * @remarks
   * The payment is completed using a credit card in a external website (Stripe).
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves indicating the URL to complete the payment.
   * @throws PaymentsError if unable to order the plan.
   */
  public async orderFiatPlan(planId: string): Promise<{ result: StripeCheckoutResult }> {
    const body = {
      sessionType: 'embedded',
      planId,
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_STRIPE_CHECKOUT, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to order fiat plan. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Mints credits for a given Payment Plan and transfers them to a receiver.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param creditsAmount - The number of credits to mint.
   * @param creditsReceiver - The address of the receiver.
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to mint credits.
   */
  public async mintPlanCredits(planId: string, creditsAmount: bigint, creditsReceiver: string) {
    const body = { planId, amount: creditsAmount, creditsReceiver }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_MINT_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to mint plan credits. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Mints expirable credits for a given Payment Plan and transfers them to a receiver.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param creditsAmount - The number of credits to mint.
   * @param creditsReceiver - The address of the receiver.
   * @param creditsDuration - The duration of the credits in seconds. Default is 0 (no expiration).
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to mint expirable credits.
   */
  public async mintPlanExpirable(
    planId: string,
    creditsAmount: bigint,
    creditsReceiver: string,
    creditsDuration = 0n,
  ) {
    const body = { planId, amount: creditsAmount, creditsReceiver, duration: creditsDuration }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_MINT_EXPIRABLE_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to mint expirable credits. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Burns credits for a given Payment Plan.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param creditsAmountToRedeem - The amount of credits to redeem.
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to burn credits.
   */
  public async redeemCredits(planId: string, creditsAmountToRedeem: string) {
    const body = { planId, creditsAmountToBurn: creditsAmountToRedeem }
    const options = this.getBackendHTTPOptions('DELETE', body)
    const url = new URL(API_URL_BURN_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to burn credits. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Adds an existing Payment Plan to an AI Agent.
   * After this operation, users with access to the Payment Plan will be able to access the AI Agent.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentId - The unique identifier of the AI Agent.
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to add the plan to the agent.
   */
  public async addPlanToAgent(planId: string, agentId: string) {
    const options = this.getBackendHTTPOptions('POST')
    const endpoint = API_URL_ADD_PLAN_AGENT.replace(':planId', planId).replace(':agentId', agentId)
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to add plan to agent. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Removes a Payment Plan from an AI Agent.
   * After this operation, users with access to the Payment Plan will no longer be able to access the AI Agent.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentId - The unique identifier of the AI Agent.
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to remove the plan from the agent.
   */
  public async removePlanFromAgent(planId: string, agentId: string) {
    const options = this.getBackendHTTPOptions('DELETE')
    const endpoint = API_URL_REMOVE_PLAN_AGENT.replace(':planId', planId).replace(
      ':agentId',
      agentId,
    )
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to remove plan from agent. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * When the user calling this method is a valid subscriber, it generates an access token related to the Payment Plan and the AI Agent.
   * The access token can be used to query the AI Agent's API endpoints. The access token is unique for the subscriber, payment plan and agent.
   *
   * @remarks
   * Only a valid subscriber of the Payment Plan can generate a valid access token.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentId - The unique identifier of the AI Agent.
   * @returns
   * @throws PaymentsError if unable to remove the plan from the agent.
   */
  public async getAgentAccessToken(planId: string, agentId: string): Promise<AgentAccessParams> {
    const accessTokenUrl = API_URL_GET_AGENT_ACCESS_TOKEN.replace(':planId', planId).replace(
      ':agentId',
      agentId!,
    )
    const options = this.getBackendHTTPOptions('GET')

    const url = new URL(accessTokenUrl, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to get agent access token. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * This method initializes an agent request.
   *
   * @remarks
   * This method is used to initialize an agent request.
   *
   * @param agentId - The unique identifier of the AI Agent.
   * @param accessToken - The access token provided by the subscriber to validate
   * @param urlRequested - The URL requested by the subscriber to access the agent's API.
   * @param httpMethodRequested - The HTTP method requested by the subscriber to access the agent's API.
   * @returns The information about the initialization of the request.
   * @throws PaymentsError if unable to initialize the agent request.
   */
  public async startProcessingRequest(
    agentId: string,
    accessToken: string | undefined,
    urlRequested: string,
    httpMethodRequested: string,
  ): Promise<ValidationAgentRequest> {
    const initializeAgentUrl = API_URL_INITIALIZE_AGENT.replace(':agentId', agentId!)
    const body = {
      accessToken,
      endpoint: urlRequested,
      httpVerb: httpMethodRequested,
    }
    const options = this.getBackendHTTPOptions('POST', body)

    const url = new URL(initializeAgentUrl, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to validate access token. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * This method validates if the access token given by a user is valid for a specific agent and plan.
   * This is useful to be integrated in the AI Agent's API to authorize the access to the agent's API endpoints.
   *
   * @remarks
   * This method is especially useful to be integrated in the AI Agent's API to authorize the access to the agent's API endpoints.
   * @remarks
   * The access token is generated by subscriber the {@link getAgentAccessToken} method.
   *
   * @param agentId - The unique identifier of the AI Agent.
   * @param accessToken - The access token provided by the subscriber to validate
   * @param urlRequested - The URL requested by the subscriber to access the agent's API.
   * @param httpMethodRequested - The HTTP method requested by the subscriber to access the agent's API.
   * @returns The information about the validation of the request.
   * @throws PaymentsError if unable to validate the access token.
   */
  public async isValidRequest(
    agentId: string,
    accessToken: string | undefined,
    urlRequested: string,
    httpMethodRequested: string,
  ): Promise<ValidationAgentRequest> {
    const validateTokenUrl = API_URL_VALIDATE_AGENT_ACCESS_TOKEN.replace(':agentId', agentId!)
    const body = {
      accessToken,
      endpoint: urlRequested,
      httpVerb: httpMethodRequested,
    }
    const options = this.getBackendHTTPOptions('POST', body)

    const url = new URL(validateTokenUrl, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to validate access token. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Allows the agent to redeem credits from a request.
   *
   * @param requestAccessToken - The access token of the request.
   * @param creditsToBurn - The number of credits to burn.
   * @returns A promise that resolves to the server response.
   * @throws PaymentsError if unable to redeem credits from the request.
   */
  public async redeemCreditsFromRequest(requestAccessToken: string, creditsToBurn: bigint) {
    // Decode the access token to get the wallet address and plan ID
    const decodedToken = decodeAccessToken(requestAccessToken)
    if (!decodedToken) {
      throw new PaymentsError('Invalid access token provided')
    }

    // Extract wallet address and plan ID from the token
    const walletAddress = decodedToken.authToken?.sub || decodedToken.sub
    const planId = decodedToken.authToken?.planId || decodedToken.planId

    if (!walletAddress || !planId) {
      throw new PaymentsError('Missing wallet address or plan ID in access token')
    }

    const body = {
      planId: BigInt(planId),
      redeemFrom: walletAddress,
      amount: creditsToBurn,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_BURN_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      const responseText = await response.text()
      throw new PaymentsError(
        `Unable to redeem credits from request. ${response.status} ${response.statusText} - ${responseText}`,
      )
    }

    return response.json()
  }

  /**
   * Tracks an agent sub task.
   *
   * @remarks
   * This method is used by agent owners to track agent sub tasks for agent tasks.
   * It records information about credit redemption, categorization tags, and processing descriptions.
   *
   * @param trackAgentSubTask - The agent sub task data to track
   * @returns A promise that resolves to the tracking response
   * @throws PaymentsError if unable to track the agent sub task
   *
   * @example
   * ```typescript
   * await payments.trackAgentSubTask({
   *   agentRequestId: 'atx-12345',
   *   creditsToRedeem: 5,
   *   tag: 'high-priority',
   *   description: 'Processing high-priority data request',
   *   status: AgentTaskStatus.SUCCESS
   * })
   * ```
   */
  public async trackAgentSubTask(
    trackAgentSubTask: TrackAgentSubTaskDto,
  ): Promise<TrackAgentSubTaskResponseDto> {
    const body = {
      agentRequestId: trackAgentSubTask.agentRequestId,
      creditsToRedeem: trackAgentSubTask.creditsToRedeem || 0,
      tag: trackAgentSubTask.tag,
      description: trackAgentSubTask.description,
      status: trackAgentSubTask.status,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_TRACK_AGENT_SUB_TASK, this.environment.backend)
    const response = await fetch(url, options)

    if (!response.ok) {
      throw new PaymentsError(
        `Unable to track agent sub task. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }
}
