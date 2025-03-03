import { EnvironmentName } from '../environments'

export const FIRST_STEP_NAME = 'init'

/**
 * A task defines something that the agent should execute.
 */
export interface Task extends ExecutionOptions {
  /**
   * The unique identifier of the task
   */
  task_id: string

  /**
   * The status of the execution
   */
  task_status: AgentExecutionStatus

  /**
   * The steps executed by the agent to complete the task
   */
  steps: Step[]

  /**
   * The name of the task
   */
  name?: string
}

export interface Step extends ExecutionOptions {
  /**
   * The unique identifier of the step
   */
  step_id: string

  /**
   * The task that the step belongs to
   */
  task_id: string

  /**
   * The name of the step
   */
  name?: string

  /**
   * The status of the execution
   */
  step_status: AgentExecutionStatus

  /**
   * The step preceeding the current step if any
   */
  predecessor?: string

  /**
   * Whether this is the last step in the task.
   */
  is_last?: boolean
}

export interface ExecutionOptions extends ExecutionInput, ExecutionOutput {
  /**
   * When the execution was created
   */
  created_at?: Date

  /**
   * When the execution was last updated
   */
  updated_at?: Date

  /**
   * The number of retries for the task or step
   */
  retries?: number

  /**
   * The cost in credits resulting from the execution of the task or the step
   */
  cost?: number
}

/**
 * This task can be a question, a prompt, etc. It can include additional parameters and artifacts.
 */
export interface ExecutionInput {
  /**
   * The input for the task. It can be a prompt, a question, etc
   */
  input_query: string

  /**
   * Additional parameters required for the task
   */
  input_params?: { [name: string]: string }[]

  /**
   * List of artifact ids that are associated with the task
   */
  input_artifacts?: Artifact[]
}

/**
 * Output of the task or step execution
 */
export interface ExecutionOutput {
  /**
   * The main output generated by a task or step
   */
  output: any

  /**
   * Additional output generated
   */

  output_additional?: { [name: string]: unknown }

  /**
   * List of artifact generated by the task or step
   */
  output_artifacts?: any[]
}

/**
 * The execution status of a task or a step
 */
export enum AgentExecutionStatus {
  /**
   * The execution is pending
   */
  Pending = 'Pending',

  /**
   * The execution is in progress
   */
  In_Progress = 'In_Progress',

  /**
   * The step or task is not ready to be executed
   */
  Not_Ready = 'Not_Ready',

  /**
   * The execution is completed
   */
  Completed = 'Completed',

  /**
   * The execution is failed
   */
  Failed = 'Failed',
}

export interface Artifact {
  /**
   * The unique identifier of the artifact
   */
  artifact_id: string
  /**
   * Reference to the artifact in a local or remote storage.
   * If it's in the local storage, the URL should be a relative path to the agent workspace.
   * Examples:
   *   - `file://path/to/file`
   *   - `http://example.com/path/to/file`
   */
  url: string
}

export interface TaskLogMessage {
  /**
   * Log level
   */
  level: 'info' | 'error' | 'warning' | 'debug'

  /**
   * The log message
   */
  message: string

  /**
   * Identifier of the task associated with the log
   */
  task_id: string

  /**
   * The status of the task
   */
  task_status?: AgentExecutionStatus

  /**
   * The step id associated with the log message if any
   */
  step_id?: string
}

export interface StepEvent {
  step_id: string
  task_id: string
  did: string
}

export interface TaskEvent {
  task_id: string
  did: string
  task_status: AgentExecutionStatus
}

export type TaskCallback = (data: TaskEvent) => void

/**
 * Options to initialize the Payments class.
 */
export interface PaymentOptions {
  /**
   * The Nevermined environment to connect to.
   * If you are developing an agent it's recommended to use the "testing" environment.
   * When deploying to production use the "arbitrum" environment.
   */
  environment: EnvironmentName

  /**
   * The Nevermined API Key. This key identify your user and is required to interact with the Nevermined API.
   * You can get your API key by logging in to the Nevermined App.
   * @see https://docs.nevermined.app/docs/tutorials/integration/nvm-api-keys
   */
  nvmApiKey?: string

  /**
   * The URL to return to the app after a successful login.
   */
  returnUrl?: string

