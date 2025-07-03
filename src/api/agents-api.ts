import { jsonReplacer } from '../common/helper'
import { PaymentsError } from '../common/payments.error'
import {
  AgentAPIAttributes,
  AgentMetadata,
  PaginationOptions,
  PaymentOptions,
  PlanCreditsConfig,
  PlanMetadata,
  PlanPriceConfig,
} from '../common/types'
import { BasePaymentsAPI } from './base-payments'
import {
  API_URL_GET_AGENT,
  API_URL_GET_AGENT_PLANS,
  API_URL_REGISTER_AGENT,
  API_URL_REGISTER_AGENTS_AND_PLAN,
} from './nvm-api'

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
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
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
      throw new PaymentsError(
        `Unable to register agent. ${response.statusText} - ${await response.text()}`,
      )
    }
    const agentData = await response.json()
    return { agentId: agentData.agentId }
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
   * @see https://docs.nevermined.app/docs/tutorials/builders/register-agent
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
  ): Promise<{
    agentId: string
    planId: string
    txHash: string
  }> {
    const body = {
      plan: {
        metadataAttributes: planMetadata,
        priceConfig: priceConfig,
        creditsConfig: creditsConfig,
      },
      agent: {
        metadataAttributes: agentMetadata,
        agentApiAttributes: agentApi,
      },
    }
    console.log('Registering agent and plan with body:', JSON.stringify(body, jsonReplacer))
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REGISTER_AGENTS_AND_PLAN, this.environment.backend)

    const response = await fetch(url, options)
    if (!response.ok) {
      throw new PaymentsError(
        `Unable to register agent & plan. ${response.statusText} - ${await response.text()}`,
      )
    }
    const result = await response.json()
    return {
      agentId: result.data.agentId,
      planId: result.data.planId,
      txHash: result.data.txHash,
    }
  }

  /**
   * Gets the metadata for a given Agent identifier.
   *
   * @param agentId - The unique identifier of the agent.
   * @returns A promise that resolves to the agent's metadata.
   * @throws PaymentsError if the agent is not found.
   */
  public async getAgent(agentId: string) {
    const url = new URL(API_URL_GET_AGENT.replace(':agentId', agentId), this.environment.backend)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Agent not found. ${response.statusText} - ${await response.text()}`)
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
   */
  public async getAgentPlans(agentId: string, pagination = new PaginationOptions()) {
    const query =
      API_URL_GET_AGENT_PLANS.replace(':agentId', agentId) + '?' + pagination.asQueryParams()
    const url = new URL(query, this.environment.backend)
    console.log(`Fetching plans for agent ${agentId} from ${url.toString()}`)
    const response = await fetch(url)
    if (!response.ok) {
      throw new PaymentsError(`Agent not found. ${response.statusText} - ${await response.text()}`)
    }
    return response.json()
  }
}
