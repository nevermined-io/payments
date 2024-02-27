import { EnvironmentInfo, EnvironmentName, Environments } from './environments'

export interface PaymentOptions {
  returnUrl: string
  environment: EnvironmentName
}

export interface Endpoint {
  [verb: string]: string
}

export class Payments {
  public returnUrl: string
  public environment: EnvironmentInfo
  private sessionKey?: string

  constructor(options: PaymentOptions) {
    this.returnUrl = options.returnUrl
    this.environment = Environments[options.environment]
  }

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

  public connect() {
    const url = new URL(
      `/en/login?nvm-export=session-key&returnUrl=${this.returnUrl}`,
      this.environment.frontend,
    )
    window.location.href = url.toString()
  }

  get isLoggedIn(): boolean {
    return !!this.sessionKey
  }

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

  public async createDataset({
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
    console.log(body)
    const options = {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
    const url = new URL('/api/v1/payments/dataset', this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(response.statusText)
    }

    return response.json()
  }
}
