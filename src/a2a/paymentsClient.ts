import { Payments } from '../index.js'
import { PaymentsError } from '../common/payments.error.js'
import {
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
} from '@a2a-js/sdk'
import { A2AClient } from '@a2a-js/sdk/client'
import { v4 as uuidv4 } from 'uuid'
import type { AgentCard } from './types.js'

/**
 * PaymentsClient is a high-level client for A2A agents with payments integration.
 * Each instance is bound to a specific agentId and planId.
 */
export class PaymentsClient extends A2AClient {
  public payments: Payments
  private readonly agentId: string
  private readonly planId: string
  private accessToken: string | null

  /**
   * Creates a new PaymentsClient instance.
   * @param agentBaseUrl - The base URL of the agent (e.g. http://localhost:3005/a2a/).
   * @param payments - The Payments object.
   * @param agentId - The ID of the agent.
   * @param planId - The ID of the plan.
   * @param agentCardPath - Optional path to the agent card relative to base URL (defaults to '.well-known/agent.json').
   */
  private constructor(agentCard: AgentCard, payments: Payments, agentId: string, planId: string) {
    super(agentCard)
    this.payments = payments
    this.agentId = agentId
    this.planId = planId
    this.accessToken = null
  }

  /**
   * Creates a PaymentsClient by fetching the AgentCard first and then
   * constructing the underlying A2AClient with the AgentCard object.
   */
  public static async create(
    agentBaseUrl: string,
    payments: Payments,
    agentId: string,
    planId: string,
    agentCardPath = '.well-known/agent.json',
  ): Promise<PaymentsClient> {
    const agentCardUrl = new URL(agentCardPath, agentBaseUrl).toString()
    const a2a = await A2AClient.fromCardUrl(agentCardUrl)
    const agentCard = await (a2a as any).getAgentCard()
    return new PaymentsClient(agentCard as AgentCard, payments, agentId, planId)
  }

