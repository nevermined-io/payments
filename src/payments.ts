import { decodeJwt } from 'jose'
import { AIQueryApi } from './api/query-api'
import { jsonReplacer } from './common/helper'
import { PaymentsError } from './common/payments.error'
import {
  PaymentOptions,
  PlanPriceConfig,
  PlanCreditsConfig,
  PlanCreditsType,
  AgentMetadata,
  AgentAPIAttributes,
} from './common/types'
import { EnvironmentInfo, Environments } from './environments'
import { getRandomBigInt, isEthereumAddress } from './utils'
import {
  API_URL_ADD_PLAN_AGENT,
  API_URL_BURN_PLAN,
  API_URL_GET_AGENT,
  API_URL_GET_PLAN,
  API_URL_MINT_EXPIRABLE_PLAN,
  API_URL_MINT_PLAN,
  API_URL_ORDER_PLAN,
  API_URL_PLAN_BALANCE,
  API_URL_REGISTER_AGENT,
  API_URL_REGISTER_PLAN,
  API_URL_REMOVE_PLAN_AGENT,
  API_URL_SEARCH_AGENTS,
} from './api/nvm-api'

/**
 * Main class that interacts with the Nevermined payments API.
 * To get an instance of this class use the `getInstance` method.
 */
export class Payments {
  public query!: AIQueryApi
  public returnUrl: string
  public environment: EnvironmentInfo
  public appId?: string
  public version?: string
  public accountAddress?: string
  private nvmApiKey?: string
  public isBrowserInstance = true

  /**
   * The options get's an instance of the payments class.
   *
   * @param options - The options to initialize the payments class.
   *
   * @example
   * ```
   * const payments = Payments.getInstance({
   *   nvmApiKey: 'kjdfaofakdoasdkoas',
   *   environment: 'testing'
   * })
   * ```
   *
   * @returns An instance of {@link Payments}
   */
  static getInstance(options: PaymentOptions) {
    if (!options.nvmApiKey) {
      throw new PaymentsError('nvmApiKey is required')
    }
    return new Payments(options, false)
  }

  /**
   * The options get's an instance of the payments class to be used in the browser.
   *
   * @remarks
   *
   * This is a browser only function.
   *
   * @param options - The options to initialize the payments class.
   *
   * @example
   * ```
   * const payments = Payments.getBrowserInstance({
   *   returnUrl: 'https://mysite.example',
   *   environment: 'testing',
   *   appId: 'my-app-id',
   *   version: '1.0.0'
   * })
   * ```
   *
   * @returns An instance of {@link Payments}
   */
  static getBrowserInstance(options: PaymentOptions) {
    if (!options.returnUrl) {
      throw new PaymentsError('nvmApiKey is required')
    }
    return new Payments(options, true)
  }

  /**
   * Initialize the payments class.
   *
   * @param options - The options to initialize the payments class.
   *
   * @returns An instance of {@link Payments}
   */
  private constructor(options: PaymentOptions, isBrowserInstance = true) {
    this.nvmApiKey = options.nvmApiKey
    this.returnUrl = options.returnUrl || ''
    this.environment = Environments[options.environment]
    this.appId = options.appId
    this.version = options.version
    this.isBrowserInstance = isBrowserInstance
    if (!this.isBrowserInstance) {
      this.parseNvmApiKey()
      this.initializeApi()
    }
  }

  /**
   * It parses the NVM API Key to get the account address.
   */
  private parseNvmApiKey() {
    try {
      const jwt = decodeJwt(this.nvmApiKey!)
      this.accountAddress = jwt.iss
    } catch (error) {
      throw new PaymentsError('Invalid NVM API Key')
    }
  }

  /**
   * Initializes the AI Query Protocol API.
   */
  private initializeApi() {
    this.query = new AIQueryApi({
      backendHost: this.environment.backend,
      apiKey: this.nvmApiKey!,
      proxyHost: this.environment.proxy,
    })
  }

