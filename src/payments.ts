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
  PlanBalance,
  PlanMetadata,
  AgentAccessParams,
  ValidationAgentRequest,
  PaginationOptions,
  TrackAgentTaskResponseDto,
  TrackAgentTaskDto,
  AgentTaskStatus,
  TrackAgentSubTaskResponseDto,
  TrackAgentSubTaskDto,
} from './common/types'
import { EnvironmentInfo, Environments } from './environments'
import { getRandomBigInt, isEthereumAddress } from './utils'
import {
  API_URL_ADD_PLAN_AGENT,
  API_URL_BURN_PLAN,
  API_URL_GET_AGENT,
  API_URL_GET_AGENT_ACCESS_TOKEN,
  API_URL_GET_AGENT_PLANS,
  API_URL_GET_PLAN,
  API_URL_GET_PLAN_AGENTS,
  API_URL_MINT_EXPIRABLE_PLAN,
  API_URL_MINT_PLAN,
  API_URL_ORDER_PLAN,
  API_URL_PLAN_BALANCE,
  API_URL_REGISTER_AGENT,
  API_URL_REGISTER_PLAN,
  API_URL_REMOVE_PLAN_AGENT,
  API_URL_TRACK_AGENT_SUB_TASK,
  API_URL_TRACK_AGENT_TASK,
  API_URL_VALIDATE_AGENT_ACCESS_TOKEN,
} from './api/nvm-api'

