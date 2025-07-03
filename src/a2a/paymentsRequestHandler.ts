import type {
  AgentCard,
  MessageSendParams,
  TaskState,
  ExecutionEventBusManager,
  TaskStore,
  PushNotificationConfig,
  TaskStatusUpdateEvent,
  Task,
} from '@a2a-js/sdk'
import { v4 as uuidv4 } from 'uuid'
import { AgentExecutor, DefaultRequestHandler } from '@a2a-js/sdk'
import { PaymentsError } from '../common/payments.error'
import { AgentExecutionEvent } from '@a2a-js/sdk/build/src/server/events/execution_event_bus'

const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected']

/**
 * HTTP context associated with a task or message.
 */
type HttpRequestContext = {
  bearerToken?: string
  urlRequested?: string
  httpMethodRequested?: string
}

/**
 * PaymentsRequestHandler extends DefaultRequestHandler to add payments validation and burning.
 * It validates credits before executing a task and burns credits after successful execution.
 * It also sends push notifications when a task reaches a terminal state.
 */
export class PaymentsRequestHandler extends DefaultRequestHandler {
  private paymentsService: any

  /**
   * Map to store HTTP context by taskId.
   */
  private httpContextByTaskId: Map<string, HttpRequestContext> = new Map()

  /**
   * Map to store temporary HTTP context by messageId (before taskId is known).
   */
  private httpContextByMessageId: Map<string, HttpRequestContext> = new Map()

  /**
   * Set to track which tasks already have a finalization listener attached.
   */
  private finalizedTasksWithListener: Set<string> = new Set()

  /**
   * Store HTTP context temporarily by messageId (used in middleware when taskId is not yet available).
   * @param messageId - The messageId from the incoming message
   * @param ctx - The HTTP context (bearerToken, url, method)
   */
  public setHttpRequestContextForMessage(messageId: string, ctx: HttpRequestContext) {
    this.httpContextByMessageId.set(messageId, ctx)
  }

  /**
   * Store HTTP context by taskId (used in middleware when taskId is available).
   * @param taskId - The taskId of the task
   * @param ctx - The HTTP context (bearerToken, url, method)
   */
  public setHttpRequestContextForTask(taskId: string, ctx: HttpRequestContext) {
    this.httpContextByTaskId.set(taskId, ctx)
  }

  /**
   * @param agentCard - The agent card
   * @param taskStore - The task store
   * @param agentExecutor - The business logic executor
   * @param paymentsService - The payments service for validation and burning
   * @param eventBusManager - The event bus manager (optional)
   */
  constructor(
    agentCard: AgentCard,
    taskStore: TaskStore,
    agentExecutor: AgentExecutor,
    paymentsService: any,
    eventBusManager?: ExecutionEventBusManager,
  ) {
    super(agentCard, taskStore, agentExecutor, eventBusManager)
    this.paymentsService = paymentsService
  }

  /**
   * Retrieve the HTTP context for a given taskId.
   * @param taskId - The taskId of the task
   * @returns The HTTP context (bearerToken, url, method) or undefined
   */
  private getHttpRequestContextForTask(taskId: string): HttpRequestContext | undefined {
    return this.httpContextByTaskId.get(taskId)
  }

  /**
   * Retrieve the HTTP context for a given messageId.
   * @param messageId - The messageId of the message
   * @returns The HTTP context (bearerToken, url, method) or undefined
   */
  private getHttpRequestContextForMessage(messageId: string): HttpRequestContext | undefined {
    return this.httpContextByMessageId.get(messageId)
  }