  /**
   * Initiate the connect flow. The user's browser will be redirected to
   * the Nevermined App login page.
   *
   * @remarks
   *
   * This is a browser only function.
   *
   * @example
   * ```
   * payments.connect()
   * ```
   */
  public connect() {
    if (!this.isBrowserInstance) return
    const url = new URL(
      `/en/login?nvm-export=nvm-api-key&returnUrl=${this.returnUrl}`,
      this.environment.frontend,
    )
    window.location.href = url.toString()
  }

  /**
   * Method to initialize the class once the user has been logged in.
   * This method should be called has soon as the user has been redirected
   * back to the app ({@link returnUrl}).
   *
   * @remarks
   *
   * This is a browser only function.
   *
   * @example
   * ```
   * payments.init()
   * ```
   *
   * @example Using react
   *
   * You may want to use `useEffect` on the route that matches the passed
   * {@link returnUrl}
   *
   * ```
   * useEffect(() => {
   *   payments.init()
   * })
   * ```
   */
  public init() {
    if (!this.isBrowserInstance) return
    const url = new URL(window.location.href)
    const nvmApiKey = url.searchParams.get('nvmApiKey') as string

    if (nvmApiKey) {
      this.nvmApiKey = nvmApiKey as string
      url.searchParams.delete('nvmApiKey')
    }

    const accountAddress = url.searchParams.get('accountAddress') as string

    if (accountAddress) {
      this.accountAddress = accountAddress
      url.searchParams.delete('accountAddress')
    }

    history.replaceState(history.state, '', url.toString())
    this.initializeApi()
    this.parseNvmApiKey()
  }

  /**
   * Logout the user by removing the nvm api key.
   *
   * @remarks
   *
   * This is a browser only function.
   *
   * @example
   * ```
   * payments.logout()
   * ```
   */
  public logout() {
    this.nvmApiKey = undefined
  }

  /**
   * Property to check if a user logged in.
   *
   * @example
   * ```
   * payments.isLoggedIn
   * ```
   *
   * @returns True if the user is logged in.
   */
  get isLoggedIn(): boolean {
    return !!this.nvmApiKey
  }

