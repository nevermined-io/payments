import { EnvironmentName } from '../environments.js'

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
  nvmApiKey: string

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

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export type Address = `0x${string}`

/**
 * Definition of the price configuration for a Payment Plan
 */
export interface PlanPriceConfig {
  /**
   * The type or configuration of the price
   * @remarks 0 - crypto fixed price. 1 - fixed fiat price. 2 - smart contract price
   */
  priceType: PlanPriceType
  /**
   * The address of the token (ERC20 or Native if zero address) for paying the plan
   * @remarks only if priceType == FIXED_PRICE or SMART_CONTRACT_PRICE
   */
  tokenAddress?: Address
  /**
   * The amounts to be paid for the plan
   * @remarks only if priceType == FIXED_PRICE or FIXED_FIAT_PRICE
   */
  amounts: bigint[]
  /**
   * The receivers of the payments of the plan
   * @remarks only if priceType == FIXED_PRICE
   */
  receivers: string[]
  /**
   * The address of the smart contract that calculates the price
   * @remarks only if priceType == SMART_CONTRACT_PRICE
   */
  contractAddress?: Address // only if priceType == 2
  /**
   * The address of the fee controller contract, if any
   * @remarks if not given, the fee controller is the default one
   */
  feeController?: Address // only if priceType == 2
}

/**
 * Definition of the credits configuration for a payment plan
 */
export interface PlanCreditsConfig {
  /**
   * The type of configuration of the credits type
   */
  creditsType: PlanCreditsType
  /**
   * How the credits can be redeemed
   */
  redemptionType: PlanRedemptionType
  /**
   * Whether the credits burn proof signed by the user is required
   */
  proofRequired: boolean
  /**
   * The duration of the credits in seconds
   * @remarks only if creditsType == EXPIRABLE
   */
  durationSecs: bigint
  /**
   * The amount of credits that are granted when purchasing the plan
   */
  amount: bigint
  /**
   * The minimum number of credits redeemed when using the plan
   * @remarks only if creditsType == FIXED or DYNAMIC
   */
  minAmount: bigint
  /**
   * The maximum number of credits redeemed when using the plan
   * @remarks only if creditsType == DYNAMIC
   */
  maxAmount: bigint
  /**
   * The address of the NFT contract that represents the plan's credits
   */
  nftAddress?: Address
}

/**
 * Different types of prices that can be configured for a plan
 * @remarks 0 - FIXED_PRICE, 1 - FIXED_FIAT_PRICE, 2 - SMART_CONTRACT_PRICE
 * If FIXED_PRICE it means the plan can be paid in crypto by a fixed amount of a ERC20 or Native token
 * If FIXED_FIAT_PRICE it means the plan can be paid in fiat by a fixed amount (typically USD)
 * If SMART_CONTRACT_PRICE it means the plan can be paid in crypto and the amount to be paid is calculated by a smart contract
 */
export enum PlanPriceType {
  FIXED_PRICE,
  FIXED_FIAT_PRICE,
  SMART_CONTRACT_PRICE,
}

/**
 * Different types of credits that can be obtained when purchasing a plan
 * @remarks 0 - EXPIRABLE, 1 - FIXED, 2 - DYNAMIC
 * If EXPIRABLE it means the credits can be used for a fixed amount of time (calculated in seconds)
 * If FIXED it means the credits can be used for a fixed amount of times
 * If DYNAMIC it means the credits can be used but the redemption amount is dynamic
 */
export enum PlanCreditsType {
  EXPIRABLE,
  FIXED,
  DYNAMIC,
}

/**
 * Different types of redemptions criterias that can be used when redeeming credits
 * @remarks 0 - ONLY_GLOBAL_ROLE, 1 - ONLY_OWNER, 2 - ROLE_AND_OWNER
 * If ONLY_GLOBAL_ROLE it means the credits can be redeemed only by an account with the `CREDITS_BURNER_ROLE`
 * If ONLY_OWNER it means the credits can be redeemed only by the owner of the Plan
 * If ONLY_PLAN_ROLE it means the credits can be redeemed by an account with specifics grants for the plan
 */
export enum PlanRedemptionType {
  ONLY_GLOBAL_ROLE, // NVM Proxy can burn
  ONLY_OWNER, // Agent can burn
  ONLY_PLAN_ROLE,
}

export interface PlanBalance {
  planId: string
  planName: string
  planType: string
  holderAddress: Address
  balance: bigint
  creditsContract: Address
  isSubscriber: boolean
  pricePerCredit: number
}

export interface StartAgentRequest {
  agentRequestId: string
  agentName: string
  agentId: string
  balance: PlanBalance
  urlMatching: string
  verbMatching: string
}

export interface ValidationAgentRequest {
  balance: PlanBalance
  urlMatching: string
  verbMatching: string
}

export interface AgentAccessCredentials {
  accessToken: string
  proxies?: string[]
}

export interface SubscriberRequestStatus {
  planId: string
  agentId: string
  isValid: boolean
  code: number
  message?: string
}