  /**
   * The app id. This attribute is optional and helps to associate assets registered into Nevermined with a common identifier.
   */
  appId?: string

  /**
   * The version of the API to use.
   */
  version?: string
}

export interface CreateTaskDto {
  /**
   * The query parameter for the task
   */
  input_query: string

  /**
   * The name of the task
   */
  name?: string

  /**
   * Additional parameters required for the task
   */
  input_additional?: { [name: string]: unknown }

  /**
   * Additional artifacts required for the task
   */
  input_artifacts?: Artifact[]
}

export interface Endpoint {
  [verb: string]: string
}

export interface CreatePlanTimeDto {
  /**
   * The name of the plan.
   */
  name: string
  /**
   * A description of what the plan offers.
   */
  description: string
  /**
   * The price of the plan. It must be given in the lowest denomination of the currency.
   */
  price: bigint
  /**
   * The address of the ERC20 contract used for the payment. Using the `ZeroAddress` will use the chain's native currency instead.
   */
  tokenAddress: string
  /**
   * The duration of the plan in days. If `duration` is left undefined an unlimited time duration subscription will be created.
   */
  duration?: number
  /**
   * An array of tags or keywords that best fit the subscription.
   */
  tags?: string[]
}

export interface CreatePlanCreditsDto {
  /**
   * The name of the plan.
   */
  name: string
  /**
   *  A description of what the plan offers.
   */
  description: string
  /**
   * The price of the plan. It must be given in the lowest denomination of the currency.
   */
  price: bigint
  /**
   * The address of the ERC20 contract used for the payment. Using the `ZeroAddress` will use the chain's native currency instead.
   */
  tokenAddress: string
  /**
   * The number of credits that are transferred to the user when purchases the plan.
   */
  amountOfCredits: number
  /**
   *  An array of tags or keywords that best fit the subscription.
   */
  tags?: string[]
}

export interface CreateServiceDto {
  /**
   * The service type ('service', 'agent', or 'assistant').
   */
  serviceType: string
  /**
   * The plan unique identifier of the Plan (DID). @see {@link createCreditsPlan} or {@link createTimePlan}
   */
  planDID: string
  /**
   * The name of the AI Agent/Service.
   */
  name: string
  /**
   * The description of the AI Agent/Service.
   */
  description: string
  /**
   * If the agent is using the AI Hub. If true, the agent will be configured to use the AI Hub endpoints.
   */
  usesAIHub?: boolean
  /**
   * It the agent implements the Nevermined Query Protocol. @see https://docs.nevermined.io/docs/protocol/query-protocol
   */
  implementsQueryProtocol?: boolean
  /**
   *  The service charge type ('fixed' or 'dynamic').
   */
  serviceChargeType: 'fixed' | 'dynamic'
  /**
   * The upstream agent/service authentication type ('none', 'basic', 'bearer' or 'oauth').
   */
  authType?: 'none' | 'basic' | 'oauth' | 'bearer'
  /**
   * The amount of credits to charge per request to the agent.
   */
  amountOfCredits?: number
  /**
   * The minimum credits to charge.
   */
  minCreditsToCharge?: number
  /**
   * The maximum credits to charge.
   */
  maxCreditsToCharge?: number
  /**
   * The upstream agent/service username for authentication. Only if `authType` is 'basic'.
   */
  username?: string
  /**
   * The upstream agent/service password for authentication. Only if `authType` is 'basic'.
   */
  password?: string
  /**
   * The upstream agent/service bearer token for authentication. Only if `authType` is 'bearer' or 'oauth'.
   */
  token?: string
  /**
   * The list endpoints of the upstream service. All these endpoints are protected and only accessible to subscribers of the Payment Plan.
   */
  endpoints?: Endpoint[]
  /**
   * The list of endpoints of the upstream service that publicly available. The access to these endpoints don't require subscription to the Payment Plan. They are useful to expose documentation, etc.
   */
  openEndpoints?: string[]
  /**
   * The URL to the OpenAPI description of the Upstream API. The access to the OpenAPI definition don't require subscription to the Payment Plan.
   */
  openApiUrl?: string
  /**
   * Some description or instructions about how to integrate the Agent.
   */
  integration?: string
  /**
   * A link to some same usage of the Agent.
   */
  sampleLink?: string
  /**
   * Text describing the API of the Agent.
   */
  apiDescription?: string
  /**
   * The curation details.
   */
  curation?: object
  /**
   * The tags describing the AI Agent/Service.
   */
  tags?: string[]
}