  /**
   *
   * It allows to an AI Builder to create a Payment Plan on Nevermined in a flexible manner.
   * A Nevermined Credits Plan limits the access by the access/usage of the Plan.
   * With them, AI Builders control the number of requests that can be made to an agent or service.
   * Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits.
   * When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const creditsConfig = getFixedCreditsConfig(100n)
   *  const { planId } = await payments.registerCreditsPlan(cryptoPriceConfig, creditsConfig)
   * ```
   *
   * @returns The unique identifier of the plan (Plan DID) of the newly created plan.
   */
  public async registerPlan(
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
    nonce = getRandomBigInt(),
  ): Promise<{ planId: string }> {
    const body = {
      priceConfig,
      creditsConfig,
      nonce,
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_PLAN, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * It allows to an AI Builder to create a Payment Plan on Nevermined based on Credits.
   * A Nevermined Credits Plan limits the access by the access/usage of the Plan.
   * With them, AI Builders control the number of requests that can be made to an agent or service.
   * Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits.
   * When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const creditsConfig = getFixedCreditsConfig(100n)
   *  const { planId } = await payments.registerCreditsPlan(cryptoPriceConfig, creditsConfig)
   * ```
   *
   * @returns The unique identifier of the plan (Plan DID) of the newly created plan.
   */
  public async registerCreditsPlan(
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ planId: string }> {
    if (
      creditsConfig.creditsType != PlanCreditsType.FIXED &&
      creditsConfig.creditsType != PlanCreditsType.DYNAMIC
    )
      throw new PaymentsError('The creditsConfig.creditsType must be FIXED or DYNAMIC')

    if (creditsConfig.minAmount > creditsConfig.maxAmount)
      throw new PaymentsError(
        'The creditsConfig.minAmount can not be more than creditsConfig.maxAmount',
      )

    return this.registerPlan(priceConfig, creditsConfig)
  }

  /**
   *
   * It allows to an AI Builder to create a Payment Plan on Nevermined limited by duration.
   * A Nevermined Credits Plan limits the access by the access/usage of the Plan.
   * With them, AI Builders control the number of requests that can be made to an agent or service.
   * Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits.
   * When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const 1dayCreditsPlan = getExpirableCreditsConfig(86400n)
   *  const { planId } = await payments.registerCreditsPlan(cryptoPriceConfig, 1dayCreditsPlan)
   * ```
   *
   * @returns The unique identifier of the plan (Plan DID) of the newly created plan.
   */
  public async registerTimePlan(
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ planId: string }> {
    if (creditsConfig.creditsType != PlanCreditsType.EXPIRABLE)
      throw new PaymentsError('The creditsConfig.creditsType must be EXPIRABLE')

    return this.registerPlan(priceConfig, creditsConfig)
  }

  /**
   *
   * It registers a new AI Agent on Nevermined.
   * The agent must be associated to one or multiple Payment Plans. Users that are subscribers of a payment plan can access the agent.
   * Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
   *
   * @param agentMetadata - @see {@link AgentMetadata}
   * @param agentApi - @see {@link AgentAPIAttributes}
   * @param paymentPlans - the list of payment plans giving access to the agent.
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
   *  const agentApi { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/(.*)/tasks' }] }
   *  const paymentPlans = [planId]
   *
   *  const { did } = await payments.registerAgent(agentMetadata, agentApi, paymentPlans)
   * ```
   *
   * @returns The unique identifier of the newly created agent (Agent DID).
   */
  public async registerAgent(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    paymentPlans: string[],
  ): Promise<{ did: string }> {

    const body = {
      metadataAttributes: agentMetadata, 
      agentApiAttributes: agentApi,
      plans: paymentPlans,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_AGENT, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * It registers a new AI Agent and a Payment Plan associated to this new agent.
   * Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
   *
   * @param agentMetadata - @see {@link AgentMetadata}
   * @param agentApi - @see {@link AgentAPIAttributes}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
   *  const agentApi { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/(.*)/tasks' }] }
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const 1dayCreditsPlan = getExpirableCreditsConfig(86400n)
   *  const { did, planId } = await payments.registerAgentAndPlan(
   *    agentMetadata,
   *    agentApi,
   *    cryptoPriceConfig,
   *    1dayCreditsPlan
   *  )
   * ```
   *
   * @returns The unique identifier of the newly created agent (Agent DID).
   * @returns The unique identifier of the newly created plan (planId).
   */
  public async registerAgentAndPlan(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ did: string; planId: string }> {
    const { planId } = await this.registerPlan(priceConfig, creditsConfig)
    const { did } = await this.registerAgent(agentMetadata, agentApi, [planId])

    return { did, planId }
  }

  /**
   * Get the Metadata (aka Decentralized Document or DDO) for a given Agent identifier (DID).
   *
   * @param did - The unique identifier (aka DID) of the agent .
   * @returns A promise that resolves to the DDO.
   */
  public async getAgent(did: string) {
    const url = new URL(API_URL_GET_AGENT.replace(':did', did), this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Get the information about a Payment Plan giving it's plan identifier (planId).
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves to the description of the plan.
   */
  public async getPlan(planId: string) {
    const url = new URL(API_URL_GET_PLAN.replace(':planId', planId), this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Get the balance of an account for a Payment Plan.
   *
   * @param planId - The identifier of the Payment Plan
   * @param accountAddress - The address of the account to get the balance.
   * @returns A promise that resolves to the balance result.
   */
  public async getPlanBalance(
    planId: string,
    accountAddress?: string,
  ): Promise<{
    // subscriptionType: string
    // isOwner: boolean
    balance: bigint
    // isSubscriptor: boolean
  }> {
    const holderAddress = isEthereumAddress(accountAddress) ? accountAddress : this.accountAddress
    const balanceUrl = API_URL_PLAN_BALANCE.replace(':planId', planId).replace(
      ':holderAddress',
      holderAddress!,
    )

    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }
    const url = new URL(balanceUrl, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Orders a Payment Plan. The user needs to have enough balance in the token selected by the owner of the Payment Plan.
   *
   * @remarks
   * The payment is done using Crypto. Payments using Fiat can be done via the Nevermined App.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves indicating if the operation was successful.
   */
  public async orderPlan(planId: string): Promise<{ success: boolean }> {
    const options = this.getBackendHTTPOptions('POST')
    const url = new URL(API_URL_ORDER_PLAN.replace(':planId', planId), this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  // /**
  //  * Get array of services/agent DIDs associated with a payment plan.
  //  *
  //  * @param planDID - The DID of the Payment Plan.
  //  * @returns A promise that resolves to the array of services/agents DIDs.
  //  */
  // public async getPlanAssociatedServices(planDID: string) {
  //   const url = new URL(
  //     `/api/v1/payments/subscription/services/${planDID}`,
  //     this.environment.backend,
  //   )
  //   const response = await fetch(url)
  //   if (!response.ok) {
  //     throw Error(`${response.statusText} - ${await response.text()}`)
  //   }
  //   return response.json()
  // }

  /**
   * Mint credits for a given Payment Plan and transfer them to a receiver.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param creditsAmount - The number of credits to mint.
   * @param creditsReceiver - The address of the receiver where the credits will be transferred.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async mintPlanCredits(planId: string, creditsAmount: bigint, creditsReceiver: string) {
    const body = { planId, amount: creditsAmount, creditsReceiver }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_MINT_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Mint credits for a given Payment Plan and transfer them to a receiver.
   * The credits minted will expire after a given duration (in seconds).
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param creditsAmount - The number of credits to mint.
   * @param creditsReceiver - The address of the receiver where the credits will be transferred.
   * @param creditsDuration - The duration of the credits in seconds. Default is 0 (no expiration).
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
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
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Burn credits for a given Payment Plan.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planId - The DID (Decentralized Identifier) of the asset.
   * @param creditsAmountToBurn - The amount of credits to burn.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async burnCredits(planId: string, creditsAmountToBurn: string) {
    const body = { planId, creditsAmountToBurn }
    const options = this.getBackendHTTPOptions('DELETE', body)
    const url = new URL(API_URL_BURN_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Adds an existing Payment Plan to an AI Agent.
   * After this operation, users having access to the Payment Plan will be able to access the AI Agent.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentDid - The unique identifier of the AI Agent.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async addPlanToAgent(planId: string, agentDid: string) {
    const options = this.getBackendHTTPOptions('POST')
    const endpoint = API_URL_ADD_PLAN_AGENT.replace(':planId', planId).replace(':did', agentDid)
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Removes a Payment Plan from an AI Agent.
   * After this operation, users having access to the Payment Plan will not longer be able to access the AI Agent.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentDid - The unique identifier of the AI Agent.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async removePlanFromAgent(planId: string, agentDid: string) {
    const options = this.getBackendHTTPOptions('DELETE')
    const endpoint = API_URL_REMOVE_PLAN_AGENT.replace(':planId', planId).replace(':did', agentDid)
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * Search for AI Agents based on a text query.
   *
   * @example
   * ```
   * const agents = await payments.searchAgents({ text: 'test' })
   * ```
   *
   * @param text - The text query to search for Payment Plans.
   * @param page - The page number for pagination.
   * @param offset - The number of items per page.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   *
   */
  public async searchAgents({
    text,
    page = 1,
    offset = 10,
  }: {
    text: string
    page?: number
    offset?: number
  }) {
    const body = { text: text, page: page, offset: offset }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_SEARCH_AGENTS, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  // It returns the HTTP options required to be sent to query the agent
  // getAgentQueryOptions(agentId)
  // public async searchPaymentPlans

  private getBackendHTTPOptions(method: string, body?: any) {
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
