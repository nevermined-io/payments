import type {
  AgentCard,
  MessageSendParams,
  TaskState,
  ExecutionEventBusManager,
  TaskStore,
  PushNotificationConfig,
  TaskStatusUpdateEvent,
  Task,
  Message,
} from '@a2a-js/sdk'
import type { HttpRequestContext } from './types'
import { v4 as uuidv4 } from 'uuid'
import { AgentExecutor, DefaultRequestHandler, ResultManager } from '@a2a-js/sdk'
import { ExecutionEventQueue } from '@a2a-js/sdk/build/src/server/events/execution_event_queue'
import { PaymentsError } from '../common/payments.error'

const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected']

/**
 * PaymentsRequestHandler extends DefaultRequestHandler to add payments validation and burning.
 * It validates credits before executing a task and burns credits after successful execution.
 * It also sends push notifications when a task reaches a terminal state.
 */
export class PaymentsRequestHandler extends DefaultRequestHandler {
  private paymentsService: any
  private httpContextByTaskId: Map<string, HttpRequestContext> = new Map()
  private httpContextByMessageId: Map<string, HttpRequestContext> = new Map()
  private asyncExecution: boolean

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
   * @param options - Handler options (asyncExecution: boolean)
   */
  constructor(
    agentCard: AgentCard,
    taskStore: TaskStore,
    agentExecutor: AgentExecutor,
    paymentsService: any,
    eventBusManager?: ExecutionEventBusManager,
    options?: { asyncExecution?: boolean },
  ) {
    super(agentCard, taskStore, agentExecutor, eventBusManager)
    this.paymentsService = paymentsService
    this.asyncExecution = options?.asyncExecution ?? false
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
   * Processes all events, calling handleTaskFinalization when a terminal status-update event is received.
   * In async mode, it can be launched in background.
   * @param taskId - The taskId of the task
   * @param resultManager - The result manager
   * @param eventQueue - The event queue
   * @param bearerToken - The bearer token for payment validation
   * @param options - Options for the finalization process (firstResultResolver, firstResultRejector)
   * @returns void
   */
  protected async processEventsWithFinalization(
    taskId: string,
    resultManager: ResultManager,
    eventQueue: ExecutionEventQueue,
    bearerToken: string,
    options?: {
      firstResultResolver?: (event: any) => void
      firstResultRejector?: (err: any) => void
    },
  ) {
    let firstResultSent = false
    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event)
        // Finalization logic after storing the task
        if (
          event.kind === 'status-update' &&
          event.final &&
          terminalStates.includes(event.status?.state)
        ) {
          await this.handleTaskFinalization(resultManager, event, bearerToken)
        }
        if (options?.firstResultResolver && !firstResultSent) {
          if (event.kind === 'message' || event.kind === 'task') {
            options.firstResultResolver(event)
            firstResultSent = true
          }
        }
      }
      if (options?.firstResultRejector && !firstResultSent) {
        options.firstResultRejector(
          new Error('Execution finished before a message or task was produced.'),
        )
      }
    } catch (error) {
      if (options?.firstResultRejector && !firstResultSent) {
        options.firstResultRejector(error)
      }
      throw error
    } finally {
      this.getEventBusManager().cleanupByTaskId(taskId)
    }
  }

  /**
   * Sends a message, validating credits before execution and burning credits after.
   * Also sends a push notification if the task reaches a terminal state.
   * This method overrides the parent implementation to allow eventBus subscription before agent execution.
   * @param params - Message send parameters
   * @returns The resulting message or task
   */
  async sendMessage(params: MessageSendParams): Promise<Message | Task> {
    // 1. Get HTTP context for the task or message
    let taskId = params.message.taskId
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

    // 2. Extract bearer token and validate presence of required fields
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
      const validation = await this.paymentsService.requests.isValidRequest(
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

    // 4. Generate taskId if not present and migrate HTTP context
    const incomingMessage = params.message
    if (!incomingMessage.messageId) {
      throw PaymentsError.internal('message.messageId is required.')
    }
    if (!taskId) {
      taskId = uuidv4()
      this.migrateHttpRequestContextFromMessageToTask(params.message.messageId, taskId)
    }

    // 5. Instantiate ResultManager and eventBus
    const resultManager = new ResultManager(this.getTaskStore())
    resultManager.setContext(incomingMessage)
    const requestContext = await this.callCreateRequestContext(incomingMessage, taskId, false)
    const finalMessageForAgent = requestContext.userMessage
    const eventBus = this.getEventBusManager().createOrGetByTaskId(taskId)
    const eventQueue = new ExecutionEventQueue(eventBus)

    // 7. Continue with the logic from the parent class
    this.getAgentExecutor()
      .execute(requestContext, eventBus)
      .catch((err: any) => {
        console.error(`Agent execution failed for message ${finalMessageForAgent.messageId}:`, err)
        // Publish a synthetic error event
        const errorTask: Task = {
          id: requestContext.task?.id || uuidv4(),
          contextId: finalMessageForAgent.contextId,
          status: {
            state: 'failed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [{ kind: 'text', text: `Agent execution error: ${err.message}` }],
              taskId: requestContext.task?.id,
              contextId: finalMessageForAgent.contextId,
            },
            timestamp: new Date().toISOString(),
          },
          history: requestContext.task?.history ? [...requestContext.task.history] : [],
          kind: 'task',
        }
        if (finalMessageForAgent) {
          if (
            !errorTask.history?.find((m: any) => m.messageId === finalMessageForAgent.messageId)
          ) {
            errorTask.history?.push(finalMessageForAgent)
          }
        }
        eventBus.publish(errorTask)
        eventBus.publish({
          kind: 'status-update',
          taskId: errorTask.id,
          contextId: errorTask.contextId,
          status: errorTask.status,
          final: true,
        })
        eventBus.finished()
      })

    if (!this.asyncExecution) {
      await this.processEventsWithFinalization(taskId, resultManager, eventQueue, bearerToken)
      const finalResult = resultManager.getFinalResult()
      if (!finalResult) {
        throw PaymentsError.internal(
          'Agent execution finished without a result, and no task context found.',
        )
      }
      return finalResult
    } else {
      // Async execution
      return new Promise((resolve, reject) => {
        this.processEventsWithFinalization(taskId, resultManager, eventQueue, bearerToken, {
          firstResultResolver: resolve,
          firstResultRejector: reject,
        })
      })
    }
  }

  /**
   * Handles credits burning and push notification when a task reaches a terminal state.
   * This is called asynchronously from the eventBus listener.
   * @param resultManager - The result manager
   * @param event - The status-update event with final state
   * @param bearerToken - The bearer token for payment validation
   */
  private async handleTaskFinalization(
    resultManager: ResultManager,
    event: TaskStatusUpdateEvent,
    bearerToken: string,
  ) {
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
        await this.paymentsService.requests.redeemCreditsFromRequest(
          event.status.message?.messageId,
          bearerToken,
          BigInt(creditsToBurn),
        )
        const task = resultManager.getCurrentTask()
        if (task) {
          task.metadata = {
            ...task.metadata,
            ...event.metadata,
          }
          await resultManager.processEvent(task)
        }
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
      const validation = await this.paymentsService.requests.isValidRequest(
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
          await this.paymentsService.requests.redeemCreditsFromRequest(
            event.status.message?.messageId,
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

  /**
   * Sends a push notification to the configured URL.
   * @param taskId - The taskId of the task
   * @param state - The state of the task
   * @param pushNotificationConfig - The push notification configuration
   * @param payload - The payload to send
   * @returns void
   */
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
   * @returns The task store
   */
  protected getTaskStore(): TaskStore {
    return (this as any).taskStore as TaskStore
  }

  /**
   * Protected getter to access the private eventBusManager property from the parent class.
   * This is a workaround due to SDK limitations.
   * @returns The event bus manager
   */
  protected getEventBusManager(): ExecutionEventBusManager {
    return (this as any).eventBusManager as ExecutionEventBusManager
  }

  /**
   * Protected getter to access the private agentExecutor property from the parent class.
   * This is a workaround due to SDK limitations.
   * @returns The agent executor
   */
  protected getAgentExecutor(): AgentExecutor {
    return (this as any).agentExecutor as AgentExecutor
  }

  /**
   * Protected getter to access the private _createRequestContext method from the parent class.
   * This is a workaround due to SDK limitations.
   * @param incomingMessage - The incoming message
   * @param taskId - The taskId
   * @param isStream - Whether the request is a stream
   * @returns The request context
   */
  protected async callCreateRequestContext(
    incomingMessage: any,
    taskId: string,
    isStream: boolean,
  ): Promise<any> {
    return await (this as any)._createRequestContext(incomingMessage, taskId, isStream)
  }

  /**
   * Protected getter to access the private _processEvents method from the parent class.
   * This is a workaround due to SDK limitations.
   * @param args - The arguments to pass to the _processEvents method
   * @returns The result of the _processEvents method
   */
  protected callProcessEvents(...args: any[]): any {
    return (this as any)._processEvents.apply(this, args)
  }
}
