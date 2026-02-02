import { PaymentsError } from '../common/payments.error.js'
import {
  AgentAPIAttributes,
  AgentMetadata,
  NvmAPIResult,
  PaginationOptions,
  PaymentOptions,
  PlanCreditsConfig,
  PlanMetadata,
  PlanPriceConfig,
} from '../common/types.js'
import { BasePaymentsAPI } from './base-payments.js'
import {
  API_URL_ADD_PLAN_AGENT,
  API_URL_GET_AGENT,
  API_URL_GET_AGENT_PLANS,
  API_URL_REGISTER_AGENT,
  API_URL_REGISTER_AGENTS_AND_PLAN,
  API_URL_REMOVE_PLAN_AGENT,
  API_URL_UPDATE_AGENT,
} from './nvm-api.js'

/**
 * The AgentsAPI class provides methods to register and interact with AI Agents on Nevermined.
 */
export class AgentsAPI extends BasePaymentsAPI {
  /**
   * This method is used to create a singleton instance of the AgentsAPI class.
   *
   * @param options - The options to initialize the payments class.
   * @returns The instance of the AgentsAPI class.
   */
  static getInstance(options: PaymentOptions): AgentsAPI {
    return new AgentsAPI(options)
  }

  /**
   *
   * It registers a new AI Agent on Nevermined.
   * The agent must be associated to one or multiple Payment Plans. Users that are subscribers of a payment plan can query the agent.
   * Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://nevermined.ai/docs/tutorials/builders/register-agent
   *
   * @param agentMetadata - @see {@link AgentMetadata}
   * @param agentApi - @see {@link AgentAPIAttributes}
   * @param paymentPlans - the list of payment plans giving access to the agent.
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
   *  const agentApi = { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' }] }
   *  const paymentPlans = [planId]
   *
   *  const { agentId } = await payments.agents.registerAgent(agentMetadata, agentApi, paymentPlans)
   * ```
   *
   * @returns The unique identifier of the newly created agent (Agent Id).
   */
  public async registerAgent(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    paymentPlans: string[],
  ): Promise<{ agentId: string }> {
    const body = {
      metadataAttributes: agentMetadata,
      agentApiAttributes: agentApi,
      plans: paymentPlans,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_AGENT, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to register agent', await response.json())
    }
    const agentData = await response.json()
    return { agentId: agentData.data.agentId }
  }

  /**
   *
   * It registers a new AI Agent and a Payment Plan associated to this new agent.
   * Depending on the Payment Plan and the configuration of the agent, the usage of the agent/service will consume credits.
   * When the plan expires (because the time is over or the credits are consumed), the user needs to renew the plan to continue using the agent.
   *
   * @remarks This method is oriented to AI Builders
   * @remarks To call this method, the NVM API Key must have publication permissions
   *
   * @see https://nevermined.ai/docs/tutorials/builders/register-agent
   *
   * @param agentMetadata - @see {@link AgentMetadata}
   * @param agentApi - @see {@link AgentAPIAttributes}
   * @param planMetadata - @see {@link PlanMetadata}
   * @param priceConfig - @see {@link PlanPriceConfig}
   * @param creditsConfig - @see {@link PlanCreditsConfig}
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My AI Payments Agent', tags: ['test'] }
   *  const agentApi { endpoints: [{ 'POST': 'https://example.com/api/v1/agents/:agentId/tasks' }] }
   *  const cryptoPriceConfig = getNativeTokenPriceConfig(100n, builderAddress)
   *  const 1dayDurationPlan = getExpirableDurationConfig(ONE_DAY_DURATION)
   *  const { agentId, planId } = await payments.agents.registerAgentAndPlan(
   *    agentMetadata,
   *    agentApi,
   *    cryptoPriceConfig,
   *    1dayDurationPlan
   *  )
   * ```
   *
   * @returns The unique identifier of the newly created agent (agentId).
   * @returns The unique identifier of the newly created plan (planId).
   */
  public async registerAgentAndPlan(
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
    planMetadata: PlanMetadata,
    priceConfig: PlanPriceConfig,
    creditsConfig: PlanCreditsConfig,
    accessLimit?: 'credits' | 'time',
  ): Promise<{
    agentId: string
    planId: string
    txHash: string
  }> {
    if (accessLimit && !['credits', 'time'].includes(accessLimit)) {
      throw new PaymentsError(
        'Invalid access limit',
        'accessLimit must be either "credits" or "time"',
      )
    }
    if (!accessLimit) {
      accessLimit = creditsConfig.durationSecs > 0n ? 'time' : 'credits'
    }
    const body = {
      plan: {
        metadataAttributes: planMetadata,
        priceConfig: priceConfig,
        creditsConfig: creditsConfig,
        accessLimit,
      },
      agent: {
        metadataAttributes: agentMetadata,
        agentApiAttributes: agentApi,
      },
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_AGENTS_AND_PLAN, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to register agent & plan', await response.json())
    }
    const result = await response.json()
    return {
      agentId: result.data.agentId,
      planId: result.data.planId,
      txHash: result.txHash,
    }
  }

