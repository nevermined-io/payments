import { decodeJwt } from 'jose'
import fileDownload from 'js-file-download'
import * as path from 'path'
import { AIQueryApi } from './api/query-api'
import { getServiceHostFromEndpoints, jsonReplacer } from './common/helper'
import { PaymentsError } from './common/payments.error'
import { EnvironmentInfo, EnvironmentName, Environments } from './environments'
import { getAIHubOpenApiUrl, getQueryProtocolEndpoints, isEthereumAddress } from './utils'

/**
 * Options to initialize the Payments class.
 */
export interface PaymentOptions {
  /**
   * The Nevermined environment to connect to.
   * If you are developing an agent it's recommended to use the "testing" environment.
   * When deploying to production use the "arbitrum" environment.
   */
  environment: EnvironmentName

  /**
   * The Nevermined API Key. This key identify your user and is required to interact with the Nevermined API.
   * You can get your API key by logging in to the Nevermined App.
   * @see https://docs.nevermined.app/docs/tutorials/integration/nvm-api-keys
   */
  nvmApiKey?: string

  /**
   * The URL to return to the app after a successful login.
   */
  returnUrl?: string

  /**
   * The app id. This attribute is optional and helps to associate assets registered into Nevermined with a common identifier.
   */
  appId?: string

  /**
   * The version of the API to use.
   */
  version?: string
}