export type CreateAgentDto = Omit<CreateServiceDto, 'serviceType'>

export type CreateFileDto = {
  /**
   * The plan unique identifier of the Plan (DID). @see {@link createCreditsPlan} or {@link createTimePlan}
   */
  planDID: string
  /**
   * @param assetType - The type of asset ('dataset' | 'algorithm' | 'model' | 'file' | 'other')
   *
   */
  assetType: 'dataset' | 'algorithm' | 'model' | 'file' | 'other'
  /**
   *  The name of the file.
   */
  name: string
  /**
   * The description of the file.
   */
  description: string
  /**
   * The array of files that can be downloaded for users that are subscribers of the Payment Plan.
   */
  files: object[]
  /**
   * The data schema of the files.
   */
  dataSchema?: string
  /**
   * Some sample code related to the file.
   */
  sampleCode?: string
  /**
   * The format of the files.
   */
  filesFormat?: string
  /**
   * The usage example.
   */
  usageExample?: string
  /**
   * The programming language used in the files.
   */
  programmingLanguage?: string
  /**
   * The framework used for creating the file.
   */
  framework?: string
  /**
   * The task creating the file.
   */
  task?: string
  /**
   * The training details.
   */
  trainingDetails?: string
  /**
   *  The variations.
   */
  variations?: string
  /**
   * Indicates if the file is fine-tunable.
   */
  fineTunable?: boolean
  /**
   * The cost in credits of downloading a file. This parameter is only required if the Payment Plan attached to the file is based on credits.
   */
  amountOfCredits?: number
  /**
   * The curation object.
   */
  curation?: object
  /**
   * The array of tags describing the file.
   */
  tags?: string[]
}

export interface BaseStepDto {
  task_id: string
  input_query: string
  input_additional?: { [name: string]: unknown }
  input_artifacts?: Artifact[]
  name?: string
  order?: number
  cost?: number
  predecessor?: string
  is_last?: boolean
}

export interface UpdateStepDto extends BaseStepDto {
  step_id: string
  did: string
  step_status: AgentExecutionStatus
  output: string
  output_additional?: { [name: string]: unknown }
  output_artifacts?: Artifact[]
}

export type CreateTaskResultDto = {
  task: AgentTaskEntity
  steps: AgentStepEntity
}

export type FullTaskDto = {
  task: AgentTaskEntity
  steps: AgentStepEntity
  logs: AgentTaskLogsEntity
}

export type AgentTaskEntity = {
  task_id: string
  did: string
  user: string
  task_status: AgentExecutionStatus
  name: string
  input_query: string
  input_params: string
  input_artifacts: string
  output: string
  output_additional: string
  output_artifacts: string
  cost: number
  createdAt: Date
  updatedAt: Date
}
export type AgentStepEntity = {
  step_id: string
  step_status: AgentExecutionStatus
  retries: number
  is_waiting: boolean
  is_last: boolean
  order: number
  input_query: string
  input_artifacts: string
  input_params: string
  output: string
  output_additional: string
  output_artifacts: string
  cost: number
  createdAt: Date
  updatedAt: Date
}

export type AgentTaskLogsEntity = {
  tl_id: string
  task_id: string
  task_status: AgentExecutionStatus
  level: TaskLogLevel
  message: string
  step_id: string
  createdAt: Date
  updatedAt: Date
}

export enum TaskLogLevel {
  debug = 'debug',
  info = 'info',
  warn = 'warn',
  error = 'error',
}

export interface SearchTasks {
  did?: string
  task_id?: string
  name?: string
  task_status?: AgentExecutionStatus
  page?: number
  offset?: number
}

export interface SearchSteps {
  step_id?: string
  task_id?: string
  did?: string
  name?: string
  step_status?: AgentExecutionStatus
  page?: number
  offset?: number
}

export interface SearchStepsDtoResult {
  steps: UpdateStepDto[]
  totalResults: number
  page?: number
  offset?: number
}

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}
