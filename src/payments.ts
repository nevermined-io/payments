import fileDownload from 'js-file-download'
import * as path from 'path'
import { EnvironmentInfo, EnvironmentName, Environments } from './environments'
import { decodeJwt } from 'jose'
import { PaymentsError } from './common/payments.error'
import { AIQueryApi } from './api/query-api'
import { isEthereumAddress, jsonReplacer } from './common/utils'

/**
 * Options to initialize the Payments class.
 */
export interface PaymentOptions {
  /**
   * The environment to connect to.
   */
  environment: EnvironmentName

  /**
   * The Nevermined API Key
   */
  nvmApiKey?: string
  /**
   * The URL to return to the app after a successful login.
   */
  returnUrl?: string

  /**
   * The app id.
   */
  appId?: string

  /**
   * The version of the library.
   */
  version?: string
}

export interface Endpoint {
  [verb: string]: string
}

/**
 * Main class that interacts with the Nevermined payments API.
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

  private parseNvmApiKey() {
    try {
      const jwt = decodeJwt(this.nvmApiKey!)
      console.log(jwt)
      this.accountAddress = jwt.sub
    } catch (error) {
      throw new PaymentsError('Invalid NVM API Key')
    }
  }

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
   * Create a subscription on Nevermined.
   *
   * @param name - The name of the subscription.
   * @param description - A description of what the subscription offers.
   * @param price - The price of the subscription.
   * @param tokenAddress - The ERC-20 token address of the currency used to price the subscription.
   * Using the zero address will use the chain's native currency instead.
   * @param amountOfCredits - The amount of credits associated with the credit based subscription.
   * @param tags - An array of tags or keywords that best fit the subscription.
   *
   * @example
   * ```
   *  const { did } = await payments.createSubscription({
   *    name: "test subscription",
   *    description: "test",
   *    price: 10000000n,
   *    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
   *    duration: 30,
   *    tags: ["test"]
   *   }
   * ```
   *
   * @returns The DID of the newly created subscription.
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
    console.log(body)
    console.log(JSON.stringify(body, jsonReplacer))
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
      body: JSON.stringify(body, jsonReplacer),
    }
    console.log(options)
    const url = new URL('/api/v1/payments/subscription', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return response.json()
  }

  /**
   *
   * Create a subscription on Nevermined.
   *
   * @param name - The name of the subscription.
   * @param description - A description of what the subscription offers.
   * @param price - The price of the subscription.
   * @param tokenAddress - The ERC-20 token address of the currency used to price the subscription.
   * Using the zero address will use the chain's native currency instead.
   * @param duration - The duration of the subscription in days.
   * If `duration` is left undefined an unlimited time duration subscription will be created.
   * @param tags - An array of tags or keywords that best fit the subscription.
   * @param nvmApiKey - The NVM API key to use for the request.
   *
   * @example
   * ```
   *  const { did } = await payments.createSubscription({
   *    name: "test subscription",
   *    description: "test",
   *    price: 10000000n,
   *    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
   *    duration: 30,
   *    tags: ["test"]
   *   }
   * ```
   *
   * @returns The DID of the newly created subscription.
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
   * Creates a service.
   *
   * @param subscriptionDid - The subscription DID.
   * @param name - The name of the service.
   * @param description - The description of the service.
   * @param amountOfCredits - The amount of credits.
   * @param tags - The tags associated with the service.
   * @param serviceType - The service type ('service', 'agent', or 'assistant').
   * @param serviceChargeType - The service charge type ('fixed' or 'dynamic').
   * @param minCreditsToCharge - The minimum credits to charge.
   * @param maxCreditsToCharge - The maximum credits to charge.
   * @param authType - The authentication type ('none', 'basic', or 'oauth').
   * @param username - The username for authentication.
   * @param password - The password for authentication.
   * @param token - The token for authentication.
   * @param endpoints - The endpoints of the service.
   * @param openEndpoints - The open endpoints of the service.
   * @param openApiUrl - The OpenAPI URL.
   * @param integration - The integration details.
   * @param sampleLink - The sample link.
   * @param apiDescription - The API description.
   * @param curation - The curation details.
   * @param nvmApiKey - The NVM API key to use for the request.
   * @returns A promise that resolves to the created service DID.
   */
  public async createService({
    subscriptionDid,
    name,
    description,
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
    subscriptionDid: string
    name: string
    description: string
    serviceType: 'service' | 'agent' | 'assistant'
    serviceChargeType: 'fixed' | 'dynamic'
    authType: 'none' | 'basic' | 'oauth' | 'bearer'
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
          tokenId: subscriptionDid,
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
      subscriptionDid,
    }
    console.log(JSON.stringify(body, jsonReplacer))
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
   * Creates a file with the specified parameters.
   *
   * @param subscriptionDid - The subscription DID.
   * @param assetType - The type of asset.
   * @param name - The name of the file.
   * @param description - The description of the file.
   * @param files - The array of files.
   * @param amountOfCredits - The amount of credits.
   * @param duration - The duration of the file.
   * @param tags - The array of tags.
   * @param dataSchema - The data schema.
   * @param sampleCode - The sample code.
   * @param filesFormat - The format of the files.
   * @param usageExample - The usage example.
   * @param programmingLanguage - The programming language.
   * @param framework - The framework.
   * @param task - The task.
   * @param trainingDetails - The training details.
   * @param variations - The variations.
   * @param fineTunable - Indicates if the file is fine-tunable.
   * @param minCreditsToCharge - The minimum credits to charge.
   * @param maxCreditsToCharge - The maximum credits to charge.
   * @param curation - The curation object.
   * @param nvmApiKey - The NVM API key to use for the request.
   * @returns The promise that resolves to the created file's DID.
   */
  public async createFile({
    subscriptionDid,
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
    subscriptionDid: string
    assetType: string
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
          tokenId: subscriptionDid,
          amount: amountOfCredits ? amountOfCredits : 1,
          nftTransfer: false,
        },
      },
    ]
    const body = {
      metadata,
      serviceAttributes,
      subscriptionDid,
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
   * Get the DDO for a given DID.
   *
   * @param did - The DID of the asset.
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
   * Get array of services DIDs associated with a subscription.
   *
   * @param did - The DID of the asset.
   * @returns A promise that resolves to the array of services DIDs.
   */
  public async getSubscriptionAssociatedServices(subscriptionDid: string) {
    const url = new URL(
      `/api/v1/payments/subscription/services/${subscriptionDid}`,
      this.environment.backend,
    )
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Get array of files DIDs associated with a subscription.
   *
   * @param did - The DID of the asset.
   * @returns A promise that resolves to array of files DIDs.
   */
  public async getSubscriptionAssociatedFiles(subscriptionDid: string) {
    const url = new URL(
      `/api/v1/payments/subscription/files/${subscriptionDid}`,
      this.environment.backend,
    )
    const response = await fetch(url)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }

  /**
   * Get the balance of an account for a subscription.
   *
   * @param subscriptionDid - The subscription DID of the service to be published.
   * @param accountAddress - The address of the account to get the balance.
   * @returns A promise that resolves to the balance result.
   */
  public async getSubscriptionBalance(
    subscriptionDid: string,
    accountAddress?: string,
  ): Promise<{
    subscriptionType: string
    isOwner: boolean
    balance: bigint
    isSubscriptor: boolean
  }> {
    console.log('getSubscriptionBalance', subscriptionDid, accountAddress)
    const body = {
      subscriptionDid,
      accountAddress: isEthereumAddress(accountAddress) ? accountAddress : this.accountAddress,
    }
    console.log(body)
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
   * Get the required configuration for accessing a remote service agent.
   * This configuration includes the JWT access token and the Proxy url.
   *
   * @param did - The DID of the service.
   * @returns A promise that resolves to the service token.
   */
  public async getServiceAccessConfig(did: string): Promise<{
    accessToken: string
    neverminedProxyUri: string
  }> {
    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.nvmApiKey}`,
      },
    }
    const url = new URL(`/api/v1/payments/service/token/${did}`, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return (await response.json()).token
  }

  /**
   * Orders a subscription.
   *
   * @param subscriptionDid - The subscription DID.
   * @param agreementId - The agreement ID.
   * @returns A promise that resolves to the agreement ID and a boolean indicating if the operation was successful.
   */
  public async orderSubscription(
    subscriptionDid: string,
    agreementId?: string,
  ): Promise<{ agreementId: string; success: boolean }> {
    const body = { subscriptionDid, agreementId }
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
   * @param nvmApiKey - The NVM API key to use for the request.
   * @returns A promise that resolves to the JSON response from the server.
   */
  public async downloadFiles(fileDid: string, nvmApiKey?: string) {
    const body = { fileDid }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
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

    const d = path.join(destination, filename)
    return d
    // return response.json()
  }

  /**
   * Redirects the user to the subscription details for a given DID.
   * @param did - The DID (Decentralized Identifier) of the subscription.
   */
  public getSubscriptionDetails(did: string) {
    const url = new URL(`/en/subscription/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the service details for a given DID.
   * @param did - The DID (Decentralized Identifier) of the service.
   */
  public getServiceDetails(did: string) {
    const url = new URL(`/en/webservice/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the file details for the specified DID (Decentralized Identifier).
   * @param did - The DID of the file.
   */
  public getFileDetails(did: string) {
    const url = new URL(`/en/file/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Redirects the user to the subscription checkout page for the specified DID.
   * @param did - The DID (Decentralized Identifier) of the item to be subscribed to.
   */
  public checkoutSubscription(did: string) {
    const url = new URL(`/en/subscription/checkout/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  /**
   * Mint credits for a given DID and transfer them to a receiver.
   * @param did - The DID (Decentralized Identifier) of the asset.
   * @param nftAmount - The amount of NFT (Non-Fungible Token) credits to mint.
   * @param receiver - The address of the receiver where the credits will be transferred.
   * @param nvmApiKey - (Optional) The NVM (Nevermined Vault Manager) API key to use for authorization.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async mintCredits(did: string, nftAmount: string, receiver: string, nvmApiKey?: string) {
    const body = { did, nftAmount, receiver }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
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
   * Burn credits for a given DID.
   *
   * @param did - The DID (Decentralized Identifier) of the asset.
   * @param nftAmount - The amount of NFT (Non-Fungible Token) credits to burn.
   * @param nvmApiKey - (Optional) The NVM (Nevermined Vault Manager) API key to use for authorization.
   * @returns A Promise that resolves to the JSON response from the server.
   * @throws Error if the server response is not successful.
   */
  public async burnCredits(did: string, nftAmount: string, nvmApiKey?: string) {
    const body = { did, nftAmount }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
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
}