export interface Endpoint {
  [verb: string]: string
}

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
      webSocketHost: this.environment.websocketBackend,
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
    if (this.query) this.query.disconnect()
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
   * It allows to an AI Builder to create a Payment Plan on Nevermined based on Credits.
   * A Nevermined Credits Plan limits the access by the access/usage of the Plan.
   * With them, AI Builders control the number of requests that can be made to an agent or service.
   * Every time a user accesses any resouce associated to the Payment Plan, the usage consumes from a capped amount of credits.
   * When the user consumes all the credits, the plan automatically expires and the user needs to top up to continue using the service.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param name - The name of the plan.
   * @param description - A description of what the plan offers.
   * @param price - The price of the plan. It must be given in the lowest denomination of the currency.
   * @param tokenAddress - The address of the ERC20 contract used for the payment. Using the `ZeroAddress` will use the chain's native currency instead.
   * @param amountOfCredits - The number of credits that are transferred to the user when purchases the plan.
   * @param tags - An array of tags or keywords that best fit the subscription.
   *
   * @example
   * ```
   *  const { did } = await payments.createCreditsPlan({
   *    name: "My AI Payments Plan",
   *    description: "AI stuff",
   *    price: 10000000n,
   *    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
   *    amountOfCredits: 30,
   *    tags: ["test"]
   *   })
   * ```
   *
   * @returns The unique identifier of the plan (Plan DID) of the newly created plan.
   */
  public async createCreditsPlan({
    name,
    description,
    price,
    tokenAddress,
    amountOfCredits,
    tags,
  }: {
    name: string
    description: string
    price: bigint
    tokenAddress: string
    amountOfCredits: number
    tags?: string[]
  }): Promise<{ did: string }> {
    const metadata = {
      main: {
        name,
        type: 'subscription',
        license: 'No License Specified',
        files: [],
        ercType: 1155,
        nftType: 'nft1155-credit',
        subscription: {
          subscriptionType: 'credits',
        },
      },
      additionalInformation: {
        description,
        tags: tags || [],
        customData: {
          dateMeasure: 'days',
          plan: 'custom',
          subscriptionLimitType: 'credits',
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-sales',
        price,
        nft: {
          amount: amountOfCredits,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      price,
      tokenAddress,
      metadata,
      serviceAttributes,
    }

    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body, jsonReplacer),
    }
    const url = new URL('/api/v1/payments/subscription', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * It allows to an AI Builder to create a Payment Plan on Nevermined based on Time.
   * A Nevermined Time Plan limits the access by the a specific amount of time.
   * With them, AI Builders can specify the duration of the Payment Plan (1 month, 1 year, etc.).
   * When the time period is over, the plan automatically expires and the user needs to renew it.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/create-plan
   *
   * @param name - The name of the plan.
   * @param description - A description of what the plan offers.
   * @param price - The price of the plan. It must be given in the lowest denomination of the currency.
   * @param tokenAddress - The address of the ERC20 contract used for the payment. Using the `ZeroAddress` will use the chain's native currency instead.
   * @param tags - An array of tags or keywords that best fit the subscription.
   * @param duration - The duration of the plan in days. If `duration` is left undefined an unlimited time duration subscription will be created.
   * @param tags - An array of tags or keywords that best fit the subscription.
   *
   * @example
   * ```
   *  const { did } = await payments.createTimePlan({
   *    name: "My 1 Month Plan",
   *    description: "test",
   *    price: 10000000n,
   *    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
   *    duration: 30,
   *    tags: ["test"]
   *   })
   * ```
   *
   * @returns The unique identifier of the plan (Plan DID) of the newly created plan.
   */
  public async createTimePlan({
    name,
    description,
    price,
    tokenAddress,
    duration,
    tags,
  }: {
    name: string
    description: string
    price: bigint
    tokenAddress: string
    duration?: number
    tags?: string[]
  }): Promise<{ did: string }> {
    const metadata = {
      main: {
        name,
        type: 'subscription',
        license: 'No License Specified',
        files: [],
        ercType: 1155,
        nftType: 'nft1155-credit',
        subscription: {
          subscriptionType: 'time',
        },
      },
      additionalInformation: {
        description,
        tags: tags || [],
        customData: {
          dateMeasure: 'days',
          plan: 'custom',
          subscriptionLimitType: 'time',
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-sales',
        price,
        nft: {
          duration,
          amount: 1,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      price,
      tokenAddress,
      metadata,
      serviceAttributes,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body, jsonReplacer),
    }
    const url = new URL('/api/v1/payments/subscription', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * It creates a new AI Agent on Nevermined.
   * The agent must be associated to a Payment Plan. Users that are subscribers of a payment plan can access the agent.
   * Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
   *
   * @example
   * ```typescript
   * const agentDID = await paymentsBuilder.createService({
   *     planDID,
   *     name: 'E2E Payments Agent',
   *     description: 'description',
   *     serviceType: 'agent',
   *     serviceChargeType: 'fixed',
   *     authType: 'bearer',
   *     token: 'changeme',
   *     amountOfCredits: 1,
   *     endpoints: agentEndpoints,
   *     openEndpoints: ['https://example.com/api/v1/rest/docs-json']
   *   })
   * ```
   *
   * @param planDID - The plan unique identifier of the Plan (DID). @see {@link createCreditsPlan} or {@link createTimePlan}
   * @param name - The name of the AI Agent/Service.
   * @param description - The description of the AI Agent/Service.
   * @param tags - The tags describing the AI Agent/Service.
   * @param usesAIHub - If the agent is using the AI Hub. If true, the agent will be configured to use the AI Hub endpoints.
   * @param implementsQueryProtocol - It the agent implements the Nevermined Query Protocol. @see https://docs.nevermined.io/docs/protocol/query-protocol
   * @param serviceChargeType - The service charge type ('fixed' or 'dynamic').
   * @param amountOfCredits - The amount of credits to charge per request to the agent.
   * @param minCreditsToCharge - The minimum credits to charge.
   * @param maxCreditsToCharge - The maximum credits to charge.
   * @param authType - The upstream agent/service authentication type ('none', 'basic', 'bearer' or 'oauth').
   * @param username - The upstream agent/service username for authentication. Only if `authType` is 'basic'.
   * @param password - The upstream agent/service password for authentication. Only if `authType` is 'basic'.
   * @param token - The upstream agent/service bearer token for authentication. Only if `authType` is 'bearer' or 'oauth'.
   * @param endpoints - The list endpoints of the upstream service. All these endpoints are protected and only accessible to subscribers of the Payment Plan.
   * @param openEndpoints - The list of endpoints of the upstream service that publicly available. The access to these endpoints don't require subscription to the Payment Plan. They are useful to expose documentation, etc.
   * @param openApiUrl - The URL to the OpenAPI description of the Upstream API. The access to the OpenAPI definition don't require subscription to the Payment Plan.
   * @param integration - Some description or instructions about how to integrate the Agent.
   * @param sampleLink - A link to some same usage of the Agent.
   * @param apiDescription - Text describing the API of the Agent.
   * @param curation - The curation details.
   * @returns A promise that resolves to the created agent DID.
   */
  public async createAgent({
    planDID,
    name,
    description,
    amountOfCredits,
    tags,
    usesAIHub,
    implementsQueryProtocol,
    serviceChargeType,
    minCreditsToCharge,
    maxCreditsToCharge,
    authType,
    username,
    password,
    token,
    endpoints,
    openEndpoints,
    openApiUrl,
    integration,
    sampleLink,
    apiDescription,
    curation,
  }: {
    planDID: string
    name: string
    description: string
    usesAIHub?: boolean
    implementsQueryProtocol?: boolean
    serviceChargeType: 'fixed' | 'dynamic'
    authType?: 'none' | 'basic' | 'oauth' | 'bearer'
    amountOfCredits?: number
    minCreditsToCharge?: number
    maxCreditsToCharge?: number
    username?: string
    password?: string
    token?: string
    endpoints?: Endpoint[]
    openEndpoints?: string[]
    openApiUrl?: string
    integration?: string
    sampleLink?: string
    apiDescription?: string
    curation?: object
    tags?: string[]
  }): Promise<{ did: string }> {
    if (usesAIHub) {
      authType = 'bearer'
      token = ''
      endpoints = getQueryProtocolEndpoints(this.environment.backend)
      openApiUrl = getAIHubOpenApiUrl(this.environment.backend)
      implementsQueryProtocol = true
    } else {
      if (!endpoints) {
        throw new PaymentsError('endpoints are required')
      }
    }

    return this.createService({
      planDID,
      name,
      description,
      usesAIHub,
      implementsQueryProtocol,
      serviceType: 'agent',
      serviceChargeType,
      authType,
      amountOfCredits,
      minCreditsToCharge,
      maxCreditsToCharge,
      username,
      password,
      token,
      endpoints,
      openEndpoints,
      openApiUrl,
      integration,
      sampleLink,
      apiDescription,
      curation,
      tags,
    })
  }

  /**
   * It creates a new AI Agent or Service on Nevermined.
   * The agent/service must be associated to a Payment Plan. Users that are subscribers of a payment plan can access the agent/service.
   * Depending on the Payment Plan and the configuration of the agent/service, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent/service.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
   *
   * @example
   * ```typescript
   * const agentEndpoints: Endpoint[] = [
   *   { 'POST': `https://example.com/api/v1/agents/(.*)/tasks` },
   *   { 'GET': `https://example.com/api/v1/agents/(.*)/tasks/(.*)` }
   * ]
   * const agentDID = await paymentsBuilder.createService({
   *     planDID,
   *     name: 'E2E Payments Agent',
   *     description: 'description',
   *     serviceType: 'agent',
   *     serviceChargeType: 'fixed',
   *     authType: 'bearer',
   *     token: 'changeme',
   *     amountOfCredits: 1,
   *     endpoints: agentEndpoints,
   *     openEndpoints: ['https://example.com/api/v1/rest/docs-json']
   *   })
   * ```
   *
   * @param planDID - The plan unique identifier of the Plan (DID). @see {@link createCreditsPlan} or {@link createTimePlan}
   * @param name - The name of the AI Agent/Service.
   * @param description - The description of the AI Agent/Service.
   * @param tags - The tags describing the AI Agent/Service.
   * @param usesAIHub - If the agent is using the AI Hub. If true, the agent will be configured to use the AI Hub endpoints.
   * @param implementsQueryProtocol - It the agent implements the Nevermined Query Protocol. @see https://docs.nevermined.io/docs/protocol/query-protocol
   * @param serviceType - The service type ('service', 'agent', or 'assistant').
   * @param serviceChargeType - The service charge type ('fixed' or 'dynamic').
   * @param amountOfCredits - The amount of credits to charge per request to the agent.
   * @param minCreditsToCharge - The minimum credits to charge.
   * @param maxCreditsToCharge - The maximum credits to charge.
   * @param authType - The upstream agent/service authentication type ('none', 'basic', 'bearer' or 'oauth').
   * @param username - The upstream agent/service username for authentication. Only if `authType` is 'basic'.
   * @param password - The upstream agent/service password for authentication. Only if `authType` is 'basic'.
   * @param token - The upstream agent/service bearer token for authentication. Only if `authType` is 'bearer' or 'oauth'.
   * @param endpoints - The list endpoints of the upstream service. All these endpoints are protected and only accessible to subscribers of the Payment Plan.
   * @param openEndpoints - The list of endpoints of the upstream service that publicly available. The access to these endpoints don't require subscription to the Payment Plan. They are useful to expose documentation, etc.
   * @param openApiUrl - The URL to the OpenAPI description of the Upstream API. The access to the OpenAPI definition don't require subscription to the Payment Plan.
   * @param integration - Some description or instructions about how to integrate the Agent.
   * @param sampleLink - A link to some same usage of the Agent.
   * @param apiDescription - Text describing the API of the Agent.
   * @param curation - The curation details.
   * @returns A promise that resolves to the created agent DID.
   */
  public async createService({
    planDID,
    name,
    description,
    usesAIHub,
    implementsQueryProtocol,
    amountOfCredits,
    tags,
    serviceType,
    serviceChargeType,
    minCreditsToCharge,
    maxCreditsToCharge,
    authType,
    username,
    password,
    token,
    endpoints,
    openEndpoints,
    openApiUrl,
    integration,
    sampleLink,
    apiDescription,
    curation,
  }: {
    planDID: string
    name: string
    description: string
    usesAIHub?: boolean
    implementsQueryProtocol?: boolean
    serviceType: 'service' | 'agent' | 'assistant'
    serviceChargeType: 'fixed' | 'dynamic'
    authType?: 'none' | 'basic' | 'oauth' | 'bearer'
    amountOfCredits?: number
    minCreditsToCharge?: number
    maxCreditsToCharge?: number
    username?: string
    password?: string
    token?: string
    endpoints?: Endpoint[]
    openEndpoints?: string[]
    openApiUrl?: string
    integration?: string
    sampleLink?: string
    apiDescription?: string
    curation?: object
    tags?: string[]
  }): Promise<{ did: string }> {
    let authentication = {}
    let _headers: { Authorization: string }[] = []
    if (authType === 'basic') {
      authentication = {
        type: 'basic',
        username,
        password,
      }
    } else if (authType === 'oauth' || authType === 'bearer') {
      authentication = {
        type: authType,
        token,
      }
      _headers = [{ Authorization: `Bearer ${token}` }]
    } else {
      authentication = { type: 'none' }
    }

    const metadata = {
      main: {
        name,
        license: 'No License Specified',
        type: serviceType,
        files: [],
        ercType: 'nft1155',
        nftType: 'nft1155Credit',
        subscription: {
          timeMeasure: 'days',
          subscriptionType: 'credits',
        },
        webService: {
          endpoints: endpoints,
          openEndpoints: openEndpoints,
          chargeType: serviceChargeType,
          isNeverminedHosted: usesAIHub,
          implementsQueryProtocol,
          ...(implementsQueryProtocol && { queryProtocolVersion: 'v1' }),
          serviceHost: getServiceHostFromEndpoints(endpoints!),
          internalAttributes: {
            authentication,
            headers: _headers,
            chargeType: serviceChargeType,
          },
        },
        ...(curation && { curation }),
        additionalInformation: {
          description,
          tags: tags ? tags : [],
          customData: {
            openApiUrl,
            integration,
            sampleLink,
            apiDescription,
            plan: 'custom',
            serviceChargeType,
          },
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-access',
        nft: {
          amount: amountOfCredits ? amountOfCredits : 1,
          tokenId: planDID,
          minCreditsToCharge,
          minCreditsRequired: minCreditsToCharge,
          maxCreditsToCharge,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      metadata,
      serviceAttributes,
      subscriptionDid: planDID,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body, jsonReplacer),
    }
    const url = new URL('/api/v1/payments/service', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * It creates a new asset with file associated to it.
   * The file asset must be associated to a Payment Plan. Users that are subscribers of a payment plan can download the files attached to it.
   * Depending on the Payment Plan and the configuration of the file asset, the download will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue downloading the files.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-file-asset
   *
   * @param planDID - The plan unique identifier of the Plan (DID). @see {@link createCreditsPlan} or {@link createTimePlan}
   * @param assetType - The type of asset ('dataset' | 'algorithm' | 'model' | 'file' | 'other')
   * @param name - The name of the file.
   * @param description - The description of the file.
   * @param files - The array of files that can be downloaded for users that are subscribers of the Payment Plan.
   * @param amountOfCredits - The cost in credits of downloading a file. This parameter is only required if the Payment Plan attached to the file is based on credits.
   * @param tags - The array of tags describing the file.
   * @param dataSchema - The data schema of the files.
   * @param sampleCode - Some sample code related to the file.
   * @param filesFormat - The format of the files.
   * @param usageExample - The usage example.
   * @param programmingLanguage - The programming language used in the files.
   * @param framework - The framework used for creating the file.
   * @param task - The task creating the file.
   * @param trainingDetails - The training details.
   * @param variations - The variations.
   * @param fineTunable - Indicates if the file is fine-tunable.
   * @param curation - The curation object.
   * @returns The promise that resolves to the created file's DID.
   */
  public async createFile({
    planDID,
    assetType,
    name,
    description,
    files,
    amountOfCredits,
    tags,
    dataSchema,
    sampleCode,
    filesFormat,
    usageExample,
    programmingLanguage,
    framework,
    task,
    trainingDetails,
    variations,
    fineTunable,
    curation,
  }: {
    planDID: string
    assetType: 'dataset' | 'algorithm' | 'model' | 'file' | 'other'
    name: string
    description: string
    files: object[]
    dataSchema?: string
    sampleCode?: string
    filesFormat?: string
    usageExample?: string
    programmingLanguage?: string
    framework?: string
    task?: string
    trainingDetails?: string
    variations?: string
    fineTunable?: boolean
    amountOfCredits?: number
    minCreditsToCharge?: number
    maxCreditsToCharge?: number
    curation?: object
    tags?: string[]
  }): Promise<{ did: string }> {
    const metadata = {
      main: {
        name,
        license: 'No License Specified',
        type: assetType,
        files,
        ercType: 'nft1155',
        nftType: 'nft1155Credit',
      },
      ...(curation && { curation }),
      additionalInformation: {
        description,
        tags: tags ? tags : [],
        customData: {
          dataSchema,
          sampleCode,
          usageExample,
          filesFormat,
          programmingLanguage,
          framework,
          task,
          architecture: task,
          trainingDetails,
          variations,
          fineTunable,
          plan: 'custom',
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-access',
        nft: {
          tokenId: planDID,
          amount: amountOfCredits ? amountOfCredits : 1,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      metadata,
      serviceAttributes,
      subscriptionDid: planDID,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/file', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Get the Metadata (aka Decentralized Document or DDO) for a given asset identifier (DID).
   *
   * @see https://docs.nevermined.io/docs/architecture/specs/Spec-DID
   * @see https://docs.nevermined.io/docs/architecture/specs/Spec-METADATA
   *
   * @param did - The unique identifier (aka DID) of the asset (payment plan, agent, file, etc).
   * @returns A promise that resolves to the DDO.
   */
  public async getAssetDDO(did: string) {
    const url = new URL(`/api/v1/payments/asset/ddo/${did}`, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Get array of services/agent DIDs associated with a payment plan.
   *
   * @param planDID - The DID of the Payment Plan.
   * @returns A promise that resolves to the array of services/agents DIDs.
   */
  public async getPlanAssociatedServices(planDID: string) {
    const url = new URL(
      `/api/v1/payments/subscription/services/${planDID}`,
      this.environment.backend,
    )
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Get array of files DIDs associated with a payment plan.
   *
   * @param planDID - The DID of the Payment Plan.
   * @returns A promise that resolves to array of files DIDs.
   */
  public async getPlanAssociatedFiles(planDID: string) {
    const url = new URL(`/api/v1/payments/subscription/files/${planDID}`, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Get the balance of an account for a Payment Plan.
   *
   * @param planDID - The Payment Plan DID of the service to be published.
   * @param accountAddress - The address of the account to get the balance.
   * @returns A promise that resolves to the balance result.
   */
  public async getPlanBalance(
    planDID: string,
    accountAddress?: string,
  ): Promise<{
    subscriptionType: string
    isOwner: boolean
    balance: bigint
    isSubscriptor: boolean
  }> {
    const body = {
      subscriptionDid: planDID,
      accountAddress: isEthereumAddress(accountAddress) ? accountAddress : this.accountAddress,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/subscription/balance', this.environment.backend)
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
   * @param planDID - The Payment Plan DID of the service to be published.
   * @param agreementId - The unique identifier of the purchase transaction (aka agreement ID). When this parameter is given, it assumes there is a previous payment step and will request the payment plan.
   * @returns A promise that resolves to the agreement ID and a boolean indicating if the operation was successful.
   */
  public async orderPlan(
    planDID: string,
    agreementId?: string,
  ): Promise<{ agreementId: string; success: boolean }> {
    const body = { subscriptionDid: planDID, agreementId }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/subscription/order', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Downloads files for a given DID asset.
   *
   * @param did - The DID of the file.
   * @returns A promise that resolves to the JSON response from the server.
   */
  public async downloadFiles(fileDid: string) {
    const body = { fileDid }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/file/download', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    let filename = 'file'
    const contentDisposition = response.headers.get('Content-Disposition')
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="(.+?)"/)
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1]
      }
    }
    const buff = await response.arrayBuffer()
    fileDownload(buff, filename)
    const destination = process.cwd()

    return path.join(destination, filename)
  }

  /**
   * Redirects the user to the subscription details for a given DID.
   * @remarks
   *
   * This method is only for browser instances.
   *
   * @param planDID - The DID (Decentralized Identifier) of the plan.
   */
  public getPlanDetails(planDID: string) {
    const url = new URL(`/en/subscription/${planDID}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the service details for a given DID.
   *
   * @remarks
   *
   * This method is only for browser instances.
   *
   * @param did - The DID (Decentralized Identifier) of the service.
   */
  public getServiceDetails(did: string) {
    const url = new URL(`/en/webservice/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the file details for the specified DID (Decentralized Identifier).
   *
   * @remarks
   *
   * This method is only for browser instances.
   *
   * @param did - The DID of the file.
   */
  public getFileDetails(did: string) {
    const url = new URL(`/en/file/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the subscription checkout page for the specified DID.
   *
   * @remarks
   *
   * This method is only for browser instances.
   *
   * @param did - The DID (Decentralized Identifier) of the item to be subscribed to.
   */
  public checkoutSubscription(did: string) {
    const url = new URL(`/en/subscription/checkout/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Mint credits for a given Payment Plan DID and transfer them to a receiver.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planDID - The DID (Decentralized Identifier) of the asset.
   * @param creditsAmount - The amount of NFT (Non-Fungible Token) credits to mint.
   * @param receiver - The address of the receiver where the credits will be transferred.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async mintCredits(planDID: string, creditsAmount: string, receiver: string) {
    const body = { did: planDID, nftAmount: creditsAmount, receiver }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/credits/mint', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   * Burn credits for a given Payment Plan DID.
   *
   * @remarks
   *
   * This method is only can be called by the owner of the Payment Plan.
   *
   * @param planDID - The DID (Decentralized Identifier) of the asset.
   * @param creditsAmount - The amount of NFT (Non-Fungible Token) credits to burn.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async burnCredits(planDID: string, creditsAmount: string) {
    const body = { did: planDID, nftAmount: creditsAmount }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/credits/burn', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * Search for Payment Plans based on a text query.
   *
   * @param text - The text query to search for Payment Plans.
   * @param page - The page number for pagination.
   * @param offset - The number of items per page.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   *
   */
  public async searchPlans({ text, page = 1, offset = 10 }: { text: string; page?: number; offset?: number }) {
    const body = { text: text, page: page, offset: offset }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/search/plan', this.environment.backend)
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
   *
   * @param text - The text query to search for Payment Plans.
   * @param page - The page number for pagination.
   * @param offset - The number of items per page.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   *
   */
  public async searchAgents({ text, page = 1, offset = 10 }: { text: string; page?: number; offset?: number }) {
    const body = { text: text, page: page, offset: offset }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/search/agent', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }
}
