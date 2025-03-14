import axios from 'axios'
import {
  AgentExecutionStatus,
  ApiResponse,
  CreateTaskDto,
  CreateTaskResultDto,
  FullTaskDto,
  SearchSteps,
  SearchStepsDtoResult,
  SearchTasks,
  Step,
  StepEvent,
  TaskEvent,
  TaskLogMessage,
  UpdateStepDto,
} from '../common/types'
import { isStepIdValid } from '../utils'
import {
  BackendApiOptions,
  DefaultSubscriptionOptions,
  HTTPRequestOptions,
  NVMBackendApi,
  SubscriptionOptions,
} from './nvm-backend'

export const SEARCH_TASKS_ENDPOINT = '/api/v1/agents/search/tasks'
export const SEARCH_STEPS_ENDPOINT = '/api/v1/agents/search/steps'
export const CREATE_STEPS_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/steps'
export const UPDATE_STEP_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/step/{stepId}'
export const GET_AGENTS_ENDPOINT = '/api/v1/agents'
export const GET_BUILDER_STEPS_ENDPOINT = '/api/v1/agents/steps'
export const GET_TASK_STEPS_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/steps'
export const TASK_ENDPOINT = '/api/v1/agents/{did}/tasks'
export const GET_TASK_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}'

/**
 * Options required for interacting with an external AI Agent/Service.
 */
export class AIQueryOptions {
  /**
   * The access token to interact with the AI Agent/Service.
   * Only subscribers of the Payment Plan associated with the AI Agent/Service can obtain the access toke.
   */
  accessToken?: string

  /**
   * The Nevermined Proxy that needs to be used to interact with the AI Agent/Service.
   */
  neverminedProxyUri?: string
}

/**
 * The AI Query API class provides the methods to interact with the AI Query API.
 * This API implements the Nevermined AI Query Protocol @see https://docs.nevermined.io/docs/protocol/query-protocol.
 *
 * @remarks
 * This API is oriented for AI Builders providing AI Agents and AI Subscribers interacting with them.
 */
export class AIQueryApi extends NVMBackendApi {
  queryOptionsCache = new Map<string, AIQueryOptions>()

  constructor(opts: BackendApiOptions) {
    super(opts)
  }

  /**
   * It subscribes to the Nevermined network to retrieve new AI Tasks requested by other users.
   *
   * @remarks
   * This method is used by AI agents to subscribe and receive new AI Tasks sent by other subscribers
   *
   * @param _callback - The callback to execute when a new event is received
   * @param opts - The subscription options
   */
  async subscribe(
    _callback: (event: StepEvent) => void,
    opts: SubscriptionOptions = DefaultSubscriptionOptions,
  ) {
    await super.connectSocketSubscriber(_callback, opts)
  }

  /**
   * It subscribes to receive the logs generated during the execution of a task/s
   *
   * @remarks
   * This method is used by users/subscribers of AI agents after they create a task on them
   *
   * @param _callback - The callback to execute when a new task log event is received
   * @param tasks - The list of tasks to subscribe to
   * @param history - If true, it retrieves the history of the logs emitted before the subscription
   */
  async subscribeTasksUpdated(
    _callback: (event: TaskEvent) => void,
    tasks: string[],
    history = true,
  ) {
    await super.connectTasksSocket(_callback, tasks, history)
  }

