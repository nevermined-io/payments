import type {
  AgentCard,
  Message,
  MessageSendParams,
  PushNotificationConfig,
  Task,
  TaskArtifactUpdateEvent,
  TaskIdParams,
  TaskState,
  TaskStatusUpdateEvent,
} from '@a2a-js/sdk'
import type { ExecutionEventBusManager, TaskStore } from '@a2a-js/sdk/server'
import {
  A2AError,
  AgentExecutor,
  DefaultRequestHandler,
  ExecutionEventBus,
  ExecutionEventQueue,
  ResultManager,
} from '@a2a-js/sdk/server'
import { v4 as uuidv4 } from 'uuid'
import { PaymentsError } from '../common/payments.error.js'
import { StartAgentRequest, isValidScheme } from '../common/types.js'
import { Payments } from '../payments.js'
import { decodeAccessToken } from '../utils.js'
import {
  buildPaymentRequired,
  type SettlePermissionsResult,
  type X402PaymentRequired,
} from '../x402/facilitator-api.js'
import { x402A2AUtils } from './x402-a2a.js'
import type {
  A2AAuthResult,
  A2AStreamEvent,
  AgentRequestContext,
  HttpRequestContext,
  PaymentRedemptionConfig,
  PaymentsRequestContext,
} from './types.js'

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
   * Validates a request using the x402 payments service.
   * This method is used by the middleware to validate credits before processing requests.
   *
   * @param bearerToken - The bearer token for authentication
   * @param endpoint - Optional endpoint URL being requested
   * @param httpVerb - Optional HTTP method being used
   * @returns Promise resolving to the validation result
   */
  public async validateRequest(
    bearerToken: string,
    endpoint?: string,
    httpVerb?: string,
  ): Promise<any> {
    let planId: string | undefined
    const agentCard = await this.getAgentCard()
    const paymentExtension = agentCard.capabilities?.extensions?.find(
      (ext: any) => ext.uri === 'urn:nevermined:payment',
    )
    if (paymentExtension) {
      planId = paymentExtension.params?.planId as string
    }

    const decodedAccessToken = decodeAccessToken(bearerToken)

    if (!decodedAccessToken) {
      throw PaymentsError.unauthorized('Invalid access token.')
    }

    if (!planId) {
      throw PaymentsError.unauthorized('Plan ID not found in agent card.')
    }

    // Extract subscriberAddress from token (payload.authorization.from per x402 spec)
    const subscriberAddress = decodedAccessToken.payload?.authorization?.from

    if (!subscriberAddress) {
      throw PaymentsError.unauthorized(
        'Cannot determine subscriberAddress from token (expected payload.authorization.from)',
      )
    }

    const agentId = paymentExtension?.params?.agentId as string | undefined
    const scheme = isValidScheme(decodedAccessToken.accepted?.scheme)
      ? decodedAccessToken.accepted.scheme
      : 'nvm:erc4337'

    const paymentRequired: X402PaymentRequired = buildPaymentRequired(planId, {
      endpoint: endpoint || '',
      agentId,
      httpVerb,
      scheme,
      environment: this.paymentsService.getEnvironmentName(),
    })

    const result = await this.paymentsService.facilitator.verifyPermissions({
      paymentRequired,
      x402AccessToken: bearerToken,
      maxAmount: 1n,
    })
    if (!result.isValid) {
      throw PaymentsError.unauthorized('Permission verification failed.')
    }
    return {
      success: true,
      planId,
      subscriberAddress,
      balance: { isSubscriber: true },
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
   * @param bearerToken - The bearer token for authentication
   * @param creditsUsed - The number of credits to burn
   * @param httpContext - Optional HTTP context with endpoint and method information
   * @returns Promise resolving to the redemption result
   */
  private async executeRedemption(
    bearerToken: string,
    creditsUsed: bigint | number,
    httpContext?: HttpRequestContext,
  ): Promise<any> {
    const decodedAccessToken = decodeAccessToken(bearerToken)
    if (!decodedAccessToken) {
      throw PaymentsError.unauthorized('Invalid access token.')
    }

    let planId: string | undefined
    let agentId: string | undefined
    const agentCard = await this.getAgentCard()
    const paymentExtension = agentCard.capabilities?.extensions?.find(
      (ext: any) => ext.uri === 'urn:nevermined:payment',
    )
    if (paymentExtension) {
      planId = paymentExtension.params?.planId as string | undefined
      agentId = paymentExtension.params?.agentId as string | undefined
    }

    if (!planId) {
      throw PaymentsError.unauthorized('Plan ID not found in agent card.')
    }

    const scheme = isValidScheme(decodedAccessToken.accepted?.scheme)
      ? decodedAccessToken.accepted.scheme
      : 'nvm:erc4337'

    // Build paymentRequired using the helper
    const paymentRequired = buildPaymentRequired(planId, {
      endpoint: httpContext?.urlRequested,
      agentId,
      httpVerb: httpContext?.httpMethodRequested,
      scheme,
      environment: this.paymentsService.getEnvironmentName(),
    })

    return await this.paymentsService.facilitator.settlePermissions({
      paymentRequired,
      x402AccessToken: bearerToken,
      maxAmount: BigInt(creditsUsed),
    })
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

    // 2. Extract bearer token and validate presence of required fields.
    // This path only runs for an *authorized* context (a token was supplied), so
    // both bearerToken and validation must be present — assert the invariant
    // explicitly instead of carrying an `undefined as any`.
    const { bearerToken, validation } = httpContext
    if (!bearerToken) {
      throw PaymentsError.unauthorized('Missing bearer token for payment validation.')
    }
    if (!validation) {
      throw PaymentsError.unauthorized('Missing validation context for payment.')
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
   * x402 v2 A2A transport: if the request is payment-gated and arrived with no
   * token (the middleware stored a `paymentRequired` on the HTTP context), build
   * and return the spec-shaped `input-required` task carrying the
   * X402PaymentRequired object under `x402.payment.required` — WITHOUT executing
   * the agent. Returns `undefined` when a token was present (normal flow).
   *
   * @param params - The incoming message send parameters
   * @returns The `input-required` Task to return to the client, or `undefined`
   */
  private async buildPaymentRequiredTaskIfNeeded(
    params: MessageSendParams,
  ): Promise<Task | undefined> {
    const message = params.message
    if (!message) {
      return undefined
    }
    const incomingTaskId = message.taskId
    const httpContext = incomingTaskId
      ? this.getHttpRequestContextForTask(incomingTaskId)
      : this.getHttpRequestContextForMessage(message.messageId)

    if (!httpContext?.paymentRequired) {
      return undefined
    }

    // Correlate the input-required task with the incoming taskId when present so
    // the client's follow-up payment payload (same taskId) maps back to it.
    const taskId = incomingTaskId || uuidv4()
    const contextId = message.contextId || uuidv4()
    const task: Task = {
      kind: 'task',
      id: taskId,
      contextId,
      status: { state: 'submitted', timestamp: new Date().toISOString() },
      history: [message],
    }
    const paymentRequiredTask = x402A2AUtils.createPaymentRequiredTask(
      task,
      httpContext.paymentRequired,
    )

    // Persist the input-required task so the client's follow-up (same taskId)
    // can correlate to it (otherwise the SDK's _createRequestContext raises
    // "Task not found"). The follow-up carries the in-band payload, so the
    // middleware overwrites this taskId's HTTP context with the authorized one.
    await this.getTaskStore().save(paymentRequiredTask)
    if (!incomingTaskId) {
      this.deleteHttpRequestContextForMessage(message.messageId)
    }
    return paymentRequiredTask
  }

  /**
   * Stamp x402 settlement state onto the final task's metadata, in band, per the
   * x402 v2 A2A transport. Only applied when the token arrived in band (so the
   * legacy `payment-signature` header path is unchanged). On success the task
   * carries `x402.payment.status: payment-completed` + `x402.payment.receipts`;
   * on failure `payment-failed` + `x402.payment.error` + receipts.
   *
   * @param task - The current task (mutated in place)
   * @param httpContext - The request's HTTP context
   * @param settlement - The settlement result, or undefined when none ran
   */
  private recordInBandSettlement(
    task: Task | undefined,
    httpContext: HttpRequestContext | undefined,
    settlement?: SettlePermissionsResult,
    settlementDeferred = false,
  ): void {
    if (!task || !httpContext?.inBand) {
      return
    }
    if (settlement && settlement.success === false) {
      x402A2AUtils.recordPaymentFailure(
        task,
        settlement.errorReason || 'SETTLEMENT_FAILED',
        settlement,
      )
    } else if (settlement) {
      x402A2AUtils.recordPaymentSuccess(task, settlement)
    } else if (settlementDeferred) {
      // No in-band settlement result because redemption is BATCHED: the payload was
      // verified but on-chain settlement is deferred out-of-band (this handler never
      // confirms it). Mark payment-verified + the deferred marker, NOT
      // payment-completed — so the client knows it will be charged out-of-band
      // rather than reading a completed task as "nothing owed".
      x402A2AUtils.recordPaymentDeferred(task)
    } else {
      // Defensive default: verified, but no settlement result AND not batch-deferred
      // (e.g. a settle that returned nothing). Record a bare verify.
      x402A2AUtils.recordPaymentVerified(task)
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
    requestHttpContext?: HttpRequestContext,
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
              // Prefer the per-request context (authoritative in-band flag); fall
              // back to a per-taskId lookup for executors that mint their own task id.
              const httpContext =
                requestHttpContext ?? this.getHttpRequestContextForTask(event.taskId)
              // Execute redemption with server configuration for non-batch requests
              const response = await this.executeRedemption(
                bearerToken,
                BigInt(event.metadata.creditsUsed),
                httpContext,
              )

              // Update event metadata with response data
              if (response && event.metadata) {
                event.metadata.txHash = response.txHash ?? response.transaction
                event.metadata.creditsCharged = response.amountOfCredits
                  ? Number(response.amountOfCredits)
                  : event.metadata.creditsUsed
              }

              // x402 v2 A2A transport: stamp the settlement receipt onto the
              // persisted task in band. NOTE: a stream cannot retract the event
              // it already yielded above, so an in-band settlement is reflected
              // on the saved task (visible via tasks/get + resubscribe) — it
              // cannot withhold content the way a non-streaming result does.
              if (httpContext?.inBand) {
                const task = resultManager.getCurrentTask()
                if (task) {
                  this.recordInBandSettlement(
                    task,
                    httpContext,
                    response as SettlePermissionsResult,
                  )
                  await resultManager.processEvent(task)
                }
              }
            } else {
              // Batch redemption: on-chain settlement is deferred out-of-band. The
              // stream already yielded the content (can't retract), but stamp the
              // PERSISTED task with payment-verified + the deferred marker so a
              // streaming client (via tasks/get + resubscribe) isn't left reading a
              // completed task as "nothing owed" — matching the non-streaming path.
              const httpContext =
                requestHttpContext ?? this.getHttpRequestContextForTask(event.taskId)
              if (httpContext?.inBand) {
                const task = resultManager.getCurrentTask()
                if (task) {
                  this.recordInBandSettlement(task, httpContext, undefined, true)
                  await resultManager.processEvent(task)
                }
              }
            }
          } catch (err) {
            // x402 v2 A2A: settlement failed AFTER the paid event was already
            // streamed to the client (a stream cannot retract it). Do NOT swallow
            // it — log, and stamp payment-failed on the persisted task so
            // tasks/get + resubscribe reflect the failure (mirrors non-streaming).
            console.error('[PaymentsA2A] streaming settlement failed after execution:', err)
            const httpContext =
              requestHttpContext ?? this.getHttpRequestContextForTask(event.taskId)
            if (httpContext?.inBand) {
              try {
                const task = resultManager.getCurrentTask()
                if (task) {
                  const errorReason = err instanceof Error ? err.message : String(err)
                  if (task.status) task.status.state = 'failed'
                  task.artifacts = undefined
                  this.recordInBandSettlement(task, httpContext, {
                    success: false,
                    errorReason,
                    transaction: '',
                    network: '',
                  })
                  await resultManager.processEvent(task)
                }
              } catch (stampErr) {
                console.error('[PaymentsA2A] failed to stamp streaming payment-failed:', stampErr)
              }
            }
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
    requestHttpContext?: HttpRequestContext,
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
          // Prefer the per-request HTTP context (authoritative for this request,
          // carries the in-band flag). Fall back to a per-taskId lookup for
          // executors that mint their own task id (the event's taskId may then
          // differ from the request's generated one).
          const httpContext = requestHttpContext ?? this.getHttpRequestContextForTask(event.taskId)
          await this.handleTaskFinalization(resultManager, event, bearerToken, httpContext)
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
    // x402 v2 A2A transport: a payment-gated request with no token returns an
    // `input-required` task (in band) instead of executing the agent.
    const paymentRequiredTask = await this.buildPaymentRequiredTaskIfNeeded(params)
    if (paymentRequiredTask) {
      return paymentRequiredTask
    }

    // Create PaymentsRequestContext and related data
    const {
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
        undefined,
        httpContext,
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
          httpContext,
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
    httpContext?: HttpRequestContext,
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
      let settlement: SettlePermissionsResult | undefined
      let settlementError: unknown
      let settlementDeferred = false
      try {
        // Get redemption configuration from server (not from client metadata)
        const redemptionConfig = await this.getRedemptionConfig()
        // Batch redemption defers on-chain settlement out-of-band (no receipt here).
        settlementDeferred = redemptionConfig.useBatch ?? false

        if (!redemptionConfig.useBatch) {
          // Execute redemption with server configuration for non-batch requests
          const response = await this.executeRedemption(
            bearerToken,
            BigInt(creditsToBurn),
            httpContext,
          )
          settlement = response as SettlePermissionsResult

          // Update event metadata with redemption results
          event.metadata = {
            ...event.metadata,
            txHash: response.txHash ?? response.transaction,
            // Store the actual credits charged (especially important for margin-based)
            creditsCharged: response.amountOfCredits
              ? Number(response.amountOfCredits)
              : creditsToBurn,
          }
        }
      } catch (err) {
        // Settlement failed AFTER the agent executed. Always log it (the legacy
        // header path has no other surface for it). For the in-band x402 v2 A2A
        // path it is additionally surfaced below as payment-failed + suppressed
        // content; the legacy header path still delivers the result (no retract).
        console.error('[PaymentsA2A] settlement failed after execution:', err)
        settlementError = err
      }

      // Stamp the in-band x402 state onto the FINAL event so it survives when the
      // caller processes this event into the task's status (mutating the task
      // here would be overwritten by the final event). The event carries a Task
      // shape under `event.status`; the helpers mutate `event.status.message`.
      if (httpContext?.inBand && settlementError) {
        // x402 v2 A2A transport: a settlement failure after execution must NOT
        // deliver paid content — replace the agent's status message with a
        // failed one carrying payment-failed metadata + an error receipt.
        const errorReason =
          settlementError instanceof Error ? settlementError.message : String(settlementError)
        event.status = {
          state: 'failed',
          message: {
            kind: 'message',
            messageId: uuidv4(),
            role: 'agent',
            parts: [{ kind: 'text', text: `Payment settlement failed: ${errorReason}` }],
            taskId: event.taskId,
            contextId: event.contextId,
            metadata: {},
          },
          timestamp: new Date().toISOString(),
        }
        this.recordInBandSettlement({ status: event.status } as any, httpContext, {
          success: false,
          errorReason,
          transaction: '',
          network: settlement?.network || '',
        })
      } else if (httpContext?.inBand) {
        // Stamp in-band settlement state onto the final event's status message.
        this.recordInBandSettlement(
          { status: event.status } as any,
          httpContext,
          settlement,
          settlementDeferred,
        )
      }

      try {
        // Always update task metadata and process the task
        const task = resultManager.getCurrentTask()
        if (task) {
          // Update task metadata with current event metadata (executor / redemption).
          task.metadata = {
            ...task.metadata,
            ...event.metadata,
          }

          if (httpContext?.inBand && settlementError) {
            // x402 v2 A2A transport: a settlement failure must never deliver paid
            // content. The agent's status message was already replaced above; also
            // drop any artifacts it emitted so the paid result cannot surface there
            // (mirrors the Python SDK's _apply_inband_settlement). History is rebuilt
            // by processEvent below from the replaced (failed) status, so it carries
            // no paid content.
            task.artifacts = undefined
          }

          await resultManager.processEvent(task)
          // Delete http context associated with the task
          this.deleteHttpRequestContextForTask(event.taskId)
        }
      } catch (err) {
        // This block persists the payment-failed/suppressed task; if it throws the
        // suppression itself failed, so log loudly rather than swallow.
        console.error('[PaymentsA2A] failed to persist finalized task:', err)
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
    // x402 v2 A2A transport: a payment-gated request with no token yields a
    // single `input-required` task (in band) instead of executing the agent.
    const paymentRequiredTask = await this.buildPaymentRequiredTaskIfNeeded(params)
    if (paymentRequiredTask) {
      yield paymentRequiredTask
      return
    }

    // Create PaymentsRequestContext and related data
    const {
      paymentsRequestContext,
      taskId,
      httpContext,
      bearerToken,
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
      httpContext,
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
              await this.handleTaskFinalization(resultManager, event, bearerToken, httpContext)
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
