import { BasePaymentsAPI } from './base-payments.js'
import {
  PaymentOptions,
  TrackAgentSubTaskDto,
  StartAgentRequest,
  NvmAPIResult,
} from '../common/types.js'
import {
  API_URL_REDEEM_PLAN,
  API_URL_INITIALIZE_AGENT,
  API_URL_TRACK_AGENT_SUB_TASK,
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
   * This method initializes an batch agent request.
   *
   * @remarks
   * This method is used to initialize an agent request.
   *
   * @param agentId - The unique identifier of the AI Agent.
   * @param accessToken - The access token provided by the subscriber to validate
   * @param urlRequested - The URL requested by the subscriber to access the agent's API.
   * @param httpMethodRequested - The HTTP method requested by the subscriber to access the agent's API.
   * @returns @see {@link StartAgentRequest} The information about the initialization of the request.
   * @throws PaymentsError if unable to initialize the agent request.
   *
   * @example
   * ```
   * onst authHeader = req.headers['authorization']
   *
   * const result = await payments.requests.startProcessingBatchRequest(
   *  agentId,
   *  authHeader,
   *  'https://api.example.com/agent-endpoint/1234',
   *  'POST'
   * )
   *
   * // {
   * //   agentRequestId: '3921032910321',
   * //   urlMatching: 'https://api.example.com/agent-endpoint/1234',
   * //   verbMatching: 'POST',
   * //   balance: {
   * //     planId: '105906633592154016712415751065660953070604027297000423385655551747721326921578',
   * //     planType: 'credits',
   * //     holderAddress: '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359',
   * //     creditsContract: '0xdd0240858fE744C3BF245DD377abBC04d1FDA443',
   * //     balance: '100',
   * //     isSubscriber: true
   * //   }
   * // }
   * ```
   */
  public async startProcessingBatchRequest(
    agentId: string,
    accessToken: string,
    urlRequested: string,
    httpMethodRequested: string,
  ): Promise<StartAgentRequest> {
    return this.startProcessingRequest(
      agentId,
      accessToken,
      urlRequested,
      httpMethodRequested,
      true,
    )
  }

  /**
   * This method initializes an agent request.
   *
   * @remarks
   * This method is used to initialize an agent request.
   *
   * @param agentId - The unique identifier of the AI Agent.
   * @param accessToken - The access token provided by the subscriber to validate
   * @param urlRequested - The URL requested by the subscriber to access the agent's API.
   * @param httpMethodRequested - The HTTP method requested by the subscriber to access the agent's API.
   * @param batch - Whether the request is a batch request.
   * @returns @see {@link StartAgentRequest} The information about the initialization of the request.
   * @throws PaymentsError if unable to initialize the agent request.
   *
   * @example
   * ```
   * onst authHeader = req.headers['authorization']
   *
   * const result = await payments.requests.startProcessingRequest(
   *  agentId,
   *  authHeader,
   *  'https://api.example.com/agent-endpoint/1234',
   *  'POST'
   * )
   *
   * // {
   * //   agentRequestId: '3921032910321',
   * //   urlMatching: 'https://api.example.com/agent-endpoint/1234',
   * //   verbMatching: 'POST',
   * //   balance: {
   * //     planId: '105906633592154016712415751065660953070604027297000423385655551747721326921578',
   * //     planType: 'credits',
   * //     holderAddress: '0x505384192Ba6a4D4b50EAB846ee67db3b9A93359',
   * //     creditsContract: '0xdd0240858fE744C3BF245DD377abBC04d1FDA443',
   * //     balance: '100',
   * //     isSubscriber: true
   * //   }
   * // }
   * ```
   */
  public async startProcessingRequest(
    agentId: string,
    accessToken: string,
    urlRequested: string,
    httpMethodRequested: string,
    batch = false,
  ): Promise<StartAgentRequest> {
    if (!agentId) {
      throw new PaymentsError('Agent ID is required')
    }
    const initializeAgentUrl = API_URL_INITIALIZE_AGENT.replace(':agentId', agentId)
    const body = {
      accessToken,
      endpoint: urlRequested,
      httpVerb: httpMethodRequested,
      batch,
    }
    const options = this.getBackendHTTPOptions('POST', body)

    const url = new URL(initializeAgentUrl, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to validate access token', await response.json())
    }

    return response.json()
  }

  /**
   * This method validates if a request sent by a user is valid to be processed by an AI Agent.
   *
   * @remarks
   * This method can can be used to build the agent authorization system.
   * @remarks
   * This method is a simplification of the `startProcessingRequest` method.
   *
   * @param agentId - The unique identifier of the AI Agent.
   * @param accessToken - The access token provided by the subscriber to validate
   * @param urlRequested - The URL requested by the subscriber to access the agent's API.
   * @param httpMethodRequested - The HTTP method requested by the subscriber to access the agent's API.
   * @returns agentRequestId The identifier of the agent request.
   * @returns isValidRequest A boolean indicating if the request is valid or not.
   * @throws PaymentsError if unable to initialize the agent request.
   *
   * @example
   * ```
   * onst authHeader = req.headers['authorization']
   *
   * const result = await payments.requests.isValidRequest(
   *  agentId,
   *  authHeader,
   *  'https://api.example.com/agent-endpoint/1234',
   *  'POST'
   * )
   *
   * // {
   * //   agentRequestId: '9878327323232',
   * //   isValidRequest: true
   * // }
   * ```
   */
  public async isValidRequest(
    agentId: string,
    accessToken: string,
    urlRequested: string,
    httpMethodRequested: string,
  ): Promise<{ agentRequestId: string; isValidRequest: boolean }> {
    const agentRequestInfo = await this.startProcessingRequest(
      agentId,
      accessToken,
      urlRequested,
      httpMethodRequested,
    )
    return {
      agentRequestId: agentRequestInfo.agentRequestId,
      isValidRequest: agentRequestInfo.balance.isSubscriber,
    }
  }

  /**
   * Allows the agent to redeem credits from a batch request.
   *
   * @param agentRequestId - The unique identifier of the agent request.
   * @param requestAccessToken - The access token of the request.
   * @param creditsToBurn - The number of credits to burn.
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to redeem credits from the request.
   *
   * @example
   * ```
   * const result = await payments.requests.redeemCreditsFromBatchRequest(
   *   'request-id-12345', // The request ID to track the operation
   *    accessToken, // The access token of the request
   *    5n // The number of credits to burn
   * )
   *
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async redeemCreditsFromBatchRequest(
    agentRequestId: string,
    requestAccessToken: string,
    creditsToBurn: bigint,
  ): Promise<NvmAPIResult> {
    return this.redeemCreditsFromRequest(agentRequestId, requestAccessToken, creditsToBurn, true)
  }

  /**
   * Allows the agent to redeem credits from a request.
   *
   * @param agentRequestId - The unique identifier of the agent request.
   * @param requestAccessToken - The access token of the request.
   * @param creditsToBurn - The number of credits to burn.
   * @param batch - Whether the request is a batch request.
   * @returns @see {@link NvmAPIResult} A promise that resolves to the result of the operation.
   * @throws PaymentsError if unable to redeem credits from the request.
   *
   * @example
   * ```
   * const result = await payments.requests.redeemCreditsFromRequest(
   *   'request-id-12345', // The request ID to track the operation
   *    accessToken, // The access token of the request
   *    5n // The number of credits to burn
   * )
   *
   * // {
   * //   txHash: '0x8d29d5769e832a35e53f80cd4e8890d941c50a09c33dbd975533debc894f2535',
   * //   success: true
   * // }
   * ```
   */
  public async redeemCreditsFromRequest(
    agentRequestId: string,
    requestAccessToken: string,
    creditsToBurn: bigint,
    batch = false,
  ): Promise<NvmAPIResult> {
    // Decode the access token to get the wallet address and plan ID
    const decodedToken = decodeAccessToken(requestAccessToken)
    if (!decodedToken) {
      throw new PaymentsError('Invalid access token provided')
    }

    // Extract wallet address and plan ID from the token
    const walletAddress = decodedToken.authToken?.sub || decodedToken.sub
    const planId = decodedToken.authToken?.planId || decodedToken.planId

    if (!walletAddress || !planId) {
      throw new PaymentsError('Missing wallet address or plan ID in access token')
    }

    const body = {
      agentRequestId,
      planId: BigInt(planId),
      redeemFrom: walletAddress,
      amount: creditsToBurn,
      batch,
    }

    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_REDEEM_PLAN, this.environment.backend)
    const response = await fetch(url, options)
    const responseBody = await response.json()
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to redeem credits from request', responseBody)
    }

    return responseBody
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
