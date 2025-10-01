import type {
  AgentCard,
  MessageSendParams,
  TaskState,
  PushNotificationConfig,
  TaskStatusUpdateEvent,
  Task,
  Message,
} from '@a2a-js/sdk'
import {
  AgentExecutor,
  DefaultRequestHandler,
  ResultManager,
  ExecutionEventQueue,
} from '@a2a-js/sdk/server'
import type { ExecutionEventBusManager, TaskStore } from '@a2a-js/sdk/server'
import { A2AError } from '@a2a-js/sdk/server'
import type {
  HttpRequestContext,
  PaymentsRequestContext,
  AgentRequestContext,
  A2AAuthResult,
  A2AStreamEvent,
} from './types.js'
import { StartAgentRequest } from '../common/types.js'
import { PaymentsError } from '../common/payments.error.js'
import { Payments } from '../payments.js'
import { v4 as uuidv4 } from 'uuid'

const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected']

/**
 * PaymentsRequestHandler extends DefaultRequestHandler to add payments validation and burning.
 * It validates credits before executing a task and burns credits after successful execution.
 * It also sends push notifications when a task reaches a terminal state.
 * @param options - Handler options, including asyncExecution to control synchronous/asynchronous behavior
 */
export class PaymentsRequestHandler extends DefaultRequestHandler {
  private paymentsService: Payments
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
   * Deletes the HTTP context associated with a taskId.
   * @param taskId - The taskId to delete context for
   */
  public deleteHttpRequestContextForTask(taskId: string): void {
    this.httpContextByTaskId.delete(taskId)
  }

  /**
   * Validates a request using the payments service.
   * This method is used by the middleware to validate credits before processing requests.
   *
   * @param agentId - The agent ID to validate
   * @param bearerToken - The bearer token for authentication
   * @param urlRequested - The URL being requested
   * @param httpMethodRequested - The HTTP method being used
   * @returns Promise resolving to the validation result
   */
  public async validateRequest(
    agentId: string,
    bearerToken: string,
    urlRequested: string,
    httpMethodRequested: string,
  ): Promise<any> {
    return this.paymentsService.requests.startProcessingRequest(
      agentId,
      bearerToken,
      urlRequested,
      httpMethodRequested,
    )
  }

