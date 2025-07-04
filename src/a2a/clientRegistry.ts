import { Payments } from '..'
import {
  PaymentsClient,
  MessageSendParams,
  SendMessageResponse,
  TaskQueryParams,
  GetTaskResponse,
  TaskPushNotificationConfig,
  SetTaskPushNotificationConfigResponse,
  TaskIdParams,
  GetTaskPushNotificationConfigResponse,
} from './paymentsClient'
import type { ClientRegistryOptions } from './types'

/**
 * Extended PaymentsClient that stores agentId and planId internally.
 * All methods use these values automatically.
 */
export class RegisteredPaymentsClient extends PaymentsClient {
  private readonly _agentId: string
  private readonly _planId: string

  constructor(agentBaseUrl: string, payments: Payments, agentId: string, planId: string) {
    super(agentBaseUrl, payments)
    this._agentId = agentId
    this._planId = planId
  }

  /**
   * Sends a message to the agent using the stored agentId and planId.
   * @param params - Message send parameters.
   */
  public async sendAgentMessage(params: MessageSendParams): Promise<SendMessageResponse> {
    return super.sendAgentMessage(params, { agentId: this._agentId, planId: this._planId })
  }

  /**
   * Retrieves a task by its ID using the stored agentId and planId.
   * @param params - Task query parameters.
   */
  public async getAgentTask(params: TaskQueryParams): Promise<GetTaskResponse> {
    return super.getAgentTask(params, { agentId: this._agentId, planId: this._planId })
  }

  /**
   * Sets or updates the push notification configuration for a given task using the stored agentId and planId.
   * @param params - Push notification config parameters.
   */
  public async setAgentTaskPushNotificationConfig(
    params: TaskPushNotificationConfig,
  ): Promise<SetTaskPushNotificationConfigResponse> {
    return super.setAgentTaskPushNotificationConfig(params, {
      agentId: this._agentId,
      planId: this._planId,
    })
  }

  /**
   * Gets the push notification configuration for a given task using the stored agentId and planId.
   * @param params - Task ID parameters.
   */
  public async getAgentTaskPushNotificationConfig(
    params: TaskIdParams,
  ): Promise<GetTaskPushNotificationConfigResponse> {
    return super.getAgentTaskPushNotificationConfig(params, {
      agentId: this._agentId,
      planId: this._planId,
    })
  }

  /**
   * Returns the agentId associated with this client.
   */
  public get agentId(): string {
    return this._agentId
  }

  /**
   * Returns the planId associated with this client.
   */
  public get planId(): string {
    return this._planId
  }
}

/**
 * Registry for managing multiple RegisteredPaymentsClient instances by agentId+planId+baseUrl.
 * If a client does not exist for a given combination, it is created and cached.
 */
export class ClientRegistry {
  private clients: Map<string, RegisteredPaymentsClient> = new Map()
  private payments: Payments

  /**
   * Constructs a ClientRegistry.
   * @param payments - The Payments instance to use for all clients.
   */
  constructor(payments: Payments) {
    this.payments = payments
  }

  /**
   * Gets (or creates) a RegisteredPaymentsClient for the given agentBaseUrl, agentId, and planId.
   * The combination of these three is used as a unique key.
   * @param options - ClientRegistryOptions with agentBaseUrl, agentId, planId (all required).
   */
  public getClient(options: ClientRegistryOptions): RegisteredPaymentsClient {
    const { agentBaseUrl, agentId, planId } = options
    const key = `${agentBaseUrl}::${agentId}::${planId}`
    let client = this.clients.get(key)
    if (!client) {
      client = new RegisteredPaymentsClient(agentBaseUrl, this.payments, agentId, planId)
      this.clients.set(key, client)
    }
    return client
  }
}
