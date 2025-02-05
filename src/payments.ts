import { decodeJwt } from 'jose'
import fileDownload from 'js-file-download'
import * as path from 'path'
import { AIQueryApi } from './api/query-api'
import { getServiceHostFromEndpoints, jsonReplacer } from './common/helper'
import { PaymentsError } from './common/payments.error'
import {
  CreateAgentDto,
  CreateFileDto,
  CreatePlanCreditsDto,
  CreatePlanTimeDto,
  CreateServiceDto,
  PaymentOptions,
} from './common/types'
import { EnvironmentInfo, Environments } from './environments'
import { getAIHubOpenApiUrl, getQueryProtocolEndpoints, isEthereumAddress } from './utils'

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
   * @param createPlanCreditsDto - @see {@link CreatePlanCreditsDto}
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
  public async createCreditsPlan(
    createPlanCreditsDto: CreatePlanCreditsDto,
  ): Promise<{ did: string }> {
    const metadata = {
      main: {
        name: createPlanCreditsDto.name,
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
        description: createPlanCreditsDto.description,
        tags: createPlanCreditsDto.tags || [],
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
        price: createPlanCreditsDto.price,
        nft: {
          amount: createPlanCreditsDto.amountOfCredits,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      price: createPlanCreditsDto.price,
      tokenAddress: createPlanCreditsDto.tokenAddress,
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
   * @param createPlanTimeDto - @see {@link CreatePlanTimeDto}
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
  public async createTimePlan(createPlanTimeDto: CreatePlanTimeDto): Promise<{ did: string }> {
    const metadata = {
      main: {
        name: createPlanTimeDto.name,
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
        description: createPlanTimeDto.description,
        tags: createPlanTimeDto.tags || [],
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
        price: createPlanTimeDto.price,
        nft: {
          duration: createPlanTimeDto.duration,
          amount: 1,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      price: createPlanTimeDto.price,
      tokenAddress: createPlanTimeDto.tokenAddress,
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
   * @param createAgentDto - @see {@link CreateAgentDto}
   * @returns A promise that resolves to the created agent DID.
   */
  public async createAgent(createAgentDto: CreateAgentDto): Promise<{ did: string }> {
    if (createAgentDto.usesAIHub) {
      createAgentDto.authType = 'bearer'
      createAgentDto.token = ''
      createAgentDto.endpoints = getQueryProtocolEndpoints(this.environment.backend)
      createAgentDto.openApiUrl = getAIHubOpenApiUrl(this.environment.backend)
      createAgentDto.implementsQueryProtocol = true
    } else {
      if (!createAgentDto.endpoints) {
        throw new PaymentsError('endpoints are required')
      }
    }

    return this.createService({
      planDID: createAgentDto.planDID,
      name: createAgentDto.name,
      description: createAgentDto.description,
      usesAIHub: createAgentDto.usesAIHub,
      implementsQueryProtocol: createAgentDto.implementsQueryProtocol,
      serviceType: 'agent',
      serviceChargeType: createAgentDto.serviceChargeType,
      authType: createAgentDto.authType,
      amountOfCredits: createAgentDto.amountOfCredits,
      minCreditsToCharge: createAgentDto.minCreditsToCharge,
      maxCreditsToCharge: createAgentDto.maxCreditsToCharge,
      username: createAgentDto.username,
      password: createAgentDto.password,
      token: createAgentDto.token,
      endpoints: createAgentDto.endpoints,
      openEndpoints: createAgentDto.openEndpoints,
      openApiUrl: createAgentDto.openApiUrl,
      integration: createAgentDto.integration,
      sampleLink: createAgentDto.sampleLink,
      apiDescription: createAgentDto.apiDescription,
      curation: createAgentDto.curation,
      tags: createAgentDto.tags,
    })
  }

  /**
   *
   * It creates a new AI Agent and a Payment Plan on Nevermined.
   *
   * @remarks
   *
   * This method is oriented to AI Builders
   *
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
   *
   * @param plan - @see {@link CreatePlanCreditsDto}
   * @param agent - @see {@link CreateAgentDto} PlanDID is generated automatically.
   * @returns A promise that resolves to the Plan DID and Agent DID.
   *
   * @example
   * ```
   * const { planDID, agentDID } = await paymentsBuilder.createAgentAndPlan(
   * {
   * name: 'My AI Payments Plan',
   * description: 'AI stuff',
   * price: 10000000n,
   * tokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
   * amountOfCredits: 30,
   * },
   * {
   * name: 'Payments Agent name',
   * description: 'description',
   * amountOfCredits: 1,
   * tags: ['test'],
   * usesAIHub: true,
   * implementsQueryProtocol: true,
   * serviceChargeType: 'fixed',
   * authType: 'bearer',
   * token,
   * endpoints,
   * integration: 'integration details',
   * apiDescription: 'description',
   * curation: {}
   * })
   * ```
   *
   * @returns A promise that resolves to the Plan DID and Agent DID.
   */
  public async createAgentAndPlan(
    plan: CreatePlanCreditsDto,
    agent: Omit<CreateAgentDto, 'planDID'>
  ): Promise<{ planDID: string; agentDID: string }> {
    const { did: planDID } = await this.createCreditsPlan({
      name: plan.name,
      description: plan.description,
      price: plan.price,
      tokenAddress: plan.tokenAddress,
      amountOfCredits: plan.amountOfCredits,
      tags: plan.tags,
    })

    const { did: agentDID } = await this.createAgent({
      planDID,
      name: agent.name,
      description: agent.description,
      amountOfCredits: agent.amountOfCredits,
      tags: agent.tags,
      usesAIHub: agent.usesAIHub,
      implementsQueryProtocol: agent.implementsQueryProtocol,
      serviceChargeType: agent.serviceChargeType,
      minCreditsToCharge: agent.minCreditsToCharge,
      maxCreditsToCharge: agent.maxCreditsToCharge,
      authType: agent.authType,
      username: agent.username,
      password: agent.password,
      token: agent.token,
      endpoints: agent.endpoints,
      openEndpoints: agent.openEndpoints,
      openApiUrl: agent.openApiUrl,
      integration: agent.integration,
      sampleLink: agent.sampleLink,
      apiDescription: agent.apiDescription,
      curation: agent.curation,
    })

    return { planDID, agentDID }
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
   * @param createServiceDto - @see {@link CreateServiceDto}
   * @returns A promise that resolves to the created agent DID.
   */
  public async createService(createServiceDto: CreateServiceDto): Promise<{ did: string }> {
    let authentication = {}
    let _headers: { Authorization: string }[] = []
    if (createServiceDto.authType === 'basic') {
      authentication = {
        type: 'basic',
        username: createServiceDto.username,
        password: createServiceDto.password,
      }
    } else if (createServiceDto.authType === 'oauth' || createServiceDto.authType === 'bearer') {
      authentication = {
        type: createServiceDto.authType,
        token: createServiceDto.token,
      }
      _headers = [{ Authorization: `Bearer ${createServiceDto.token}` }]
    } else {
      authentication = { type: 'none' }
    }

    const metadata = {
      main: {
        name: createServiceDto.name,
        license: 'No License Specified',
        type: createServiceDto.serviceType,
        files: [],
        ercType: 'nft1155',
        nftType: 'nft1155Credit',
        subscription: {
          timeMeasure: 'days',
          subscriptionType: 'credits',
        },
        webService: {
          endpoints: createServiceDto.endpoints,
          openEndpoints: createServiceDto.openEndpoints,
          chargeType: createServiceDto.serviceChargeType,
          isNeverminedHosted: createServiceDto.usesAIHub,
          implementsQueryProtocol: createServiceDto.implementsQueryProtocol,
          ...(createServiceDto.implementsQueryProtocol && { queryProtocolVersion: 'v1' }),
          serviceHost: getServiceHostFromEndpoints(createServiceDto.endpoints!),
          internalAttributes: {
            authentication,
            headers: _headers,
            chargeType: createServiceDto.serviceChargeType,
          },
        },
        ...(createServiceDto.curation && { curation: createServiceDto.curation }),
        additionalInformation: {
          description: createServiceDto.description,
          tags: createServiceDto.tags ? createServiceDto.tags : [],
          customData: {
            openApiUrl: createServiceDto.openApiUrl,
            integration: createServiceDto.integration,
            sampleLink: createServiceDto.sampleLink,
            apiDescription: createServiceDto.apiDescription,
            plan: 'custom',
            serviceChargeType: createServiceDto.serviceChargeType,
          },
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-access',
        nft: {
          amount: createServiceDto.amountOfCredits ? createServiceDto.amountOfCredits : 1,
          tokenId: createServiceDto.planDID,
          minCreditsToCharge: createServiceDto.minCreditsToCharge,
          minCreditsRequired: createServiceDto.minCreditsToCharge,
          maxCreditsToCharge: createServiceDto.maxCreditsToCharge,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      metadata,
      serviceAttributes,
      subscriptionDid: createServiceDto.planDID,
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
   * @param createFileDto - @see {@link CreateFileDto}
   * @returns The promise that resolves to the created file's DID.
   */
  public async createFile(createFileDto: CreateFileDto): Promise<{ did: string }> {
    const metadata = {
      main: {
        name: createFileDto.name,
        license: 'No License Specified',
        type: createFileDto.assetType,
        files: createFileDto.files,
        ercType: 'nft1155',
        nftType: 'nft1155Credit',
      },
      ...(createFileDto.curation && { curation: createFileDto.curation }),
      additionalInformation: {
        description: createFileDto.description,
        tags: createFileDto.tags ? createFileDto.tags : [],
        customData: {
          dataSchema: createFileDto.dataSchema,
          sampleCode: createFileDto.sampleCode,
          usageExample: createFileDto.usageExample,
          filesFormat: createFileDto.filesFormat,
          programmingLanguage: createFileDto.programmingLanguage,
          framework: createFileDto.framework,
          task: createFileDto.task,
          architecture: createFileDto.task,
          trainingDetails: createFileDto.trainingDetails,
          variations: createFileDto.variations,
          fineTunable: createFileDto.fineTunable,
          plan: 'custom',
        },
      },
    }
    const serviceAttributes = [
      {
        serviceType: 'nft-access',
        nft: {
          tokenId: createFileDto.planDID,
          amount: createFileDto.amountOfCredits ? createFileDto.amountOfCredits : 1,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      metadata,
      serviceAttributes,
      subscriptionDid: createFileDto.planDID,
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
   * @example
   * ```
   * const plans = await payments.searchPlans({ text: 'test' })
   * ```
   *
   * @param text - The text query to search for Payment Plans.
   * @param page - The page number for pagination.
   * @param offset - The number of items per page.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   *
   */
  public async searchPlans({
    text,
    page = 1,
    offset = 10,
  }: {
    text: string
    page?: number
    offset?: number
  }) {
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