  /**
   * Sends a message, validating credits before execution and burning credits after.
   * Also sends a push notification if the task reaches a terminal state.
   * @param params - Message send parameters
   * @returns The resulting message or task
   */
  async sendMessage(params: MessageSendParams) {
    const incomingMessage = params.message

    // 1. Get HTTP context for the task or message
    const taskId = incomingMessage.taskId
    let httpContext: HttpRequestContext | undefined
    if (taskId) {
      httpContext = this.getHttpRequestContextForTask(taskId)
    } else {
      const messageId = incomingMessage.messageId
      if (messageId) {
        httpContext = this.getHttpRequestContextForMessage(messageId)
      }
    }

    if (!httpContext) {
      throw PaymentsError.internal('HTTP context not found for task or message.')
    }

    // 2. Extract bearer token
    const { bearerToken, urlRequested, httpMethodRequested } = httpContext
    if (!bearerToken || !urlRequested || !httpMethodRequested) {
      throw PaymentsError.unauthorized('Missing bearer token for payment validation.')
    }
    // 3. Validate credits before executing the task
    const agentCard = await this.getAgentCard()
    const agentId = agentCard.capabilities?.extensions?.find(
      (ext) => ext.uri === 'urn:nevermined:payment',
    )?.params?.agentId
    if (!agentId) {
      throw PaymentsError.internal('Agent ID not found in payment extension.')
    }
    try {
      const validation = await this.paymentsService.isValidRequest(
        agentId,
        bearerToken,
        urlRequested,
        httpMethodRequested,
      )
      if (!validation?.balance?.isSubscriber) {
        throw PaymentsError.paymentRequired('Insufficient credits or invalid request.')
      }
    } catch (err) {
      throw PaymentsError.paymentRequired(
        'Payment validation failed: ' + (err instanceof Error ? err.message : String(err)),
      )
    }

    if (!params.message.taskId) {
      params.message.taskId = uuidv4()
    }

    // 4. Call the base logic
    const result = await super.sendMessage(params)

    // 5. Only handle if result is a Task (not a Message)
    if (result && result.kind === 'task') {
      if (incomingMessage.messageId) {
        this.migrateHttpRequestContextFromMessageToTask(incomingMessage.messageId, result.id)
      }
      const eventBus = this.getEventBusManager().createOrGetByTaskId(result.id)
      if (!this.finalizedTasksWithListener.has(result.id)) {
        this.finalizedTasksWithListener.add(result.id)
        eventBus.on('event', (event: AgentExecutionEvent) => {
          if (event.kind === 'status-update' && terminalStates.includes(event.status?.state)) {
            this.handleTaskFinalization(event, bearerToken)
          }
        })
      }
    }
    return result
  }

  /**
   * Handles credits burning and push notification when a task reaches a terminal state.
   * This is called asynchronously from the eventBus listener.
   * @param event - The status-update event with final state
   * @param bearerToken - The bearer token for payment validation
   */
  private async handleTaskFinalization(event: TaskStatusUpdateEvent, bearerToken: string) {
    const creditsToBurn = event.metadata?.creditsUsed
    if (
      creditsToBurn !== undefined &&
      creditsToBurn !== null &&
      bearerToken &&
      (typeof creditsToBurn === 'string' ||
        typeof creditsToBurn === 'number' ||
        typeof creditsToBurn === 'bigint')
    ) {
      try {
        await this.paymentsService.redeemCreditsFromRequest(bearerToken, BigInt(creditsToBurn))
      } catch (err) {
        console.error('[Payments] Failed to redeem credits.', err)
      }
    }
    try {
      const taskPushNotificationConfig = await this.getTaskPushNotificationConfig({
        id: event.taskId,
      })
      if (taskPushNotificationConfig) {
        await this.sendPushNotification(
          event.taskId,
          event.status.state,
          taskPushNotificationConfig.pushNotificationConfig,
          { contextId: event.contextId },
        )
      }
    } catch (err) {
      console.error('[PushNotification] Failed to send push notification.', err)
    }
  }