  /**
   * Gets the metadata for a given Agent identifier.
   *
   * @param agentId - The unique identifier of the agent.
   * @returns A promise that resolves to the agent's metadata.
   * @throws PaymentsError if the agent is not found.
   *
   * @example
   * ```
   *  const plan = payments.agents.getAgent(agentId)
   * ```
   */
  public async getAgent(agentId: string) {
    const url = new URL(API_URL_GET_AGENT.replace(':agentId', agentId), this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Agent not found', await response.json())
    }
    return response.json()
  }

  /**
   * Updates the metadata and API attributes of an existing AI Agent.
   *
   * @param agentId - The unique identifier of the agent.
   * @param agentMetadata - The new metadata attributes for the agent.
   * @param agentApi - The new API attributes for the agent.
   * @returns  @see {@link NvmAPIResult} A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if the agent is not found or if the update fails.
   *
   * @example
   * ```
   *  const agentMetadata = { name: 'My Updated Agent', tags: ['test'] }
   *  const agentApi = { endpoints: [{ 'POST': 'https://nevermined.app/api/v1/agents/:agentId/tasks' }] }
   *
   *  await payments.agents.updateAgentMetadata(agentId, agentMetadata, agentApi)
   * ```
   */
  public async updateAgentMetadata(
    agentId: string,
    agentMetadata: AgentMetadata,
    agentApi: AgentAPIAttributes,
  ): Promise<NvmAPIResult> {
    const body = {
      metadataAttributes: agentMetadata,
      agentApiAttributes: agentApi,
    }
    const url = new URL(API_URL_UPDATE_AGENT.replace(':agentId', agentId), this.environment.backend)
    const options = this.getBackendHTTPOptions('PUT', body)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Error updating agent', await response.json())
    }
    return response.json()
  }

  /**
   * Gets the list of plans that can be ordered to get access to an agent.
   *
   * @param agentId - The unique identifier of the agent.
   * @param pagination - Optional pagination options to control the number of results returned.p
   * @returns A promise that resolves to the list of all different plans giving access to the agent.
   * @throws PaymentsError if the agent is not found.
   *
   * @example
   * ```
   *  const result = payments.agents.getAgentPlans(planId)
   *  // {
   *  //  total: 10,
   *  //  page: 1,
   *  //  offset: 5,
   *  //  plans: [ ..]
   *  // }
   * ```
   */
  public async getAgentPlans(agentId: string, pagination = new PaginationOptions()) {
    const query =
      API_URL_GET_AGENT_PLANS.replace(':agentId', agentId) + '?' + pagination.asQueryParams()
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Agent not found', await response.json())
    }
    return response.json()
  }

  /**
   * Adds an existing Payment Plan to an AI Agent.
   * After this operation, users with access to the Payment Plan will be able to access the AI Agent.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentId - The unique identifier of the AI Agent.
   * @returns  @see {@link NvmAPIResult} A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if unable to add the plan to the agent.
   *
   * @example
   * ```
   * const result = await payments.agents.addPlanToAgent(planId, agentId)
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async addPlanToAgent(planId: string, agentId: string): Promise<NvmAPIResult> {
    const options = this.getBackendHTTPOptions('POST')
    const endpoint = API_URL_ADD_PLAN_AGENT.replace(':planId', planId).replace(':agentId', agentId)
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to add plan to agent', await response.json())
    }

    return response.json()
  }

  /**
   * Removes a Payment Plan from an AI Agent.
   * After this operation, users with access to the Payment Plan will no longer be able to access the AI Agent.
   *
   * @remarks
   * Only the owner of the Payment Plan can call this method.
   *
   * @param planId - The unique identifier of the Payment Plan.
   * @param agentId - The unique identifier of the AI Agent.
   * @returns  @see {@link NvmAPIResult} A promise that resolves indicating if the operation was successful.
   * @throws PaymentsError if unable to remove the plan from the agent.
   *
   * @example
   * ```
   * const result = await payments.agents.removePlanFromAgent(planId, agentId)
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async removePlanFromAgent(planId: string, agentId: string): Promise<NvmAPIResult> {
    const options = this.getBackendHTTPOptions('DELETE')
    const endpoint = API_URL_REMOVE_PLAN_AGENT.replace(':planId', planId).replace(
      ':agentId',
      agentId,
    )
    const url = new URL(endpoint, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to remove plan from agent', await response.json())
    }

    return response.json()
  }
}
