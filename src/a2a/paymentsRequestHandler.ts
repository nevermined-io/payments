import type {
  AgentCard,
  MessageSendParams,
  TaskState,
  PushNotificationConfig,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  Task,
  Message,
  TaskIdParams,
} from '@a2a-js/sdk'
import {
  AgentExecutor,
  DefaultRequestHandler,
  ResultManager,
  ExecutionEventQueue,
} from '@a2a-js/sdk/server'
import type { ExecutionEventBusManager, TaskStore } from '@a2a-js/sdk/server'
import { A2AError, ExecutionEventBus } from '@a2a-js/sdk/server'
import type {
  HttpRequestContext,
  PaymentsRequestContext,
  AgentRequestContext,
  A2AAuthResult,
  A2AStreamEvent,
  PaymentRedemptionConfig,
} from './types.js'
import { StartAgentRequest } from '../common/types.js'
import { PaymentsError } from '../common/payments.error.js'
import { Payments } from '../payments.js'
import { v4 as uuidv4 } from 'uuid'

const terminalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected']

/**
 * Options for configuring the PaymentsRequestHandler
 */
export interface PaymentsRequestHandlerOptions {
  /** Whether to execute tasks asynchronously */
  asyncExecution?: boolean
  /** Default batch mode for all requests (can be overridden per-request) */
  defaultBatch?: boolean
  /** Default margin percentage for all requests (can be overridden per-request) */
  defaultMarginPercent?: number
}

/**
 * PaymentsRequestHandler extends DefaultRequestHandler to add payments validation and burning.
 * It validates credits before executing a task and burns credits after successful execution.
 * It also sends push notifications when a task reaches a terminal state.
 * @param options - Handler options, including asyncExecution, defaultBatch, and defaultMarginPercent
 */