export interface NvmAPIResult {
  success: boolean
  message?: string
  txHash?: string
  httpStatus?: number
  data?: APIOutputData
  when?: Date
}

export interface APIOutputData {
  [key: string]: any
}

export interface StripeCheckoutResult {
  stripeCheckoutSessionId: string
  checkoutLink: string
  clientReferenceId: string
  paymentStatus?: string
  linkCreatedAt: number
  linkExpiresAt: number
}

/**
 * Metadata attributes describing the AI Agent.
 */
export interface AgentMetadata {
  /**
   * Name of the Agent
   */
  name: string
  /**
   * Description of the Agent
   */
  description?: string
  /**
   * The author of the Agent (organization or person) that own the Agent.
   */
  author?: string
  /**
   * The author of the Agent (organization or person) that own the Agent.
   */
  license?: string
  /**
   * Tags describing the AI Agent
   */
  tags?: string[]
  /**
   * Some description or instructions about how to integrate the Agent.
   */
  integration?: string
  /**
   * A link to some same usage of the Agent.
   */
  sampleLink?: string
  /**
   * Text describing the API of the Agent.
   */
  apiDescription?: string
  /**
   * The date when the Agent was created.
   */
  dateCreated?: Date

  // internalAttributes?: any
}

/**
 * Metadata attributes describing the Payment Plan.
 */
export interface PlanMetadata extends AgentMetadata {
  /**
   * Indicates if a payment plan is a Trial plan.
   * A Trial plan is a plan that allows users to test the AI Agents associated with it typically without any cost.
   * @remarks A Trial plan only can be purchased once by a user.
   */
  isTrialPlan?: boolean
}

/**
 * It describes the API exposed by an AI Agent.
 * This information is necessary to query the AI Agent and to know which endpoints are available.
 */
export interface AgentAPIAttributes {
  /**
   * The list endpoints of the upstream service. All these endpoints are protected and only accessible to subscribers of the Payment Plan.
   */
  endpoints: Endpoint[]
  /**
   * The list of endpoints of the upstream service that publicly available. The access to these endpoints don't require subscription to the Payment Plan. They are useful to expose documentation, etc.
   */
  openEndpoints?: string[]
  /**
   * The URL to the OpenAPI description of the Upstream API. The access to the OpenAPI definition don't require subscription to the Payment Plan.
   */
  openApiUrl?: string

  /////// AUTHORIZATION ///////

  /**
   * The upstream agent/service authentication type ('none', 'basic', 'bearer' or 'oauth').
   */
  authType?: 'none' | 'basic' | 'oauth' | 'bearer'
  /**
   * The upstream agent/service username for authentication. Only if `authType` is 'basic'.
   */
  username?: string
  /**
   * The upstream agent/service password for authentication. Only if `authType` is 'basic'.
   */
  password?: string
  /**
   * The upstream agent/service bearer token for authentication. Only if `authType` is 'bearer' or 'oauth'.
   */
  token?: string
}

/**
 * Options for pagination in API requests to the Nevermined API.
 */
export class PaginationOptions {
  /**
   * The field to sort the results by.
   * If not provided, the default sorting defined by the API will be applied.
   */
  sortBy?: string
  /**
   * The order in which to sort the results.
   * Default is 'desc' (descending).
   */
  sortOrder: 'asc' | 'desc' = 'desc'
  /**
   * The page number to retrieve.
   * Default is 1.
   */
  page = 1
  /**
   * The number of items per page.
   * Default is 10.
   */
  offset = 10

  /**
   * Constructs a new PaginationOptions instance.
   * @param options - Optional initial values for the pagination options.
   */
  constructor(options?: Partial<PaginationOptions>) {
    if (options) {
      this.sortBy = options.sortBy
      this.sortOrder = options.sortOrder || 'desc'
      this.page = options.page || 1
      this.offset = options.offset || 10
    }
  }

  /**
   * It returns a string representation of the pagination options
   * @returns A string representation of the pagination options as URL query parameters.
   * This can be used to append to API requests for pagination.
   */
  asQueryParams(): string {
    const params: Record<string, string> = {}
    if (this.sortBy) {
      params.sortBy = this.sortBy
    }
    params.sortOrder = this.sortOrder
    params.page = this.page.toString()
    params.pageSize = this.offset.toString()

    return new URLSearchParams(params).toString()
  }
}

/**
 * Status of an agent task
 */
export enum AgentTaskStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  PENDING = 'PENDING',
}

/**
 * Data transfer object for tracking agent sub tasks
 */
export interface TrackAgentSubTaskDto {
  /**
   * The unique identifier of the agent task
   */
  agentRequestId: string

  /**
   * The number of credits burned in this agent sub task (optional)
   * @defaultValue 0
   */
  creditsToRedeem?: number

  /**
   * A tag to categorize this agent sub task (optional)
   */
  tag?: string

  /**
   * A description of this agent sub task (optional)
   */
  description?: string

  /**
   * The status of the agent sub task (optional)
   */
  status?: AgentTaskStatus
}
