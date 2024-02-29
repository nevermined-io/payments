import { EnvironmentInfo, EnvironmentName, Environments } from './environments'

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
  private sessionKey?: string

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
   * })
   * ```
   *
   * @returns An instance of {@link Payments}
   */
  constructor(options: PaymentOptions) {
    this.returnUrl = options.returnUrl
    this.environment = Environments[options.environment]
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
      `/en/login?nvm-export=session-key&returnUrl=${this.returnUrl}`,
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
    const sessionKey = url.searchParams.get('sessionKey')
    if (sessionKey) {
      this.sessionKey = sessionKey
      url.searchParams.delete('sessionKey')
      history.replaceState(history.state, '', url.toString())
    }
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
    return !!this.sessionKey
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
  }: {
    name: string
    description: string
    price: bigint
    tokenAddress: string
    amountOfCredits?: number
    duration?: number
    tags?: string[]
  }): Promise<{ did: string }> {
    const body = {
      sessionKey: this.sessionKey,
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
  }): Promise<{ did: string }> {
    const body = {
      sessionKey: this.sessionKey,
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
  }): Promise<{ did: string }> {
    const body = {
      sessionKey: this.sessionKey,
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

  public getSubscriptionDetails(did: string) {
    const url = new URL(`/en/subscription/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  public getServiceDetails(did: string) {
    const url = new URL(`/en/webservice/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  public getFileDetails(did: string) {
    const url = new URL(`/en/file/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }

  public checkoutSubscription(did: string) {
    const url = new URL(`/en/subscription/checkout/${did}`, this.environment.frontend)
    window.location.href = url.toString()
  }
}