export class PaymentsRequestHandler extends DefaultRequestHandler {
  private paymentsService: Payments
  private httpContextByTaskId: Map<string, HttpRequestContext> = new Map()
  private httpContextByMessageId: Map<string, HttpRequestContext> = new Map()
  private asyncExecution: boolean
  private defaultBatch: boolean
  private defaultMarginPercent?: number

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
   * @param options - Handler options (asyncExecution, defaultBatch, defaultMarginPercent)
   */
  constructor(
    agentCard: AgentCard,
    taskStore: TaskStore,
    agentExecutor: AgentExecutor,
    paymentsService: any,
    eventBusManager?: ExecutionEventBusManager,
    options?: PaymentsRequestHandlerOptions,
  ) {
    super(agentCard, taskStore, agentExecutor, eventBusManager)
    this.paymentsService = paymentsService
    this.asyncExecution = options?.asyncExecution ?? false
    this.defaultBatch = options?.defaultBatch ?? false
    this.defaultMarginPercent = options?.defaultMarginPercent
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
   * Get the handler options (defaultBatch, defaultMarginPercent).
   * Used by middleware to determine default redemption behavior.
   * @returns The handler options
   */
  public getHandlerOptions(): PaymentsRequestHandlerOptions {
    return {
      asyncExecution: this.asyncExecution,
      defaultBatch: this.defaultBatch,
      defaultMarginPercent: this.defaultMarginPercent,
    }
  }

  /**
   * Validates a request using the payments service.
   * This method is used by the middleware to validate credits before processing requests.
   *
   * @param agentId - The agent ID to validate
   * @param bearerToken - The bearer token for authentication
   * @param urlRequested - The URL being requested
   * @param httpMethodRequested - The HTTP method being used
   * @param batch - Whether this is a batch request (default: false)
   * @returns Promise resolving to the validation result
   */
  public async validateRequest(
    agentId: string,
    bearerToken: string,
    urlRequested: string,
    httpMethodRequested: string,
    batch = false,
  ): Promise<any> {
    if (batch) {
      return this.paymentsService.requests.startProcessingBatchRequest(
        agentId,
        bearerToken,
        urlRequested,
        httpMethodRequested,
      )
    } else {
      return this.paymentsService.requests.startProcessingRequest(
        agentId,
        bearerToken,
        urlRequested,
        httpMethodRequested,
      )
    }
  }

  /**
   * Gets redemption configuration for a task based on AgentCard and handler defaults.
   * The configuration is determined by the server, not by client metadata.
   *
   * @returns The redemption configuration
   */
  private async getRedemptionConfig(): Promise<PaymentRedemptionConfig> {
    const agentCard = await this.getAgentCard()
    const paymentExtension = agentCard.capabilities?.extensions?.find(
      (ext: any) => ext.uri === 'urn:nevermined:payment',
    )

    const agentConfig =
      (paymentExtension?.params?.redemptionConfig as PaymentRedemptionConfig) || {}

    return {
      useBatch: agentConfig.useBatch ?? this.defaultBatch ?? false,
      useMargin: agentConfig.useMargin ?? false,
      marginPercent: agentConfig.marginPercent ?? this.defaultMarginPercent,
    }
  }

  /**
   * Determines the appropriate redemption method based on server configuration.
   *
   * @param validation - The validation result from the request
   * @param bearerToken - The bearer token for authentication
   * @param creditsUsed - The number of credits to burn
   * @param config - The redemption configuration
   * @returns Promise resolving to the redemption result
   */
  private async executeRedemption(
    validation: StartAgentRequest,
    bearerToken: string,
    creditsUsed: bigint | number,
    config: PaymentRedemptionConfig,
  ): Promise<any> {
    const { useBatch, useMargin, marginPercent } = config

    if (useBatch && useMargin && marginPercent !== undefined) {
      // Batch + Margin
      return await this.paymentsService.requests.redeemWithMarginFromBatchRequest(
        validation.agentRequestId,
        bearerToken,
        marginPercent,
      )
    } else if (useBatch) {
      // Batch + Fixed Credits
      return await this.paymentsService.requests.redeemCreditsFromBatchRequest(
        validation.agentRequestId,
        bearerToken,
        BigInt(creditsUsed),
      )
    } else if (useMargin && marginPercent !== undefined) {
      // Single + Margin
      return await this.paymentsService.requests.redeemWithMarginFromRequest(
        validation.agentRequestId,
        bearerToken,
        marginPercent,
      )
    } else {
      // Single + Fixed Credits (default)
      return await this.paymentsService.requests.redeemCreditsFromRequest(
        validation.agentRequestId,
        bearerToken,
        BigInt(creditsUsed),
      )
    }
  }

  /**
   * Creates PaymentsRequestContext from message parameters.
   * This method handles HTTP context retrieval, validation, and context creation.
   * @param params - Message send parameters
   * @param isStreaming - Whether this is for streaming (affects createRequestContext call)
   * @returns Object containing PaymentsRequestContext and related data
   */
  private async createPaymentsRequestContext(
    params: MessageSendParams,
    isStreaming = false,
  ): Promise<{
    paymentsRequestContext: PaymentsRequestContext
    taskId: string
    httpContext: HttpRequestContext
    bearerToken: string
    validation: StartAgentRequest
    requestContext: any
    finalMessageForAgent: Message
    eventBus: ExecutionEventBus
    eventQueue: ExecutionEventQueue
    resultManager: ResultManager
  }> {
    // Validate required parameters before any processing
    const missingParam = !params.message
      ? 'message'
      : !params.message.messageId
        ? 'message.messageId'
        : null
    if (missingParam) {
      throw A2AError.invalidParams(`${missingParam} is required.`)
    }

    // 1. Get HTTP context for the task or message
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
    const requestContext = await this.callCreateRequestContext(incomingMessage, taskId, isStreaming)
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
      paymentsService: this.paymentsService,
    }

    // 7. Create extended request context with agent request data
    const paymentsRequestContext: PaymentsRequestContext = {
      ...requestContext,
      payments: agentRequestContext,
    }

    return {
      paymentsRequestContext,
      taskId,
      httpContext,
      bearerToken,
      validation,
      requestContext,
      finalMessageForAgent,
      eventBus,
      eventQueue,
      resultManager,
    }
  }

