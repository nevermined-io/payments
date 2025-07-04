import { Payments } from '..'
import {
  A2AClient,
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
} from '@a2a-js/sdk'
import type { AgentOptions } from './types'

/**
 * PaymentsClient extends the official A2AClient, adding automatic accessToken management and caching per agent.
 * The user only needs to provide planId the first time for each agent; subsequent calls require only agentId.
 */
export class PaymentsClient extends A2AClient {
  public payments: Payments
  private tokenCache: Map<string, string> = new Map()

  /**
   * Constructs a PaymentsClient instance.
   * @param agentBaseUrl - The base URL of the A2A agent.
   * @param payments - An initialized Payments instance for payment operations.
   */
  constructor(agentBaseUrl: string, payments: Payments) {
    super(agentBaseUrl)
    this.payments = payments
  }

  /**
   * Gets and caches the access token for a given agentId (and planId if needed).
   * Throws an error if the token is not cached and planId is not provided.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   * @returns The access token string.
   */
  private async _getAgentAccessToken(options: AgentOptions): Promise<string> {
    const { agentId, planId } = options
    const cached = this.tokenCache.get(agentId)
    if (cached) {
      return cached
    }
    if (!planId) {
      throw new Error(
        `No cached accessToken for agentId '${agentId}'. Please provide planId to obtain one.`,
      )
    }
    const accessParams = await this.payments.getAgentAccessToken(planId, agentId)
    this.tokenCache.set(agentId, accessParams.accessToken)
    return accessParams.accessToken
  }

  /**
   * Clears the cached access token for a given agentId.
   * @param agentId - The agent ID whose token should be cleared.
   */
  public clearAgentToken(agentId: string) {
    this.tokenCache.delete(agentId)
  }

  /**
   * Sends a message to the agent, automatically handling and caching the access token per agent.
   * @param params - Message send parameters.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async sendAgentMessage(
    params: MessageSendParams,
    options: AgentOptions,
  ): Promise<SendMessageResponse> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<MessageSendParams, SendMessageResponse>(
      'message/send',
      params,
      headers,
    )
  }

  /**
   * Retrieves a task by its ID, automatically handling the access token per agent.
   * @param params - Task query parameters.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async getAgentTask(
    params: TaskQueryParams,
    options: AgentOptions,
  ): Promise<GetTaskResponse> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<TaskQueryParams, GetTaskResponse>(
      'tasks/get',
      params,
      headers,
    )
  }

  /**
   * Sets or updates the push notification configuration for a given task, automatically handling the access token per agent.
   * @param params - Push notification config parameters.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async setAgentTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
    options: AgentOptions,
  ): Promise<SetTaskPushNotificationConfigResponse> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<
      TaskPushNotificationConfig,
      SetTaskPushNotificationConfigResponse
    >('tasks/pushNotificationConfig/set', params, headers)
  }

  /**
   * Gets the push notification configuration for a given task, automatically handling the access token per agent.
   * @param params - Task ID parameters.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async getAgentTaskPushNotificationConfig(
    params: TaskIdParams,
    options: AgentOptions,
  ): Promise<GetTaskPushNotificationConfigResponse> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<TaskIdParams, GetTaskPushNotificationConfigResponse>(
      'tasks/pushNotificationConfig/get',
      params,
      headers,
    )
  }

  /**
   * Sends a streaming message to the agent, automatically handling and caching the access token per agent.
   * @param params - Message send parameters.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async sendAgentMessageStream(
    params: MessageSendParams,
    options: AgentOptions,
  ): Promise<AsyncIterable<any>> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<MessageSendParams, any>(
      'message/stream',
      params,
      headers,
    )
  }

  /**
   * Resubscribes to a task's event stream, automatically handling the access token per agent.
   * @param params - TaskIdParams for the task to resubscribe.
   * @param options - Object containing agentId (required) and planId (required only if token is not cached).
   */
  public async resubscribeAgentTask(
    params: TaskIdParams,
    options: AgentOptions,
  ): Promise<AsyncIterable<any>> {
    const accessToken = await this._getAgentAccessToken(options)
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<TaskIdParams, any>('tasks/resubscribe', params, headers)
  }

  /**
   * Internal helper to make a JSON-RPC POST request with custom headers.
   * @param method - The RPC method name.
   * @param params - The parameters for the RPC method.
   * @param headers - Optional custom headers.
   */
  protected async _postRpcRequestWithHeaders<TParams, TResponse>(
    method: string,
    params: TParams,
    headers?: Record<string, string>,
  ): Promise<TResponse> {
    const endpoint = await (this as any)._getServiceEndpoint()
    const requestId = (this as any).requestIdCounter++
    const rpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: requestId,
    }
    const httpResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(headers || {}),
      },
      body: JSON.stringify(rpcRequest),
    })
    if (!httpResponse.ok) {
      let errorBodyText = '(empty or non-JSON response)'
      try {
        errorBodyText = await httpResponse.text()
        const errorJson = JSON.parse(errorBodyText)
        if (!errorJson.jsonrpc && errorJson.error) {
          throw new Error(
            `RPC error for ${method}: ${errorJson.error.message} (Code: ${errorJson.error.code}, HTTP Status: ${httpResponse.status}) Data: ${JSON.stringify(errorJson.error.data)}`,
          )
        } else if (!errorJson.jsonrpc) {
          throw new Error(
            `HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`,
          )
        }
      } catch (e: any) {
        if (e.message.startsWith('RPC error for') || e.message.startsWith('HTTP error for')) throw e
        throw new Error(
          `HTTP error for ${method}! Status: ${httpResponse.status} ${httpResponse.statusText}. Response: ${errorBodyText}`,
        )
      }
    }
    const rpcResponse = await httpResponse.json()
    if (rpcResponse.id !== requestId) {
      console.error(
        `CRITICAL: RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}. This may lead to incorrect response handling.`,
      )
    }
    return rpcResponse as TResponse
  }
}

export type {
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
} from '@a2a-js/sdk'