/**
 * Main class that interacts with the Nevermined payments API.
 * Use `Payments.getInstance` for server-side usage or `Payments.getBrowserInstance` for browser usage.
 * @remarks This API requires a Nevermined API Key, which can be obtained by logging in to the Nevermined App.
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
      throw new PaymentsError('nvmApiKey is required')
    }
    return new Payments(options, true)
  }

  /**
   * Initializes the Payments class.
   *
   * @param options - The options to initialize the payments class.
   * @param isBrowserInstance - Whether this instance is for browser usage.
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
   * Parses the NVM API Key to extract the account address.
   * @throws PaymentsError if the API key is invalid.
   */
  private parseNvmApiKey() {
    try {
      const jwt = decodeJwt(this.nvmApiKey!)
      this.accountAddress = jwt.sub
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
    const url = new URL(
      `/en/login?nvm-export=nvm-api-key&returnUrl=${this.returnUrl}`,
      this.environment.frontend,
    )
    window.location.href = url.toString()
  }

  /**
   * Initializes the class after the user has logged in and been redirected
   * back to the app ({@link returnUrl}).
   *
   * @remarks
   * This is a browser-only function.
   * @example
   * ```
   * payments.init()
   * ```
   * @example Using React
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
    this.nvmApiKey = undefined
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
    return !!this.nvmApiKey
  }

  /**
   *
   * It allows to an AI Builder to register a Payment Plan on Nevermined in a flexible manner.
   * A Payment Plan defines 2 main aspects:
   *   1. What a subscriber needs to pay to get the plan (i.e. 100 USDC, 5 USD, etc).
   *   2. What the subscriber gets in return to access the AI agents associated to the plan (i.e. 100 credits, 1 week of usage, etc).
   *
   * With Payment Plans, AI Builders control the usage to their AI Agents.
   *
   * Every time a user accesses an AI Agent to the Payment Plan, the usage consumes from a capped amount of credits (or when the plan duration expires).
   * When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
   *
   * @remarks
   * This method is oriented to AI Builders.
   * The NVM API Key must have publication permissions.
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   * @param nonce - Optional nonce to prevent replay attacks. Default is a random BigInt.
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const creditsConfig = getFixedCreditsConfig(100n)
   *  const { planId } = await payments.registerPlan({ name: 'AI Assistants Plan'}, cryptoPriceConfig, creditsConfig)
   * ```
   *
   * @returns The unique identifier of the plan (Plan ID) of the newly created plan.
   */
  public async registerPlan(
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
    nonce = getRandomBigInt(),
  ): Promise<{ planId: string }> {
    const body = {
      metadataAttributes: planMetadata,
      priceConfig,
      creditsConfig,
      nonce,
      isTrialPlan: planMetadata.isTrialPlan || false,
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
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const creditsConfig = getFixedCreditsConfig(100n)
   *  const { planId } = await payments.registerCreditsPlan({ name: 'AI Credits Plan'}, cryptoPriceConfig, creditsConfig)
   * ```
   *
   * @returns The unique identifier of the plan (Plan ID) of the newly created plan.
   */
  public async registerCreditsPlan(
    planMetadata: PlanMetadata,
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

    return this.registerPlan(planMetadata, priceConfig, creditsConfig)
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
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const 1dayDurationPlan = getExpirableDurationConfig(ONE_DAY_DURATION)
   *  const { planId } = await payments.registerTimePlan({ name: 'Just for today plan'}, cryptoPriceConfig, 1dayDurationPlan)
   * ```
   *
   * @returns The unique identifier of the plan (Plan ID) of the newly created plan.
   */
  public async registerTimePlan(
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ planId: string }> {
    if (creditsConfig.creditsType != PlanCreditsType.EXPIRABLE)
      throw new PaymentsError('The creditsConfig.creditsType must be EXPIRABLE')

    return this.registerPlan(planMetadata, priceConfig, creditsConfig)
  }

  /**
   *
   * It allows to an AI Builder to create a Trial Payment Plan on Nevermined limited by duration.
   * A Nevermined Trial Plan allow subscribers of that plan to test the Agents associated to it.
   * A Trial plan is a plan that only can be purchased once by a user.
   * Trial plans, as regular plans, can be limited by duration (i.e 1 week of usage) or by credits (i.e 100 credits to use the agent).
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const freePriceConfig = getFreePriceConfig()
   *  const 1dayDurationPlan = getExpirableDurationConfig(ONE_DAY_DURATION)
   *  const { planId } = await payments.registerCreditsTrialPlan({name: 'Trial plan'}, freePriceConfig, 1dayDurationPlan)
   * ```
   *
   * @returns The unique identifier of the plan (Plan ID) of the newly created plan.
   */
  public async registerCreditsTrialPlan(
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ planId: string }> {
    planMetadata.isTrialPlan = true
    return this.registerCreditsPlan(planMetadata, priceConfig, creditsConfig)
  }

  /**
   *
   * It allows to an AI Builder to create a Trial Payment Plan on Nevermined limited by duration.
   * A Nevermined Trial Plan allow subscribers of that plan to test the Agents associated to it.
   * A Trial plan is a plan that only can be purchased once by a user.
   * Trial plans, as regular plans, can be limited by duration (i.e 1 week of usage) or by credits (i.e 100 credits to use the agent).
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const freePriceConfig = getFreePriceConfig()
   *  const 1dayDurationPlan = getExpirableDurationConfig(ONE_DAY_DURATION)
   *  const { planId } = await payments.registerTimeTrialPlan({name: '1 day Trial plan'}, freePriceConfig, 1dayDurationPlan)
   * ```
   *
   * @returns The unique identifier of the plan (Plan ID) of the newly created plan.
   */
  public async registerTimeTrialPlan(
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ planId: string }> {
    planMetadata.isTrialPlan = true
    return this.registerTimePlan(planMetadata, priceConfig, creditsConfig)
  }

  /**
   *
   * It registers a new AI Agent on Nevermined.
   * The agent must be associated to one or multiple Payment Plans. Users that are subscribers of a payment plan can query the agent.
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
   *  const agentApi = { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' }] }
   *  const paymentPlans = [planId]
   *
   *  const { agentId } = await payments.registerAgent(agentMetadata, agentApi, paymentPlans)
   * ```
   *
   * @returns The unique identifier of the newly created agent (Agent Id).
   */
  public async registerAgent(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    paymentPlans: string[],
  ): Promise<{ agentId: string }> {
    const body = {
      metadataAttributes: agentMetadata,
      agentApiAttributes: agentApi,
      plans: paymentPlans,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_AGENT, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to register agent. ${response.statusText} - ${await response.text()}`,
      )
    }
    const agentData = await response.json()
    return { agentId: agentData.agentId }
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
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
   *  const agentApi { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' }] }
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const 1dayDurationPlan = getExpirableDurationConfig(ONE_DAY_DURATION)
   *  const { agentId, planId } = await payments.registerAgentAndPlan(
   *    agentMetadata,
   *    agentApi,
   *    cryptoPriceConfig,
   *    1dayDurationPlan
   *  )
   * ```
   *
   * @returns The unique identifier of the newly created agent (agentId).
   * @returns The unique identifier of the newly created plan (planId).
   */
  public async registerAgentAndPlan(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
  ): Promise<{ agentId: string; planId: string }> {
    const { planId } = await this.registerPlan(planMetadata, priceConfig, creditsConfig)
    const { agentId } = await this.registerAgent(agentMetadata, agentApi, [planId])
    return { agentId, planId }
  }

  /**
   * Gets the metadata for a given Agent identifier.
   *
   * @param agentId - The unique identifier of the agent.
   * @returns A promise that resolves to the agent's metadata.
   * @throws PaymentsError if the agent is not found.
   */
  public async getAgent(agentId: string) {
    const url = new URL(API_URL_GET_AGENT.replace(':agentId', agentId), this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Agent not found. ${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Gets the list of plans that can be ordered to get access to an agent.
   *
   * @param agentId - The unique identifier of the agent.
   * @param pagination - Optional pagination options to control the number of results returned.p
   * @returns A promise that resolves to the list of all different plans giving access to the agent.
   * @throws PaymentsError if the agent is not found.
   */
  public async getAgentPlans(agentId: string, pagination = new PaginationOptions()) {
    const query =
      API_URL_GET_AGENT_PLANS.replace(':agentId', agentId) + '?' + pagination.asQueryParams()
    const url = new URL(query, this.environment.backend)
    console.log(`Fetching plans for agent ${agentId} from ${url.toString()}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Agent not found. ${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Gets the information about a Payment Plan by its identifier.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves to the plan's description.
   * @throws PaymentsError if the plan is not found.
   */
  public async getPlan(planId: string) {
    const query = API_URL_GET_PLAN.replace(':planId', planId)
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Plan not found. ${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Gets the list of Agents that have associated a specific Payment Plan.
   * All the agents returned can be accessed by the users that are subscribed to the Payment Plan.
   *
   * @param planId - The unique identifier of the plan.
   * @param pagination - Optional pagination options to control the number of results returned.
   * @returns A promise that resolves to the list of agents associated with the plan.
   * @throws PaymentsError if the plan is not found.
   */
  public async getAgentsAssociatedToAPlan(planId: string, pagination = new PaginationOptions()) {
    const query =
      API_URL_GET_PLAN_AGENTS.replace(':planId', planId) + '?' + pagination.asQueryParams()
    const url = new URL(query, this.environment.backend)
    console.log(`Fetching agents for plan ${planId} from ${url.toString()}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Plan not found. ${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Gets the balance of an account for a Payment Plan.
   *
   * @param planId - The identifier of the Payment Plan.
   * @param accountAddress - The address of the account to get the balance for.
   * @returns A promise that resolves to the balance result.
   * @throws PaymentsError if unable to get the balance.
   */
  public async getPlanBalance(planId: string, accountAddress?: string): Promise<PlanBalance> {
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
      throw new PaymentsError(
        `Unable to get balance. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Orders a Payment Plan. The user must have enough balance in the selected token.
   *
   * @remarks
   * The payment is done using crypto. Payments using fiat can be done via the Nevermined App.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if unable to order the plan.
   */
  public async orderPlan(planId: string): Promise<{ success: boolean }> {
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
   * Tracks an agent task for an agent.
   *
   * @remarks
   * This method is used by agent owners to track agent tasks when users interact with their agents.
   * It records usage metrics including credits consumed, HTTP methods used, and endpoints accessed.
   *
   * @param transactionData - The agent task data to track
   * @returns A promise that resolves to the tracking response
   * @throws PaymentsError if unable to track the transaction
   *
   * @example
   * ```typescript
   * await payments.trackAgentTask({
   *   agentId: 'did:nv:agent-12345',
   *   planId: 'did:nv:plan-67890',
   *   consumer: '0x1234567890123456789012345678901234567890',
   *   httpVerb: 'POST',
   *   endpoint: '/api/v1/chat',
   *   status: AgentTaskStatus.SUCCESS,
   *   totalCredits: 5
   * })
   * ```
   */
  public async trackAgentTask(
    transactionData: TrackAgentTaskDto,
  ): Promise<TrackAgentTaskResponseDto> {
    const body = {
      agentId: transactionData.agentId,
      planId: transactionData.planId,
      consumer: transactionData.consumer,
      httpVerb: transactionData.httpVerb,
      endpoint: transactionData.endpoint,
      status: transactionData.status || AgentTaskStatus.SUCCESS,
      totalCredits: transactionData.totalCredits,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_TRACK_AGENT_TASK, this.environment.backend)
    const response = await fetch(url, options)

    if (!response.ok) {
      throw new PaymentsError(
        `Unable to track access transaction. ${response.statusText} - ${await response.text()}`,
      )
    }

    return response.json()
  }

  /**
   * Tracks an access transaction for an agent using individual parameters.
   *
   * @remarks
   * This is a convenience method that wraps {@link trackTransaction} for easier usage.
   * It's especially useful when integrating access tracking directly into agent endpoints.
   *
   * @param agentId - The unique identifier of the agent
   * @param planId - The unique identifier of the plan
   * @param consumer - The address of the consumer accessing the agent
   * @param httpVerb - The HTTP verb used for the request
   * @param totalCredits - The total number of credits used in this transaction
   * @param endpoint - The endpoint that was accessed (optional)
   * @param status - The status of the access transaction (optional, defaults to SUCCESS)
   * @returns A promise that resolves to the tracking response
   * @throws PaymentsError if unable to track the transaction
   *
   * @example
   * ```typescript
   * await payments.trackAgentAccessEntry(
   *   'did:nv:agent-12345',
   *   'did:nv:plan-67890',
   *   '0x1234567890123456789012345678901234567890',
   *   'POST',
   *   5,
   *   '/api/v1/chat'
   * )
   * ```
   */
  public async trackAgentAccessEntry(
    agentId: string,
    planId: string,
    consumer: string,
    httpVerb: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    totalCredits: number,
    endpoint?: string,
    status: AgentTaskStatus = AgentTaskStatus.SUCCESS,
  ): Promise<TrackAgentTaskResponseDto> {
    return this.trackAgentTask({
      agentId,
      planId,
      consumer,
      httpVerb,
      endpoint,
      status,
      totalCredits,
    })
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
   *   description: 'Processing high-priority data request'
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

  /**
   * Tracks an agent sub task using individual parameters.
   *
   * @remarks
   * This is a convenience method that wraps {@link trackAgentSubTask} for easier usage.
   * It's especially useful when integrating agent sub task tracking directly into agent processing workflows.
   *
   * @param agentRequestId - The unique identifier of the access transaction
   * @param creditsToRedeem - The number of credits burned in this agent sub task (optional, defaults to 0)
   * @param tag - A tag to categorize this agent sub task (optional)
   * @param description - A description of this agent sub task (optional)
   * @returns A promise that resolves to the tracking response
   * @throws PaymentsError if unable to track the agent sub task
   *
   * @example
   * ```typescript
   * await payments.trackAgentSubTaskEntry(
   *   'atx-12345',
   *   5,
   *   'high-priority',
   *   'Processing high-priority data request'
   * )
   * ```
   */
  public async trackAgentSubTaskEntry(
    agentRequestId: string,
    creditsToRedeem: number = 0,
    tag?: string,
    description?: string,
  ): Promise<TrackAgentSubTaskResponseDto> {
    return this.trackAgentSubTask({
      agentRequestId,
      creditsToRedeem,
      tag,
      description,
    })
  }

  /**
   * Returns the HTTP options required to query the backend.
   * @param method - HTTP method.
   * @param body - Optional request body.
   * @returns HTTP options object.
   * @internal
   */
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