  /**
   * Streams messages and events for a task, with payments validation.
   * Also sends a push notification if a terminal status-update event is emitted.
   * @param params - Message send parameters
   * @returns Async generator of events
   */
  async *sendMessageStream(params: MessageSendParams) {
    // 0. Get HTTP context for the task or message
    const taskId = params.message.taskId
    let httpContext: HttpRequestContext | undefined
    if (taskId) {
      httpContext = this.getHttpRequestContextForTask(taskId)
    } else {
      const messageId = params.message.messageId
      if (messageId) {
        httpContext = this.getHttpRequestContextForMessage(messageId)
      }
    }

    if (!httpContext) {
      throw PaymentsError.internal('HTTP context not found for task or message.')
    }
    const { bearerToken, urlRequested, httpMethodRequested } = httpContext
    if (!bearerToken) {
      throw PaymentsError.unauthorized('Missing bearer token for payment validation.')
    }
    const agentCard = await this.getAgentCard()
    const agentId = agentCard.capabilities?.extensions?.find(
      (ext) => ext.uri === 'urn:nevermined:payment',
    )?.params?.agentId
    if (!agentId) {
      throw PaymentsError.internal('Agent ID not found in payment extension.')
    }

    try {
      const validation = await this.paymentsService.isValidRequest(
        agentId,
        bearerToken,
        urlRequested,
        httpMethodRequested,
      )
      if (!validation?.balance?.isSubscriber) {
        throw PaymentsError.paymentRequired('Insufficient credits or invalid request.')
      }
    } catch (err) {
      throw PaymentsError.paymentRequired(
        'Payment validation failed: ' + (err instanceof Error ? err.message : String(err)),
      )
    }

    // 4. Create the task if it does not exist yet
    // If params.message.taskId is not present, create and store a new Task
    if (!params.message.taskId) {
      const newTaskId = uuidv4()
      const newContextId = params.message.contextId || uuidv4()
      const newTask: Task = {
        kind: 'task',
        id: newTaskId,
        contextId: newContextId,
        status: {
          state: 'submitted',
          timestamp: new Date().toISOString(),
        },
        history: [params.message],
        metadata: params.message.metadata,
        artifacts: [],
      }
      // Store the new task in the taskStore
      await this.getTaskStore().save(newTask)
      // Update the params.message with the new taskId and contextId
      params.message.taskId = newTaskId
      params.message.contextId = newContextId
    }

    // Call the base stream logic
    const stream = super.sendMessageStream(params)
    for await (const event of stream) {
      // 1. Handle credits burning
      if (
        event.kind === 'status-update' &&
        event.final &&
        event?.metadata?.creditsUsed !== undefined &&
        event?.metadata?.creditsUsed !== null &&
        bearerToken &&
        (typeof event.metadata.creditsUsed === 'string' ||
          typeof event.metadata.creditsUsed === 'number' ||
          typeof event.metadata.creditsUsed === 'bigint')
      ) {
        try {
          await this.paymentsService.redeemCreditsFromRequest(
            bearerToken,
            BigInt(event.metadata.creditsUsed),
          )
        } catch (err) {
          console.error('[Payments] Failed to redeem credits.', err)
        }
      }
      // 2. Handle push notification
      if (
        event.kind === 'status-update' &&
        event.final &&
        event.status?.state &&
        terminalStates.includes(event.status.state)
      ) {
        try {
          const taskPushNotificationConfig = await this.getTaskPushNotificationConfig({
            id: event.taskId,
          })
          if (taskPushNotificationConfig) {
            await this.sendPushNotification(
              event.taskId,
              event.status.state,
              taskPushNotificationConfig.pushNotificationConfig,
              {
                contextId: event.contextId,
              },
            )
          }
        } catch (err) {
          console.error('[PushNotification] Failed to send push notification.', err)
        }
      }
      yield event
    }
  }

  private async sendPushNotification(
    taskId: string,
    state: TaskState,
    pushNotificationConfig: PushNotificationConfig,
    payload: Record<string, any> = {},
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (pushNotificationConfig.authentication) {
      if (pushNotificationConfig.authentication.schemes.includes('basic')) {
        const basic = Buffer.from(`${pushNotificationConfig.authentication.credentials}`).toString(
          'base64',
        )
        headers['Authorization'] = `Basic ${basic}`
      } else if (pushNotificationConfig.authentication.schemes.includes('bearer')) {
        headers['Authorization'] = `Bearer ${pushNotificationConfig.authentication.credentials}`
      } else if (pushNotificationConfig.authentication.schemes.includes('custom')) {
        Object.assign(headers, pushNotificationConfig.authentication.credentials)
      }
    }
    const body = JSON.stringify({
      taskId,
      state,
      payload,
    })
    const response = await fetch(pushNotificationConfig.url, {
      method: 'POST',
      headers,
      body,
    })
    if (!response.ok) {
      throw PaymentsError.internal('Failed to send push notification.')
    }
  }

  /**
   * Migrates the HTTP context from a messageId to a taskId and deletes the temporary messageId context.
   * @param messageId - The messageId to migrate from
   * @param taskId - The taskId to migrate to
   */
  public migrateHttpRequestContextFromMessageToTask(messageId: string, taskId: string): void {
    const ctx = this.getHttpRequestContextForMessage(messageId)
    if (ctx) {
      this.setHttpRequestContextForTask(taskId, ctx)
      this.deleteHttpRequestContextForMessage(messageId)
    }
  }

  /**
   * Deletes the HTTP context associated with a messageId.
   * @param messageId - The messageId to delete context for
   */
  public deleteHttpRequestContextForMessage(messageId: string): void {
    this.httpContextByMessageId.delete(messageId)
  }

  /**
   * Protected getter to access the private taskStore property from the parent class.
   * This is a workaround due to SDK limitations.
   */
  protected getTaskStore(): TaskStore {
    return (this as any).taskStore as TaskStore
  }

  /**
   * Protected getter to access the private eventBusManager property from the parent class.
   * This is a workaround due to SDK limitations.
   */
  protected getEventBusManager(): ExecutionEventBusManager {
    return (this as any).eventBusManager as ExecutionEventBusManager
  }
}
