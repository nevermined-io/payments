import { BasePaymentsAPI } from './base-payments.js'
import {
  PaymentOptions,
  TrackAgentSubTaskDto,
  StartAgentRequest,
  NvmAPIResult,
  SimulationRequestOptions,
} from '../common/types.js'
import {
  API_URL_TRACK_AGENT_SUB_TASK,
  API_URL_SIMULATE_AGENT_REQUEST,
  API_URL_SIMULATE_REDEEM_AGENT_REQUEST,
} from './nvm-api.js'
import { PaymentsError } from '../common/payments.error.js'
import { decodeAccessToken } from '../utils.js'

/**
 * The AgentRequestsAPI class provides methods to manage the requests received by AI Agents integrated with Nevermined.
 *
 */
export class AgentRequestsAPI extends BasePaymentsAPI {
  /**
   * This method is used to create a singleton instance of the AgentRequestsAPI class.
   *
   * @param options - The options to initialize the payments class.
   * @returns The instance of the AgentRequestsAPI class.
   */
  static getInstance(options: PaymentOptions): AgentRequestsAPI {
    return new AgentRequestsAPI(options)
  }


  /**
   * This method simulates an agent request.
   *
   * @remarks
   * This method is used to simulate an agent request.
   *
   * @param opts - The options for the simulation request.
   * @returns @see {@link StartAgentRequest} The information about the simulation of the request.
   * @throws PaymentsError if unable to simulate the agent request.
   *
   * @example
   * ```
   * const result = await payments.requests.startSimulationRequest()
   *
   * // {
   * //   agentRequestId: '3921032910321',
   * //   urlMatching: 'https://api.example.com/agent-endpoint/1234',
   * //   verbMatching: 'POST'
   * // }
   * ```
   */
  public async startSimulationRequest(
    opts: SimulationRequestOptions = {},
  ): Promise<StartAgentRequest> {
    const url = new URL(API_URL_SIMULATE_AGENT_REQUEST, this.environment.backend).toString()
    const options = this.getBackendHTTPOptions('POST', opts)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to start simulation request', await response.json())
    }
    return response.json()
  }

  /**
   * This method simulates the redemption of credits for an agent request.
   *
   * @remarks
   * This method is used to simulate the redemption of credits for an agent request.
   *
   * @param agentRequestId - The unique identifier of the agent request.
   * @param marginPercent - The margin percentage to apply. Defaults to 20%.
   * @param batch - Whether the request is a batch request. Defaults to false.
   * @returns @see {@link NvmAPIResult} The result of the simulation.
   * @throws PaymentsError if unable to finish the simulation request.
   *
   * @example
   * ```
   * const result = await payments.requests.finishSimulationRequest('arId-3921032910321', 0.2, true)
   *
   * // {
   * //   creditsToRedeem: '10',
   * //   success: true
   * // }
   * ```
   */
  public async finishSimulationRequest(
    agentRequestId: string,
    marginPercent = 0.2,
    batch = false,
  ): Promise<NvmAPIResult> {
    const url = new URL(API_URL_SIMULATE_REDEEM_AGENT_REQUEST, this.environment.backend).toString()
    const options = this.getBackendHTTPOptions('POST', {
      agentRequestId,
      marginPercent,
      batch,
    })

    // Since this method is usually called immediately after the llm call
    // the request might not be immediately available on helicone, so we need to retry.
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, options)
        if (!response.ok) {
          lastError = PaymentsError.fromBackend(
            'Unable to finish simulation request',
            await response.json(),
          )
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000))
            continue
          }
          throw lastError
        }
        return response.json()
      } catch (error) {
        if (error instanceof PaymentsError) {
          lastError = error
        } else {
          lastError = PaymentsError.fromBackend('Unable to finish simulation request', {
            error: String(error),
          })
        }
        if (attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
          continue
        }
        throw lastError
      }
    }

    // This should never be reached, but TypeScript requires it
    throw lastError || new PaymentsError('Unable to finish simulation request')
  }


  /**
   * Tracks an agent sub task.
   *
   * @remarks
   * This method is used by agent owners to track agent sub tasks for agent tasks.
   * It records information about credit redemption, categorization tags, and processing descriptions.
   *
   * @param trackAgentSubTask - @see {@link TrackAgentSubTaskDto} The agent sub task data to track
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to track the agent sub task
   *
   * @example
   * ```
   * const result = await payments.requests.trackAgentSubTask({
   *   agentRequestId: 'atx-12345',
   *   creditsToRedeem: 5,
   *   tag: 'high-priority',
   *   description: 'Processing high-priority data request',
   *   status: AgentTaskStatus.SUCCESS
   * })
   *
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async trackAgentSubTask(trackAgentSubTask: TrackAgentSubTaskDto): Promise<NvmAPIResult> {
    const body = {
      agentRequestId: trackAgentSubTask.agentRequestId,
      creditsToRedeem: trackAgentSubTask.creditsToRedeem || 0,
      tag: trackAgentSubTask.tag,
      description: trackAgentSubTask.description,
      status: trackAgentSubTask.status,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_TRACK_AGENT_SUB_TASK, this.environment.backend)
    const response = await fetch(url, options)

    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to track agent sub task', await response.json())
    }

    return response.json()
  }
}
