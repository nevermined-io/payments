import { EnvironmentInfo, EnvironmentName, Environments } from './environments'
import { decodeJwt } from 'jose'
/**
 * Options to initialize the Payments class.
 */
export interface PaymentOptions {
  /**
   * The URL to return to the app after a successful login.
   */
  returnUrl: string
  /**
   * The environment to connect to.
   */
  environment: EnvironmentName

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
  public returnUrl: string
  public environment: EnvironmentInfo
  public appId?: string
  public version?: string
  private nvmApiKey?: string

  /**
   * Initialize the payments class.
   *
   * @param options - The options to initialize the payments class.
   *
   * @example
   * ```
   * const payments = new Payments({
   *   returnUrl: 'https://mysite.example'
   *   environment: 'staging'
   *   appId: 'my-app-id'
   *   version: '1.0.0'
   * })
   * ```
   *
   * @returns An instance of {@link Payments}
   */
  constructor(options: PaymentOptions) {
    this.returnUrl = options.returnUrl
    this.environment = Environments[options.environment]
    this.appId = options.appId
    this.version = options.version
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
    const url = new URL(window.location.href)
    const nvmApiKey = url.searchParams.get('nvmApiKey') as string

    if (nvmApiKey) {
      this.nvmApiKey = nvmApiKey as string
      url.searchParams.delete('nvmApiKey')
      history.replaceState(history.state, '', url.toString())
    }
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
   * Account address
   *
   * @example
   * ```
   * payments.accountAddress
   * ```
   *
   * @returns Account address when the user is logged in.
   */
  get accountAddress(): string | undefined {
    const marketplaceAuthToken = this.nvmApiKey ? decodeJwt(this.nvmApiKey).marketplaceAuthToken as string : undefined

    if (!marketplaceAuthToken) {
      return undefined
    }

    return decodeJwt(marketplaceAuthToken).iss
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
   * Leave unset to use time limited time subscriptions instead.
   * @param duration - The duration of the subscription in days.
   * If `amountOfCredits` and `duration` is left undefined an unlimited time duration subscription
   * will be created.
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
  public async createSubscription({
    name,
    description,
    price,
    tokenAddress,
    amountOfCredits,
    duration,
    tags,
    nvmApiKey,
  }: {
    name: string
    description: string
    price: bigint
    tokenAddress: string
    amountOfCredits?: number
    duration?: number
    tags?: string[]
    nvmApiKey?: string
  }): Promise<{ did: string }> {
    const body = {
      name,
      description,
      price: price.toString(),
      tokenAddress,
      amountOfCredits,
      duration,
      tags,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/subscription', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }

  /**
   * Creates a service.
   *
   * @param subscriptionDid - The subscription DID.
   * @param name - The name of the service.
   * @param description - The description of the service.
   * @param price - The price of the service.
   * @param tokenAddress - The token address.
   * @param amountOfCredits - The amount of credits.
   * @param duration - The duration of the service.
   * @param tags - The tags associated with the service.
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
    price,
    tokenAddress,
    amountOfCredits,
    duration,
    tags,
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
    nvmApiKey,
  }: {
    subscriptionDid: string
    name: string
    description: string
    price: bigint
    tokenAddress: string
    serviceChargeType: 'fixed' | 'dynamic'
    authType: 'none' | 'basic' | 'oauth'
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
    duration?: number
    tags?: string[]
    nvmApiKey?: string
  }): Promise<{ did: string }> {
    const body = {
      name,
      description,
      price: price.toString(),
      tokenAddress,
      amountOfCredits,
      duration,
      tags,
      subscriptionDid,
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
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/service', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
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
   * @param price - The price of the file.
   * @param tokenAddress - The token address.
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
    price,
    tokenAddress,
    amountOfCredits,
    duration,
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
    minCreditsToCharge,
    maxCreditsToCharge,
    curation,
    nvmApiKey,
  }: {
    subscriptionDid: string
    assetType: string
    name: string
    description: string
    files: object[]
    price: bigint
    tokenAddress: string
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
    duration?: number
    tags?: string[]
    nvmApiKey?: string
  }): Promise<{ did: string }> {
    const body = {
      assetType,
      name,
      description,
      files,
      price: price.toString(),
      tokenAddress,
      amountOfCredits,
      duration,
      tags,
      subscriptionDid,
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
      minCreditsToCharge,
      maxCreditsToCharge,
      curation,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/file', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
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
      throw Error(response.statusText)
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
      throw Error(response.statusText)
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
      throw Error(response.statusText)
    }
    return response.json()
  }

  /**
   * Get the balance of an account for a subscription.
   *
   * @param subscriptionDid - The subscription DID of the service to be published.
   * @param accountAddress - The address of the account to get the balance.
   * @param nvmApiKey - The NVM API key to use for the request.
   * @returns A promise that resolves to the balance result.
   */
  public async getSubscriptionBalance(
    subscriptionDid: string,
    accountAddress?: string,
    nvmApiKey?: string,
  ): Promise<{
    subscriptionType: string
    isOwner: boolean
    balance: bigint
    isSubscriptor: boolean
  }> {
    const body = {
      subscriptionDid,
      accountAddress,
    }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/subscription/balance', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }

  /**
   * Get the service token for a given DID.
   *
   * @param did - The DID of the service.
   * @returns A promise that resolves to the service token.
   */
  public async getServiceToken(
    did: string,
    nvmApiKey?: string,
  ): Promise<{
    token: {
      accessToken: string
      neverminedProxyUri: string
    }
  }> {
    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
    }
    const url = new URL(`/api/v1/payments/service/token/${did}`, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }

  /**
   * Orders a subscription.
   *
   * @param subscriptionDid - The subscription DID.
   * @param agreementId - The agreement ID.
   * @param nvmApiKey - The NVM API key to use for the request.
   * @returns A promise that resolves to the agreement ID and a boolean indicating if the operation was successful.
   */
  public async orderSubscription(
    subscriptionDid: string,
    agreementId?: string,
    nvmApiKey?: string,
  ): Promise<{ agreementId: string; success: boolean }> {
    const body = { subscriptionDid, agreementId }
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${nvmApiKey || this.nvmApiKey}`,
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/subscription/order', this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }

  public async downloadFiles(did: string, nvmApiKey?: string) {
    const body = { did }
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
      throw Error(response.statusText)
    }

    return response.json()
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
}
