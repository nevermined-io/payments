import { AgentExecutionStatus } from '../common/types'
import {
  BackendApiOptions,
  DefaultSubscriptionOptions,
  NVMBackendApi,
  SubscriptionOptions,
} from './nvm-backend'

export const SEARCH_TASKS_ENDPOINT = '/api/v1/agents/search'
export const CREATE_STEPS_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/steps'
export const UPDATE_STEP_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/step/{stepId}'
export const GET_AGENTS_ENDPOINT = '/api/v1/agents'
export const GET_BUILDER_STEPS_ENDPOINT = '/api/v1/agents/steps'
export const GET_TASK_STEPS_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}/steps'
export const TASK_ENDPOINT = '/api/v1/agents/{did}/tasks'
export const GET_TASK_ENDPOINT = '/api/v1/agents/{did}/tasks/{taskId}'

export class AIQueryApi extends NVMBackendApi {
  constructor(opts: BackendApiOptions) {
    super(opts)
  }

  async subscribe(
    _callback: (err?: any) => any,
    opts: SubscriptionOptions = DefaultSubscriptionOptions,
  ) {
    await super._subscribe(_callback, opts).then(() => {
      console.log('query-api:: Connected to the server')
    })
    const pendingSteps = await this.getSteps(AgentExecutionStatus.Pending)
    await super._emitEvents(pendingSteps)
  }

  /**
   * It creates a new task for the agent (did)
   * @param did - Agent DID
   * @param task - Task object
   * @returns The result of the operation
   */
  async createTask(did: string, task: any) {
    const endpoint = TASK_ENDPOINT.replace('{did}', did)
    console.log('endpoint', endpoint)
    return this.post(endpoint, task)
  }

  /**
   *
   * @param did - Agent DID
   * @param taskId - Task ID
   * @param steps - The list of Steps to create
   * @returns The result of the operation
   */
  async createSteps(did: string, taskId: string, steps: any) {
    const endpoint = CREATE_STEPS_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId)
    return this.post(endpoint, steps)
  }

  /**
   * It updates the step with the new information
   * @param did - Agent DID
   * @param taskId - Task ID
   * @param stepId - Step ID
   * @param step - The Step object to update
   * @returns The result of the operation
   */
  async updateStep(did: string, taskId: string, stepId: string, step: any) {
    const endpoint = UPDATE_STEP_ENDPOINT.replace('{did}', did)
      .replace('{taskId}', taskId)
      .replace('{stepId}', stepId)
    return this.put(endpoint, step)
  }

  /**
   * It search tasks based on the search parameters
   * @param searchParams - The search parameters
   * @returns The result of the search query
   */
  async searchTasks(searchParams: any) {
    return this.post(SEARCH_TASKS_ENDPOINT, searchParams)
  }

  /**
   * It returns the full task and the steps resulted of the execution of the task
   * @param did - Agent DID
   * @param taskId - Task ID
   * @returns The task with the steps
   */
  async getTaskWithSteps(did: string, taskId: string) {
    return this.get(GET_TASK_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId))
  }

  /**
   * It retrieves all the steps that the agent needs to execute to complete a specific task.
   * @param did - Agent DID
   * @param taskId - Task ID
   * @param status - The status of the steps to retrieve
   * @returns The steps of the task
   */
  async getStepsFromTask(did: string, taskId: string, status?: string) {
    let endpoint = GET_TASK_STEPS_ENDPOINT.replace('{did}', did).replace('{taskId}', taskId)
    if (status) endpoint += `?status=${status}`
    return this.get(endpoint)
  }

  /**
   * It retrieves all the steps that the agent needs to execute to complete the different tasks assigned.
   * @param status - The status of the steps to retrieve
   * @param dids - The list of DIDs to filter the steps
   * @returns The steps of the task
   */
  async getSteps(
    status: AgentExecutionStatus | undefined = AgentExecutionStatus.Pending,
    dids: string[] = [],
  ) {
    let endpoint = GET_BUILDER_STEPS_ENDPOINT + '?'
    if (status) endpoint += `&status=${status.toString()}`
    if (dids.length > 0) endpoint += `&dids=${dids.join(',')}`
    return this.get(endpoint)
  }

  /**
   * It retrieves all the tasks that the agent needs to execute to complete the different tasks assigned.
   * @returns The tasks of the agents
   */
  async getTasksFromAgents() {
    return this.get(GET_AGENTS_ENDPOINT)
  }
}