  /**
   * Get the required configuration for accessing a remote service agent.
   * This configuration includes:
   * - The JWT access token
   * - The Proxy url that can be used to query the agent/service.
   *
   * @example
   * ```
   * const accessConfig = await payments.query.getServiceAccessConfig(agentDID)
   * console.log(`Agent JWT Token: ${accessConfig.accessToken}`)
   * console.log(`Agent Proxy URL: ${accessConfig.neverminedProxyUri}`)
   * ```
   *
   * @param did - The DID of the agent/service.
   * @returns A promise that resolves to the service token.
   */
  public async getServiceAccessConfig(did: string): Promise<{
    accessToken: string
    neverminedProxyUri: string
  }> {
    const options = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
    }
    const url = new URL(`/api/v1/payments/service/token/${did}`, this.opts.backendHost)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return (await response.json()).token
  }

  /**
   * Subscribers can create an AI Task for an Agent. The task must contain the input query that will be used by the AI Agent.
   * @see https://docs.nevermined.io/docs/protocol/query-protocol
   *
   * @remarks
   * This method is used by subscribers of a Payment Plan required to access a specific AI Agent or Service. Users who are not subscribers won't be able to create AI Tasks for that Agent.
   *
   * Because only subscribers can create AI Tasks, the method requires the access token to interact with the AI Agent/Service.
   * This is given using the `queryOpts` object (accessToken attribute).
   *
   * @example
   * ```
   * const accessConfig = await payments.query.getServiceAccessConfig(agentDID)
   * const queryOpts = {
   *    accessToken: accessConfig.accessToken,
   *    proxyHost: accessConfig.neverminedProxyUri
   * }
   *
   * const aiTask = {
   *     query: "https://www.youtube.com/watch?v=0tZFQs7qBfQ",
   *     name: "transcribe",
   *     "additional_params": [],
   *     "artifacts": []
   * }
   *
   * await payments.query.createTask(
   *   agentDID,
   *   aiTask,
   *   queryOpts
   * )
   * ```
   *
   * @param did - Agent DID
   * @param task - Task object. The task object should contain the query to execute and the name of the task. All the attributes here: @see https://docs.nevermined.io/docs/protocol/query-protocol#tasks-attributes
   * @param queryOpts - The query options @see {@link Payments.query.getServiceAccessConfig}
   * @param _callback - The callback to execute when a new task updated event is received (optional)
   * @returns The result of the operation
   */
  async createTask(
    did: string,
    task: CreateTaskDto,
    queryOpts?: AIQueryOptions,
    _callback?: (event: TaskEvent) => void,
  ): Promise<ApiResponse<CreateTaskResultDto>> {
    if (!queryOpts || !queryOpts.accessToken) {
      queryOpts = this.queryOptionsCache.has(did)
        ? this.queryOptionsCache.get(did)
        : await this.getServiceAccessConfig(did)
    }
    const endpoint = TASK_ENDPOINT.replace('{did}', did)
    const reqOptions: HTTPRequestOptions = {
      sendThroughProxy: true,
      ...(queryOpts?.neverminedProxyUri && { proxyHost: queryOpts.neverminedProxyUri }),
      ...(queryOpts?.accessToken && {
        headers: { Authorization: `Bearer ${queryOpts.accessToken}` },
      }),
    }
    try {
      const response = await this.post(endpoint, task, reqOptions)
      if (response.status === 201 && _callback) {
        await this.subscribeTasksUpdated(_callback, [response.data.task.task_id])
      }
      return {
        success: response.status >= 200 && response.status < 300,
        data: response.data as CreateTaskResultDto,
      }
    } catch (error: unknown) {
      let errorMessage = 'Unknown error'

      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.message || error.message
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * It returns the full task and the steps resulted of the execution of the task.
   * 
   * @remarks 
   * This method is used by subscribers of a Payment Plan required to access a specific AI Agent or Service. Users who are not subscribers won't be able to create AI Tasks for that Agent.
   * 
   * Because only subscribers get the results of their AI Tasks, the method requires the access token to interact with the AI Agent/Service.
   * This is given using the `queryOpts` object (accessToken attribute). 
   * 
   * @example
   * ```
   * const accessConfig = await payments.query.getServiceAccessConfig(agentDID)
   * const queryOpts = {
   *    accessToken: accessConfig.accessToken,
   *    proxyHost: accessConfig.neverminedProxyUri
   * }
   * 
   * await payments.query.createTask(
   *   agentDID, 
   *   taskId, 
   *   queryOpts
   * )
   * ```

   * @param did - Agent DID
   * @param taskId - Task ID
   * @returns The task with the steps
   */
  async getTaskWithSteps(
    did: string,
    taskId: string,
    queryOpts?: AIQueryOptions,
  ): Promise<FullTaskDto> {
    if (!queryOpts || !queryOpts.accessToken) {
      queryOpts = this.queryOptionsCache.has(did)
        ? this.queryOptionsCache.get(did)
        : await this.getServiceAccessConfig(did)
    }
    const reqOptions: HTTPRequestOptions = {
      sendThroughProxy: true,
      ...(queryOpts?.neverminedProxyUri && { proxyHost: queryOpts.neverminedProxyUri }),
      ...(queryOpts?.accessToken && {
        headers: { Authorization: `Bearer ${queryOpts.accessToken}` },
      }),
    }
    const result = await this.get(
      GET_TASK_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId),
      reqOptions,
    )
    return result.data as FullTaskDto
  }

  /**
   * It creates the step/s required to complete an AI Task
   *
   * @remarks
   * This method is used by the AI Agent to create the steps required to complete the AI Task.
   *
   * @param did - Agent DID
   * @param taskId - Task ID
   * @param steps - The list of Steps to create
   * @returns The result of the operation
   */
  async createSteps(did: string, taskId: string, steps: any): Promise<ApiResponse<string>> {
    try {
      const endpoint = CREATE_STEPS_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId)
      const response = await this.post(endpoint, steps, { sendThroughProxy: false })
      return {
        success: response.status >= 200 && response.status < 300,
        data: response.data.task_id,
      }
    } catch (error) {
      let errorMessage = 'Unknown error'

      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.message || error.message
      } else if (error instanceof Error) {
        errorMessage = error.message
      }
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * It updates the step with the new information
   * @remarks
   * This method is used by the AI Agent to update the status and output of an step. This method can not be called by a subscriber.
   *
   * @example
   * ```
   * const result = await payments.query.updateStep(step.did, step.task_id, step.step_id, {
   *         step_id: step.step_id,
   *         task_id: step.task_id,
   *         did: step.did,
   *         step_status: AgentExecutionStatus.Completed,
   *         is_last: true,
   *         output: 'LFG!',
   *         cost: 1
   *       })
   * ```
   *
   * @param did - Agent DID
   * @param step - The Step object to update. @see https://docs.nevermined.io/docs/protocol/query-protocol#steps-attributes
   * @returns The result of the operation
   */
  async updateStep(did: string, step: Step): Promise<ApiResponse<string>> {
    try {
      delete (step as { did?: string }).did

      const { task_id: taskId, step_id: stepId } = step
      if (!taskId || !stepId)
        throw new Error('The step object must contain the task_id and step_id attributes')

      const endpoint = UPDATE_STEP_ENDPOINT.replace('{did}', did)
        .replace('{taskId}', taskId)
        .replace('{stepId}', stepId)

      const response = await this.put(endpoint, step, { sendThroughProxy: false })

      return { success: response.status >= 200 && response.status < 300, data: stepId }
    } catch (error) {
      let errorMessage = 'Unknown error'

      if (axios.isAxiosError(error)) {
        errorMessage = error.response?.data?.message || error.message
      } else if (error instanceof Error) {
        errorMessage = error.message
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * It searches tasks based on the search parameters associated to the user
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the tasks created by users to the agents owned by the user
   *
   * @example
   * ```
   * await paymentsBuilder.query.searchTasks({ did: "did:nv:1234" })
   * ```
   *
   * @param searchParams - The search parameters @see {@link SearchTasks}
   * @returns The result of the search query
   */
  async searchTasks(searchParams: SearchTasks) {
    return this.post(SEARCH_TASKS_ENDPOINT, searchParams, { sendThroughProxy: false })
  }

  /**
   * It search steps based on the search parameters. The steps belongs to the tasks part of the AI Agents owned by the user.
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the steps part of tasks created by users to the agents owned by the user
   *
   * @example
   * ```
   * await paymentsBuilder.query.searchSteps({ step_id: "my-step-id" })
   * ```
   *
   * @param searchParams - The search parameters @see {@link SearchSteps}
   * @returns The result of the search query
   */
  async searchSteps(searchParams: SearchSteps): Promise<SearchStepsDtoResult> {
    const result = await this.post(SEARCH_STEPS_ENDPOINT, searchParams, { sendThroughProxy: false })
    if (!result.status || result.status >= 400) {
      throw new Error(
        `Error searching steps (status ${result.status}): ${JSON.stringify(result.data)}`,
      )
    }
    return result.data as SearchStepsDtoResult
  }

  /**
   * It retrieves the complete information of a specific step given a stepId
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the steps part of tasks created by users to the agents owned by the user
   *
   * @example
   * ```
   * await paymentsBuilder.query.getStep('step-1234')
   * ```
   *
   * @param stepId - the id of the step to retrieve
   * @returns The complete step information
   */
  async getStep(stepId: string): Promise<UpdateStepDto> {
    if (!isStepIdValid(stepId)) {
      throw new Error('Invalid step ID')
    }

    try {
      const result = await this.searchSteps({ step_id: stepId })

      if (result?.steps?.length > 0) {
        return result.steps[0]
      }

      throw new Error(`Step not found for ID: ${stepId}`)
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Error getting step: ${error.message}`
          : 'Unknown error getting step',
      )
    }
  }

  /**
   * It retrieves all the steps that the agent needs to execute to complete a specific task associated to the user.
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the tasks created by users to the agents owned by the user
   *
   * @param did - Agent DID
   * @param taskId - Task ID
   * @param status - The status of the steps to retrieve
   * @returns The steps of the task
   */
  async getStepsFromTask(
    did: string,
    taskId: string,
    status?: string,
  ): Promise<SearchStepsDtoResult> {
    let endpoint = GET_TASK_STEPS_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId)
    if (status) endpoint += `?status=${status}`
    const result = await this.get(endpoint, { sendThroughProxy: false })
    if (!result.status || result.status >= 400) {
      throw new Error(
        `Error getting steps from task (status ${result.status}): ${JSON.stringify(result.data)}`,
      )
    }
    return result.data as SearchStepsDtoResult
  }

  /**
   * It retrieves all the steps that the agent needs to execute to complete the different tasks assigned.
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the steps part of tasks created by users to the agents owned by the user
   *
   * @param status - The status of the steps to retrieve
   * @param dids - The list of DIDs to filter the steps
   * @returns The steps of the task
   */
  async getSteps(
    status: AgentExecutionStatus = AgentExecutionStatus.Pending,
    dids: string[] = [],
  ): Promise<SearchStepsDtoResult> {
    const queryParams = new URLSearchParams()
    if (status) queryParams.set('status', status.toString())
    if (dids.length > 0) queryParams.set('dids', dids.join(','))

    const endpoint = `${GET_BUILDER_STEPS_ENDPOINT}?${queryParams.toString()}`

    try {
      const result = await this.get(endpoint, { sendThroughProxy: false })

      if (!result.data || typeof result.data !== 'object') {
        throw new Error('Invalid response format from API.')
      }

      return result.data as SearchStepsDtoResult
    } catch (error) {
      console.error('Error fetching steps:', error)
      throw error // Rethrow for higher-level handling
    }
  }

  /**
   * It retrieves all the tasks that the agent needs to execute to complete the different tasks assigned.
   *
   * @remarks
   * This method is used by the AI Agent to retrieve information about the tasks created by users to the agents owned by the user
   *
   * @returns The tasks of the agents
   */
  async getTasksFromAgents() {
    return this.get(GET_AGENTS_ENDPOINT, { sendThroughProxy: false })
  }

  /**
   * It emits a log message related to a task
   *
   * @remarks
   * This method is used by the AI Agent to emit log messages
   *
   */
  async logTask(logMessage: TaskLogMessage) {
    super._emitTaskLog(logMessage)
  }
}
