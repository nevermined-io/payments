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
      console.log('sessionKey:', sessionKey)
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

  public async createWebservice({
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
    console.log(body)
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/webservice', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }
}
