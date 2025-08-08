import { PaymentsError } from '../common/payments.error.js'
import {
  Address,
  NvmAPIResult,
  PaginationOptions,
  PaymentOptions,
  PlanBalance,
  PlanCreditsConfig,
  PlanCreditsType,
  PlanRedemptionType,
  PlanMetadata,
  PlanPriceConfig,
  StripeCheckoutResult,
} from '../common/types.js'
import { getRandomBigInt, isEthereumAddress } from '../utils.js'
import { BasePaymentsAPI } from './base-payments.js'
import * as Plans from '../plans.js'
import {
  API_URL_REDEEM_PLAN,
  API_URL_GET_PLAN,
  API_URL_GET_PLAN_AGENTS,
  API_URL_MINT_EXPIRABLE_PLAN,
  API_URL_MINT_PLAN,
  API_URL_ORDER_PLAN,
  API_URL_PLAN_BALANCE,
  API_URL_REGISTER_PLAN,
  API_URL_STRIPE_CHECKOUT,
} from './nvm-api.js'

/**
 * The PlansAPI class provides methods to register and interact with payment plans on Nevermined.
 */
export class PlansAPI extends BasePaymentsAPI {
  /** Price helpers */
  /**
   * Builds a Fiat price configuration for a plan.
   *
   * @param amount - Amount to charge in minor units (e.g., cents) as bigint.
   * @param receiver - Wallet address that will receive the payment.
   * @returns The PlanPriceConfig representing a fiat price.
   */
  public getFiatPriceConfig(amount: bigint, receiver: Address): PlanPriceConfig {
    return Plans.getFiatPriceConfig(amount, receiver)
  }

  /**
   * Builds a crypto price configuration for a plan.
   *
   * @param amount - Amount to charge in token minor units as bigint.
   * @param receiver - Wallet address that will receive the payment.
   * @param tokenAddress - Optional ERC20 token address. If omitted, native token is assumed.
   * @returns The PlanPriceConfig representing a crypto price.
   */
  public getCryptoPriceConfig(
    amount: bigint,
    receiver: Address,
    tokenAddress?: Address,
  ): PlanPriceConfig {
    return Plans.getCryptoPriceConfig(amount, receiver, tokenAddress)
  }

  /**
   * Builds an ERC20 price configuration for a plan.
   *
   * @param amount - Amount to charge in token minor units as bigint.
   * @param tokenAddress - ERC20 token contract address.
   * @param receiver - Wallet address that will receive the payment.
   * @returns The PlanPriceConfig representing an ERC20 price.
   */
  public getERC20PriceConfig(
    amount: bigint,
    tokenAddress: Address,
    receiver: Address,
  ): PlanPriceConfig {
    return Plans.getERC20PriceConfig(amount, tokenAddress, receiver)
  }

  /**
   * Builds a FREE price configuration (no payment required).
   * @returns The PlanPriceConfig representing a free plan.
   */
  public getFreePriceConfig(): PlanPriceConfig {
    return Plans.getFreePriceConfig()
  }

  /**
   * Builds a native token price configuration for a plan.
   *
   * @param amount - Amount to charge in native token minor units as bigint.
   * @param receiver - Wallet address that will receive the payment.
   * @returns The PlanPriceConfig representing a native token price.
   */
  public getNativeTokenPriceConfig(amount: bigint, receiver: Address): PlanPriceConfig {
    return Plans.getNativeTokenPriceConfig(amount, receiver)
  }

  /** Credits helpers */
  /**
   * Builds an EXPIRABLE credits configuration (time-based access).
   *
   * @param durationOfPlan - Duration in seconds.
   * @returns The PlanCreditsConfig representing expirable credits.
   */
  public getExpirableDurationConfig(durationOfPlan: bigint): PlanCreditsConfig {
    return Plans.getExpirableDurationConfig(durationOfPlan)
  }

  /**
   * Builds a NON-EXPIRABLE credits configuration (no expiration).
   * @returns The PlanCreditsConfig representing non-expirable credits.
   */
  public getNonExpirableDurationConfig(): PlanCreditsConfig {
    return Plans.getNonExpirableDurationConfig()
  }

  /**
   * Builds a FIXED credits configuration.
   *
   * @param creditsGranted - Total credits granted by the plan.
   * @param creditsPerRequest - Credits spent per request (default 1n).
   * @returns The PlanCreditsConfig representing fixed credits.
   */
  public getFixedCreditsConfig(creditsGranted: bigint, creditsPerRequest = 1n): PlanCreditsConfig {
    return Plans.getFixedCreditsConfig(creditsGranted, creditsPerRequest)
  }