  /**
   * Processes streaming events with finalization (credits burning and push notifications).
   * Similar to processEventsWithFinalization but yields events for streaming.
   * @param taskId - The task ID
   * @param resultManager - The result manager
   * @param eventQueue - The event queue
   * @param bearerToken - The bearer token
   * @param validation - The validation result
   * @returns Async generator yielding processed events
   */
  protected async *processStreamingEventsWithFinalization(
    taskId: string,
    resultManager: ResultManager,
    eventQueue: ExecutionEventQueue,
    bearerToken: string,
    validation: StartAgentRequest,
  ): AsyncGenerator<A2AStreamEvent, void, undefined> {
    try {
      for await (const event of eventQueue.events()) {
        await resultManager.processEvent(event)
        yield event

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
            // Get redemption configuration from server (not from client metadata)
            const redemptionConfig = await this.getRedemptionConfig()

            if (!redemptionConfig.useBatch) {
              // Execute redemption with server configuration for non-batch requests
              const response = await this.executeRedemption(
                validation,
                bearerToken,
                BigInt(event.metadata.creditsUsed),
                redemptionConfig,
              )

              // Update event metadata with response data
              if (response && event.metadata) {
                event.metadata.txHash = response.txHash
                event.metadata.creditsCharged = response.amountOfCredits
                  ? Number(response.amountOfCredits)
                  : event.metadata.creditsUsed
              }
            }
          } catch (err) {
            // Do nothing
          }
        }

        // Handle push notification
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
      }
    } finally {
      // Cleanup when the stream is fully consumed or breaks
      //this.getEventBusManager().cleanupByTaskId(taskId)
    }
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
        // Handle redemption before processing the event
        if (
          event.kind === 'status-update' &&
          event.final &&
          terminalStates.includes(event.status?.state)
        ) {
          await this.handleTaskFinalization(resultManager, event, bearerToken, validation)
        }

        await resultManager.processEvent(event)
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
    // Create PaymentsRequestContext and related data
    const {
      paymentsRequestContext,
      taskId,
      bearerToken,
      validation,
      requestContext,
      finalMessageForAgent,
      eventBus,
      eventQueue,
      resultManager,
    } = await this.createPaymentsRequestContext(params, false)

    // Execute agent with extended context
    ;(this as any).agentExecutor
      .execute(paymentsRequestContext as any, eventBus)
      .catch((err: any) => {
        const errorTask: Task = {
          id: requestContext.task?.id || uuidv4(),
          contextId: finalMessageForAgent.contextId || uuidv4(),
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
      if (!taskId) {
        throw A2AError.internalError('Task ID is required for non-blocking execution.')
      }
      const validTaskId = taskId
      return new Promise((resolve, reject) => {
        this.processEventsWithFinalization(
          validTaskId,
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
   * Supports batch and margin-based redemptions based on server configuration.
   * @param resultManager - The result manager
   * @param event - The status-update event with final state
   * @param bearerToken - The bearer token for payment validation
   * @param validation - The validation result from the request
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
        // Get redemption configuration from server (not from client metadata)
        const redemptionConfig = await this.getRedemptionConfig()

        if (!redemptionConfig.useBatch) {
          // Execute redemption with server configuration for non-batch requests
          const response = await this.executeRedemption(
            validation,
            bearerToken,
            BigInt(creditsToBurn),
            redemptionConfig,
          )

          // Update event metadata with redemption results
          event.metadata = {
            ...event.metadata,
            txHash: response.txHash,
            // Store the actual credits charged (especially important for margin-based)
            creditsCharged: response.amountOfCredits
              ? Number(response.amountOfCredits)
              : creditsToBurn,
          }
        }

        // Always update task metadata and process the task
        const task = resultManager.getCurrentTask()
        if (task) {
          // Update task metadata with current event metadata (from executor or redemption)
          task.metadata = {
            ...task.metadata,
            ...event.metadata,
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
    // Create PaymentsRequestContext and related data
    const {
      paymentsRequestContext,
      taskId,
      bearerToken,
      validation,
      requestContext,
      finalMessageForAgent,
      eventBus,
      eventQueue,
      resultManager,
    } = await this.createPaymentsRequestContext(params, true)

    // Execute agent with extended context
    ;(this as any).agentExecutor
      .execute(paymentsRequestContext as any, eventBus)
      .catch((err: any) => {
        console.error(
          `Agent execution failed for stream message ${finalMessageForAgent.messageId}:`,
          err,
        )
        const contextId = finalMessageForAgent.contextId || uuidv4()
        const errorTaskStatus: TaskStatusUpdateEvent = {
          kind: 'status-update',
          taskId: requestContext.task?.id || uuidv4(),
          contextId,
          status: {
            state: 'failed',
            message: {
              kind: 'message',
              role: 'agent',
              messageId: uuidv4(),
              parts: [{ kind: 'text', text: `Agent execution error: ${err.message}` }],
              taskId: requestContext.task?.id,
              contextId,
            },
            timestamp: new Date().toISOString(),
          },
          final: true,
        }
        eventBus.publish(errorTaskStatus)
      })

    // Process streaming events with finalization
    yield* this.processStreamingEventsWithFinalization(
      taskId,
      resultManager,
      eventQueue,
      bearerToken,
      validation,
    )
  }

  /**
   * Sends a push notification when a task reaches a terminal state.
   * @param taskId - The task ID
   * @param state - The terminal state
   * @param pushNotificationConfig - The push notification configuration
   * @param payload - Additional payload to include in the notification
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

  /**
   * Resubscribes to a task's event stream, ensuring the task has updated metadata before yielding.
   * This method overrides the parent implementation to ensure metadata is updated before yielding.
   * @param params - Parameters containing the taskId
   * @returns Async generator of events
   */
  async *resubscribe(
    params: TaskIdParams,
  ): AsyncGenerator<Task | TaskStatusUpdateEvent | TaskArtifactUpdateEvent, void, undefined> {
    const task = await this.getTaskStore().load(params.id)
    if (!task) {
      throw A2AError.taskNotFound(params.id)
    }

    // Yield task immediately (with current metadata)
    yield task

    const finalStates: TaskState[] = ['completed', 'failed', 'canceled', 'rejected']
    if (finalStates.includes(task.status.state)) {
      return
    }

    const eventBus = this.getEventBusManager().getByTaskId(params.id)
    if (!eventBus) {
      console.warn(`Resubscribe: No active event bus for task ${params.id}.`)
      return
    }

    const eventQueue = new ExecutionEventQueue(eventBus)
    try {
      for await (const event of eventQueue.events()) {
        // Process event with ResultManager to ensure task is saved
        const resultManager = new ResultManager(this.getTaskStore())
        // Set context from task history if available
        if (task.history && task.history.length > 0) {
          resultManager.setContext(task.history[0])
        }
        await resultManager.processEvent(event)

        // Handle redemption and push notification for final status-update events
        if (
          event.kind === 'status-update' &&
          event.final &&
          event.taskId === params.id &&
          terminalStates.includes(event.status?.state)
        ) {
          // Get HTTP context for this task
          const httpContext = this.getHttpRequestContextForTask(event.taskId)
          if (httpContext) {
            const { bearerToken, validation } = httpContext
            if (bearerToken && validation) {
              // Handle task finalization (redemption and push notification)
              await this.handleTaskFinalization(resultManager, event, bearerToken, validation)
            }
          }
        }

        // Yield event after processing (so metadata is updated)
        if (event.kind === 'status-update' && event.taskId === params.id) {
          yield event
        } else if (event.kind === 'artifact-update' && event.taskId === params.id) {
          yield event
        } else if (event.kind === 'task' && event.id === params.id) {
          yield event
        }
      }
    } finally {
      eventQueue.stop()
    }
  }
}