  /**
   * Processes all events, calling handleTaskFinalization when a terminal status-update event is received.
   * In async mode, it can be launched in background.
   */
  protected async processEventsWithFinalization(
    taskId: string,
    resultManager: ResultManager,
    eventQueue: ExecutionEventQueue,
    bearerToken: string,
    validation: StartAgentRequest,
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
          await this.handleTaskFinalization(resultManager, event, bearerToken, validation)
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
          A2AError.internalError('Execution finished before a message or task was produced.'),
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
    // Validate required parameters before any processing
    const missingParam = !params.message
      ? 'message'
      : !params.message.messageId
        ? 'message.messageId'
        : null
    if (missingParam) {
      throw A2AError.invalidParams(`${missingParam} is required.`)
    }

    // 3. Get HTTP context for the task or message
    let taskId = params.message.taskId
    let httpContext: HttpRequestContext | undefined
    if (taskId) {
      httpContext = this.getHttpRequestContextForTask(taskId)
    } else {
      const messageId = params.message.messageId
      httpContext = this.getHttpRequestContextForMessage(messageId)
    }

    if (!httpContext) {
      throw A2AError.internalError('HTTP context not found for task or message.')
    }

    // 2. Extract bearer token and validate presence of required fields
    const { bearerToken, validation } = httpContext
    if (!bearerToken) {
      throw PaymentsError.unauthorized('Missing bearer token for payment validation.')
    }

    // 3. Validate credits before executing the task
    const agentCard = await this.getAgentCard()
    const agentId = agentCard.capabilities?.extensions?.find(
      (ext) => ext.uri === 'urn:nevermined:payment',
    )?.params?.agentId
    if (!agentId) {
      throw A2AError.internalError('Agent ID not found in payment extension.')
    }

    // 4. Generate taskId if not present and migrate HTTP context
    const incomingMessage = params.message
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

    // 6. Create PaymentsRequestContext
    const authResult: A2AAuthResult = {
      requestId: validation.agentRequestId,
      token: bearerToken,
      agentId: validation.agentId,
      agentRequest: validation,
    }

    const agentRequestContext: AgentRequestContext = {
      authResult,
      httpContext,
    }

    // 7. Create extended request context with agent request data
    const paymentsRequestContext: PaymentsRequestContext = {
      ...requestContext,
      payments: agentRequestContext,
    }

    // 8. Execute agent with extended context
    this.getAgentExecutor()
      .execute(paymentsRequestContext, eventBus)
      .catch((err: any) => {
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

    // Determine if execution should be blocking based on client request
    // The blocking parameter comes from params.configuration.blocking
    const isBlocking = params.configuration?.blocking !== false // Default to blocking if not specified

    if (isBlocking) {
      await this.processEventsWithFinalization(
        taskId,
        resultManager,
        eventQueue,
        bearerToken,
        validation,
      )
      const finalResult = resultManager.getFinalResult()
      if (!finalResult) {
        throw A2AError.internalError(
          'Agent execution finished without a result, and no task context found.',
        )
      }
      return finalResult
    } else {
      // Non-blocking execution - return immediately with first result
      return new Promise((resolve, reject) => {
        this.processEventsWithFinalization(
          taskId!,
          resultManager,
          eventQueue,
          bearerToken,
          validation,
          {
            firstResultResolver: resolve,
            firstResultRejector: reject,
          },
        )
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
    validation: StartAgentRequest,
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
        const response = await this.paymentsService.requests.redeemCreditsFromRequest(
          validation.agentRequestId,
          bearerToken,
          BigInt(creditsToBurn),
        )
        const task = resultManager.getCurrentTask()
        if (task) {
          task.metadata = {
            ...task.metadata,
            ...event.metadata,
            txHash: response.txHash,
          }
          await resultManager.processEvent(task)
          // Delete http context associated with the task
          this.deleteHttpRequestContextForTask(event.taskId)
        }
      } catch (err) {
        // Do nothing
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
      // Do nothing
    }
  }

  /**
   * Streams messages and events for a task, with payments validation.
   * Also sends a push notification if a terminal status-update event is emitted.
   * @param params - Message send parameters
   * @returns Async generator of events
   */
  async *sendMessageStream(
    params: MessageSendParams,
  ): AsyncGenerator<A2AStreamEvent, void, undefined> {
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
      throw A2AError.internalError('HTTP context not found for task or message.')
    }
    const { bearerToken, validation } = httpContext
    if (!bearerToken) {
      throw PaymentsError.unauthorized('Missing bearer token for payment validation.')
    }
    const agentCard = await this.getAgentCard()
    const agentId = agentCard.capabilities?.extensions?.find(
      (ext) => ext.uri === 'urn:nevermined:payment',
    )?.params?.agentId
    if (!agentId) {
      throw A2AError.internalError('Agent ID not found in payment extension.')
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
            validation.agentRequestId,
            bearerToken,
            BigInt(event.metadata.creditsUsed),
          )
        } catch (err) {
          // Do nothing
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
          // Do nothing
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
      throw A2AError.internalError('Failed to send push notification.')
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

  /**
   * Protected getter to access the private agentExecutor property from the parent class.
   * This is a workaround due to SDK limitations.
   */
  protected getAgentExecutor(): AgentExecutor {
    return (this as any).agentExecutor as AgentExecutor
  }

  /**
   * Protected getter to access the private _createRequestContext method from the parent class.
   * This is a workaround due to SDK limitations.
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
   */
  protected callProcessEvents(...args: any[]): any {
    return (this as any)._processEvents.apply(this, args)
  }
}