  /**
   * Builds a DYNAMIC credits configuration (range-limited per request).
   *
   * @param creditsGranted - Total credits granted by the plan.
   * @param minCreditsPerRequest - Minimum credits per request.
   * @param maxCreditsPerRequest - Maximum credits per request.
   * @returns The PlanCreditsConfig representing dynamic credits.
   */
  public getDynamicCreditsConfig(
    creditsGranted: bigint,
    minCreditsPerRequest = 1n,
    maxCreditsPerRequest = 1n,
  ): PlanCreditsConfig {
    return Plans.getDynamicCreditsConfig(creditsGranted, minCreditsPerRequest, maxCreditsPerRequest)
  }

  /**
   * Sets the redemption type in a credits configuration.
   *
   * @param creditsConfig - Credits configuration to modify.
   * @param redemptionType - Redemption type to set.
   * @returns The updated PlanCreditsConfig.
   */
  public setRedemptionType(
    creditsConfig: PlanCreditsConfig,
    redemptionType: PlanRedemptionType,
  ): PlanCreditsConfig {
    return Plans.setRedemptionType(creditsConfig, redemptionType)
  }

  /**
   * Marks whether proof is required in a credits configuration.
   *
   * @param creditsConfig - Credits configuration to modify.
   * @param proofRequired - Whether proof is required (default true).
   * @returns The updated PlanCreditsConfig.
   */
  public setProofRequired(
    creditsConfig: PlanCreditsConfig,
    proofRequired = true,
  ): PlanCreditsConfig {
    return Plans.setProofRequired(creditsConfig, proofRequired)
  }
  /**
   * This method is used to create a singleton instance of the PlansAPI class.
   *
   * @param options - The options to initialize the payments class.
   * @returns The instance of the PlansAPI class.
   */
  static getInstance(options: PaymentOptions): PlansAPI {
    return new PlansAPI(options)
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
   *  const { planId } = await payments.plans.registerPlan({ name: 'AI Assistants Plan'}, cryptoPriceConfig, creditsConfig)
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
   *  const { planId } = await payments.plans.registerCreditsPlan(
   *     { name: 'AI Credits Plan'},
   *     cryptoPriceConfig,
   *     creditsConfig
   * )
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
   *  const { planId } = await payments.plans.registerTimePlan(
   *    { name: 'Just for today plan'},
   *    cryptoPriceConfig,
   *    1dayDurationPlan
   *  )
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
   *  const { planId } = await payments.plans.registerCreditsTrialPlan(
   *    {name: 'Trial plan'},
   *    freePriceConfig,
   *    1dayDurationPlan
   * )
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
   *  const { planId } = await payments.plans.registerTimeTrialPlan(
   *    {name: '1 day Trial plan'},
   *    freePriceConfig,
   *    1dayDurationPlan
   * )
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
   * Gets the information about a Payment Plan by its identifier.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves to the plan's description.
   * @throws PaymentsError if the plan is not found.
   * @example
   * ```
   *  const plan = payments.plans.getPlan(planId)
   * ```
   */
  public async getPlan(planId: string) {
    const query = API_URL_GET_PLAN.replace(':planId', planId)
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Plan not found', await response.json())
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
   *
   * @example
   * ```
   *  const result = payments.plans.getAgentsAssociatedToAPlan(planId)
   *  // {
   *  //  total: 10,
   *  //  page: 1,
   *  //  offset: 5,
   *  //  agents: [ ..]
   *  // }
   * ```
   */
  public async getAgentsAssociatedToAPlan(planId: string, pagination = new PaginationOptions()) {
    const query =
      API_URL_GET_PLAN_AGENTS.replace(':planId', planId) + '?' + pagination.asQueryParams()
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Plan not found', await response.json())
    }
    return response.json()
  }

  /**
   * Gets the balance of an account for a Payment Plan.
   *
   * @param planId - The identifier of the Payment Plan.
   * @param accountAddress - The address of the account to get the balance for.
   * @returns @see {@link PlanBalance} A promise that resolves to the balance result.
   * @throws PaymentsError if unable to get the balance.
   *
   * ```
   * const balance = payments.plans.getPlanBalance(planId)
   * // {
   * //     planId: '105906633592154016712415751065660953070604027297000423385655551747721326921578',
   * //     planType: 'credits',
   * //     holderAddress: '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359',
   * //     creditsContract: '0xdd0240858fE744C3BF245DD377abBC04d1FDA443',
   * //     balance: '100',
   * //     isSubscriber: true
   * //   }
   * ```
   *
   */
  public async getPlanBalance(planId: string, accountAddress?: Address): Promise<PlanBalance> {
    const holderAddress = isEthereumAddress(accountAddress)
      ? accountAddress
      : this.getAccountAddress()

    if (!holderAddress) {
      throw new PaymentsError('Holder address is required')
    }

    const balanceUrl = API_URL_PLAN_BALANCE.replace(':planId', planId).replace(
      ':holderAddress',
      holderAddress,
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
      throw PaymentsError.fromBackend('Unable to get balance', await response.json())
    }

    return response.json()
  }

  /**
   * Orders a Payment Plan requiring the payment in crypto. The user must have enough balance in the selected token.
   *
   * @remarks
   * The payment is done using crypto in the token (ERC20 or native) defined in the plan.
   *
   * @param planId - The unique identifier of the plan.
   * @returns  @see {@link NvmAPIResult} A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if unable to order the plan.
   *
   * @example
   * ```
   * const result = await payments.plans.orderPlan(planId)
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async orderPlan(planId: string): Promise<NvmAPIResult> {
    const options = this.getBackendHTTPOptions('POST')
    const url = new URL(API_URL_ORDER_PLAN.replace(':planId', planId), this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to order plan', await response.json())
    }

    return response.json()
  }

  /**
   * Initiates the purchase of a Plan requiring the payment in Fiat. This method will return a URL where the user can complete the payment.
   *
   * @remarks
   * The payment is completed using a credit card in a external website (Stripe).
   * @remarks
   * This method is only valid for plans with price in Fiat.
   *
   * @param planId - The unique identifier of the plan.
   * @returns A promise that resolves indicating the URL to complete the payment.
   * @throws PaymentsError if unable to order the plan.
   *
   * @example
   * ```
   * const result = await payments.plans.orderFiatPlan(planId)
   * ```
   */
  public async orderFiatPlan(planId: string): Promise<{ result: StripeCheckoutResult }> {
    const body = {
      sessionType: 'embedded',
      planId,
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_STRIPE_CHECKOUT, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to order fiat plan', await response.json())
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
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to mint credits.
   *
   * @example
   * ```
   * const result = await payments.plans.mintPlanCredits(planId, 5n, '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359')
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async mintPlanCredits(
    planId: string,
    creditsAmount: bigint,
    creditsReceiver: Address,
  ): Promise<NvmAPIResult> {
    const body = { planId, amount: creditsAmount, creditsReceiver }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_MINT_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to mint plan credits', await response.json())
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
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to mint expirable credits.
   *
   * @example
   * ```
   * const result = await payments.plans.mintPlanExpirable(
   *    planId,
   *    1n,
   *    '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359',
   *    86_400n // 1 day in seconds
   *  )
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async mintPlanExpirable(
    planId: string,
    creditsAmount: bigint,
    creditsReceiver: Address,
    creditsDuration = 0n,
  ): Promise<NvmAPIResult> {
    const body = { planId, amount: creditsAmount, creditsReceiver, duration: creditsDuration }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_MINT_EXPIRABLE_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to mint expirable credits', await response.json())
    }

    return response.json()
  }

  /**
   * Burns/redeem credits for a given Payment Plan.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param agentRequestId - The unique identifier of the agent request to track the operation. This ID is generated via the `requests.startProcessingRequest` method
   * @param planId - The unique identifier of the Payment Plan.
   * @param redeemFrom - The address of the account to redeem from.
   * @param creditsAmountToRedeem - The amount of credits to redeem.
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to burn credits.
   *
   * ```
   * const result = await payments.plans.redeemCredits(
   *   'request-id-12345', // The request ID to track the operation
   *    planId,
   *    '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359', // The address of the account to redeem from
   *    5n
   * )
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async redeemCredits(
    agentRequestId: string,
    planId: string,
    redeemFrom: Address,
    creditsAmountToRedeem: string,
  ): Promise<NvmAPIResult> {
    const body = {
      agentRequestId,
      planId,
      redeemFrom,
      creditsAmoamountuntToBurn: creditsAmountToRedeem,
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REDEEM_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to redeem credits', await response.json())
    }

    return response.json()
  }
}
