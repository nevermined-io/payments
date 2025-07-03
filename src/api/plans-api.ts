import { PaymentsError } from '../common/payments.error'
import {
  PaginationOptions,
  PaymentOptions,
  PlanBalance,
  PlanCreditsConfig,
  PlanCreditsType,
  PlanMetadata,
  PlanPriceConfig,
} from '../common/types'
import { getRandomBigInt, isEthereumAddress } from '../utils'
import { BasePaymentsAPI } from './base-payments'
import {
  API_URL_GET_PLAN,
  API_URL_GET_PLAN_AGENTS,
  API_URL_PLAN_BALANCE,
  API_URL_REGISTER_PLAN,
} from './nvm-api'

/**
 * The PlansAPI class provides methods to register and interact with payment plans on Nevermined.
 */
export class PlansAPI extends BasePaymentsAPI {
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
}