  /**
   * Gets and caches the access token for this client instance.
   * @returns The access token string.
   */
  private async _getX402AccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken
    }
    const accessParams = await this.payments.x402.getX402AccessToken(this.planId, this.agentId)
    this.accessToken = accessParams.accessToken
    return this.accessToken
  }

  /**
   * Clears the cached access token for this client instance.
   */
  public clearToken() {
    this.accessToken = null
  }

  /**
   * Type guard to check if a JSON-RPC response is an error response.
   * @param response - The JSON-RPC response to check
   * @returns true if the response contains an error, false otherwise
   */
  private isErrorResponse(response: any): boolean {
    return response && typeof response === 'object' && 'error' in response
  }

  /**
   * Sends a message to the agent, managing authentication automatically.
   * @param params - The parameters for sending the message.
   * @returns The response from the agent.
   */
  public async sendA2AMessage(params: MessageSendParams): Promise<SendMessageResponse> {
    const accessToken = await this._getX402AccessToken()
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<MessageSendParams, SendMessageResponse>(
      'message/send',
      params,
      headers,
    )
  }

  /**
   * Sends a message to the agent and streams back responses using Server-Sent Events (SSE).
   * Push notification configuration can be specified in `params.configuration`.
   * Optionally, `params.message.contextId` or `params.message.taskId` can be provided.
   * Requires the agent to support streaming (`capabilities.streaming: true` in AgentCard).
   * @param params - The parameters for sending the message.
   * @returns An AsyncGenerator yielding A2AStreamEventData (Message, Task, TaskStatusUpdateEvent, or TaskArtifactUpdateEvent).
   * The generator throws an error if streaming is not supported or if an HTTP/SSE error occurs.
   */
  public async *sendA2AMessageStream(
    params: MessageSendParams,
  ): AsyncGenerator<any, void, undefined> {
    const agentCard = await (this as any).agentCardPromise
    if (!agentCard.capabilities?.streaming) {
      throw new Error(
        'Agent does not support streaming (AgentCard.capabilities.streaming is not true).',
      )
    }
    const endpoint = await (this as any)._getServiceEndpoint()
    const clientRequestId = uuidv4()
    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'message/stream',
      params: params as { [key: string]: any },
      id: clientRequestId,
    }
    const accessToken = await this._getX402AccessToken()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(rpcRequest),
    })
    if (!response.ok) {
      let errorBody = ''
      try {
        errorBody = await response.text()
        const errorJson = JSON.parse(errorBody)
        if (errorJson.error) {
          throw new Error(
            `HTTP error establishing stream for message/stream: ${response.status} ${response.statusText}. RPC Error: ${errorJson.error.message} (Code: ${errorJson.error.code})`,
          )
        }
      } catch (e: any) {
        if (e.message.startsWith('HTTP error establishing stream')) throw e
        throw new Error(
          `HTTP error establishing stream for message/stream: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`,
        )
      }
      throw new Error(
        `HTTP error establishing stream for message/stream: ${response.status} ${response.statusText}`,
      )
    }
    if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      throw new Error("Invalid response Content-Type for SSE stream. Expected 'text/event-stream'.")
    }
    // Parse and yield SSE events
    for await (const event of this._parseA2AStream(response, clientRequestId)) {
      yield event
    }
  }

  /**
   * Parses an HTTP response body as an A2A Server-Sent Event stream.
   * Each 'data' field of an SSE event is expected to be a JSON-RPC 2.0 Response object,
   * specifically a SendStreamingMessageResponse (or similar structure for resubscribe).
   * @param response -The HTTP Response object whose body is the SSE stream.
   * @param originalRequestId - The ID of the client's JSON-RPC request that initiated this stream.
   * Used to validate the `id` in the streamed JSON-RPC responses.
   * @returns An AsyncGenerator yielding the `result` field of each valid JSON-RPC success response from the stream.
   */
  private async *_parseA2AStream<TStreamItem>(
    response: Response,
    originalRequestId: number | string | null,
  ): AsyncGenerator<TStreamItem, void, undefined> {
    if (!response.body) {
      throw new Error('SSE response body is undefined. Cannot read stream.')
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = '' // Holds incomplete lines from the stream
    let eventDataBuffer = '' // Holds accumulated 'data:' lines for the current event

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // Process any final buffered event data if the stream ends abruptly after a 'data:' line
          if (eventDataBuffer.trim()) {
            const result = this._processEventData<TStreamItem>(eventDataBuffer, originalRequestId)
            yield result
          }
          break // Stream finished
        }

        buffer += value // Append new chunk to buffer
        let lineEndIndex
        // Process all complete lines in the buffer
        while ((lineEndIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.substring(0, lineEndIndex).trim() // Get and trim the line
          buffer = buffer.substring(lineEndIndex + 1) // Remove processed line from buffer

          if (line === '') {
            // Empty line: signifies the end of an event
            if (eventDataBuffer) {
              // If we have accumulated data for an event
              const result = this._processEventData<TStreamItem>(eventDataBuffer, originalRequestId)
              yield result
              eventDataBuffer = '' // Reset buffer for the next event
            }
          } else if (line.startsWith('data:')) {
            eventDataBuffer += line.substring(5).trimStart() + '\n' // Append data (multi-line data is possible)
          } else if (line.startsWith(':')) {
            // This is a comment line in SSE, ignore it.
          }
        }
      }
    } catch (error: any) {
      throw new PaymentsError(error.message, 'payments_error')
    } finally {
      reader.releaseLock() // Ensure the reader lock is released
    }
  }

  /**
   * Processes a single SSE event's data string, expecting it to be a JSON-RPC response.
   * @param jsonData - The string content from one or more 'data:' lines of an SSE event.
   * @param originalRequestId - The ID of the client's request that initiated the stream.
   * @returns The `result` field of the parsed JSON-RPC success response.
   * @throws Error if data is not valid JSON, not a valid JSON-RPC response, an error response, or ID mismatch.
   */
  private _processEventData<TStreamItem>(
    jsonData: string,
    originalRequestId: number | string | null,
  ): TStreamItem {
    if (!jsonData.trim()) {
      throw new Error('Attempted to process empty SSE event data.')
    }
    try {
      // SSE data can be multi-line, ensure it's treated as a single JSON string.
      const sseJsonRpcResponse = JSON.parse(jsonData.replace(/\n$/, ''))

      // Type assertion to SendStreamingMessageResponse, as this is the expected structure for A2A streams.
      const a2aStreamResponse: any = sseJsonRpcResponse

      if (a2aStreamResponse.id !== originalRequestId) {
        // According to JSON-RPC spec, notifications (which SSE events can be seen as) might not have an ID,
        // or if they do, it should match. A2A spec implies streamed events are tied to the initial request.
        throw new PaymentsError(
          `SSE Event's JSON-RPC response ID mismatch. Client request ID: ${originalRequestId}, event response ID: ${a2aStreamResponse.id}.`,
          'payments_error',
        )
      }

      if (this.isErrorResponse && this.isErrorResponse(a2aStreamResponse)) {
        const err = a2aStreamResponse.error
        throw new PaymentsError(
          `SSE event contained an error: ${err.message} (Code: ${err.code}) Data: ${JSON.stringify(err.data)}`,
        )
      }

      // Check if 'result' exists, as it's mandatory for successful JSON-RPC responses
      if (!('result' in a2aStreamResponse) || typeof a2aStreamResponse.result === 'undefined') {
        throw new PaymentsError(
          `SSE event JSON-RPC response is missing 'result' field. Data: ${jsonData}`,
          'payments_error',
        )
      }

      return a2aStreamResponse as TStreamItem
    } catch (e: any) {
      // Catch errors from JSON.parse or if it's an error response that was thrown by this function
      if (
        e.message.startsWith('SSE event contained an error') ||
        e.message.startsWith("SSE event JSON-RPC response is missing 'result' field")
      ) {
        throw new PaymentsError(e.message, 'payments_error')
      }

      throw new PaymentsError(
        `Failed to parse SSE event data: "${jsonData.substring(0, 100)}...". Original error: ${e.message}`,
        'payments_error',
      )
    }
  }

  /**
   * Resubscribes to a task's event stream using Server-Sent Events (SSE).
   * This is used if a previous SSE connection for an active task was broken.
   * Requires the agent to support streaming (`capabilities.streaming: true` in AgentCard).
   * @param params - Parameters containing the taskId.
   * @returns An AsyncGenerator yielding A2AStreamEventData (Message, Task, TaskStatusUpdateEvent, or TaskArtifactUpdateEvent).
   */
  public async *resubscribeA2ATask(params: TaskIdParams): AsyncGenerator<any, void, undefined> {
    const agentCard = await (this as any).agentCardPromise
    if (!agentCard.capabilities?.streaming) {
      throw new Error('Agent does not support streaming (required for tasks/resubscribe).')
    }
    const endpoint = await (this as any)._getServiceEndpoint()
    const clientRequestId = uuidv4()
    const rpcRequest = {
      jsonrpc: '2.0',
      method: 'tasks/resubscribe',
      params: params as { [key: string]: any },
      id: clientRequestId,
    }
    const accessToken = await this._getX402AccessToken()
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(rpcRequest),
    })
    if (!response.ok) {
      let errorBody = ''
      try {
        errorBody = await response.text()
        const errorJson = JSON.parse(errorBody)
        if (errorJson.error) {
          throw new Error(
            `HTTP error establishing stream for tasks/resubscribe: ${response.status} ${response.statusText}. RPC Error: ${errorJson.error.message} (Code: ${errorJson.error.code})`,
          )
        }
      } catch (e: any) {
        if (e.message.startsWith('HTTP error establishing stream')) throw e
        throw new Error(
          `HTTP error establishing stream for tasks/resubscribe: ${response.status} ${response.statusText}. Response: ${errorBody || '(empty)'}`,
        )
      }
      throw new Error(
        `HTTP error establishing stream for tasks/resubscribe: ${response.status} ${response.statusText}`,
      )
    }
    if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) {
      throw new Error(
        "Invalid response Content-Type for SSE stream on resubscribe. Expected 'text/event-stream'.",
      )
    }
    // Parse and yield SSE events
    for await (const event of this._parseA2AStream(response, clientRequestId)) {
      yield event
    }
  }

  /**
   * Retrieves a task by its ID, managing authentication automatically.
   * @param params - The parameters for the task query.
   * @returns The task response.
   */
  public async getA2ATask(params: TaskQueryParams): Promise<GetTaskResponse> {
    const accessToken = await this._getX402AccessToken()
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<TaskQueryParams, GetTaskResponse>(
      'tasks/get',
      params,
      headers,
    )
  }

  /**
   * Sets or updates the push notification configuration for a given task, managing authentication automatically.
   * @param params - The parameters for the task push notification configuration.
   * @returns The response from the agent.
   */
  public async setA2ATaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
  ): Promise<SetTaskPushNotificationConfigResponse> {
    const accessToken = await this._getX402AccessToken()
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<
      TaskPushNotificationConfig,
      SetTaskPushNotificationConfigResponse
    >('tasks/pushNotificationConfig/set', params, headers)
  }

  /**
   * Gets the push notification configuration for a given task, managing authentication automatically.
   * @param params - The parameters for the task push notification configuration.
   * @returns The response from the agent.
   */
  public async getA2ATaskPushNotificationConfig(
    params: TaskIdParams,
  ): Promise<GetTaskPushNotificationConfigResponse> {
    const accessToken = await this._getX402AccessToken()
    const headers = { Authorization: `Bearer ${accessToken}` }
    return this._postRpcRequestWithHeaders<TaskIdParams, GetTaskPushNotificationConfigResponse>(
      'tasks/pushNotificationConfig/get',
      params,
      headers,
    )
  }

  /**
   * Internal helper to make a JSON-RPC POST request with custom headers.
   * @param method - The RPC method name.
   * @param params - The parameters for the RPC method.
   * @param headers - Optional custom headers.
   * @returns The response from the agent.
   */
  protected async _postRpcRequestWithHeaders<TParams, TResponse>(
    method: string,
    params: TParams,
    headers?: Record<string, string>,
  ): Promise<TResponse> {
    const endpoint = await (this as any)._getServiceEndpoint()
    const requestId = uuidv4()
    const rpcRequest = { jsonrpc: '2.0', method, params, id: requestId }
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
      throw new PaymentsError(
        `CRITICAL: RPC response ID mismatch for method ${method}. Expected ${requestId}, got ${rpcResponse.id}. This may lead to incorrect response handling.`,
        'payments_error',
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
