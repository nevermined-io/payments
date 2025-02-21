import axios from 'axios'
import { decodeJwt } from 'jose'
import { io } from 'socket.io-client'
import { sleep } from '../common/helper'
import { PaymentsError } from '../common/payments.error'
import { AgentExecutionStatus, TaskCallback, TaskLogMessage } from '../common/types'
import { isEthereumAddress } from '../utils'

export interface BackendApiOptions {
  /**
   * The host of the backend server
   */
  backendHost: string

  /**
   * The Nevermined API Key. This key identify your user and is required to interact with the Nevermined API.
   * You can get your API key by logging in to the Nevermined App.
   * @see https://docs.nevermined.app/docs/tutorials/integration/nvm-api-keys
   */
  apiKey?: string

  /**
   * The host of the websocket server
   */
  webSocketHost?: string

  /**
   * The host of the Nevermined Proxy
   */
  proxyHost?: string

  /**
   * Additional headers to send with the requests
   */
  headers?: { [key: string]: string }

  /**
   * Configuration of the websocket connection
   */
  webSocketOptions?: BackendWebSocketOptions
}

export interface BackendWebSocketOptions {
  /**
   * The websocket transports to use
   */
  transports: string[]

  /**
   * Authentication parameters
   */
  auth: { token: string }

  /**
   * The path to connect to the websocket server
   */
  path?: string

  /**
   * The bearer token to use in the websocket connection
   */
  bearerToken?: string

  /**
   * Additional options to pass to the websocket transport
   */
  transportOptions?: { [key: string]: any }
}

export class HTTPRequestOptions {
  sendThroughProxy: boolean = true
  proxyHost?: string = undefined
  headers?: { [key: string]: string } = {}
}

export class SubscriptionOptions {
  joinAccountRoom: boolean = true
  joinAgentRooms: string[] = []
  subscribeEventTypes: string[] = ['step-updated']
  getPendingEventsOnSubscribe: boolean = true
}

export const DefaultSubscriptionOptions = {
  joinAccountRoom: true,
  joinAgentRooms: [],
  subscribeEventTypes: ['step-updated'],
  getPendingEventsOnSubscribe: true,
}

export class NVMBackendApi {
  protected opts: BackendApiOptions
  private socketClient: any
  private userRoomId: string | undefined = undefined
  private taskCallbacks: Map<string, TaskCallback> = new Map()
  private hasKey = false
  private _defaultSocketOptions: BackendWebSocketOptions = {
    // path: '',
    transports: ['websocket'],
    auth: { token: '' },
  }
  private did = ''

  constructor(opts: BackendApiOptions) {
    const defaultHeaders = {
      Accept: 'application/json',
      ...opts.headers,
      ...(opts.apiKey && { Authorization: `Bearer ${opts.apiKey}` }),
    }

    if (opts.webSocketOptions?.bearerToken) {
      // If the user pass a specific websocketoptions bearer token we use that one
      opts.webSocketOptions = {
        ...this._defaultSocketOptions,
        ...opts.webSocketOptions,
        auth: { token: `Bearer ${opts.webSocketOptions!.bearerToken}` },
      }
    } else if (opts.apiKey) {
      // If not use the api key
      opts.webSocketOptions = {
        ...this._defaultSocketOptions,
        ...opts.webSocketOptions,
        auth: { token: `Bearer ${opts.apiKey}` },
      }
    }

    this.opts = {
      ...opts,
      webSocketOptions: {
        ...this._defaultSocketOptions,
        ...opts.webSocketOptions,
      },
      headers: defaultHeaders,
    }

    try {
      if (this.opts.apiKey && this.opts.apiKey.length > 0) {
        const jwt = decodeJwt(this.opts.apiKey)
        if (isEthereumAddress(jwt.sub)) {
          this.userRoomId = `room:${jwt.sub}`
          this.hasKey = true
        }
      }
    } catch {
      this.hasKey = false
      this.userRoomId = undefined
    }

    let backendUrl
    try {
      backendUrl = new URL(this.opts.backendHost)
      this.opts.backendHost = backendUrl.origin
    } catch (error) {
      throw new Error(`Invalid URL: ${this.opts.backendHost} - ${(error as Error).message}`)
    }

    this.taskCallbacks = new Map()
  }

  private async _connectInternalSocketClient() {
    if (!this.hasKey)
      throw new Error('Unable to subscribe to the server becase a key was not provided')

    if (this.isWebSocketConnected()) {
      //   `_connectInternalSocketClient:: Already connected to the websocket server with id ${this.socketClient.id}`,
      return
    }

    this.socketClient = io(this.opts.webSocketHost!, this.opts.webSocketOptions)
    await this.socketClient.connect()
    for (let i = 0; i < 10; i++) {
      if (this.isWebSocketConnected()) return
      await sleep(500)
    }
    if (!this.isWebSocketConnected()) {
      throw new Error('Unable to connect to the websocket server')
    }
  }

  protected async connectSocketSubscriber(
    _callback: (err?: any) => any,
    opts: SubscriptionOptions,
  ) {
    try {
      // nvm-backend:: Connecting to websocket server: ${this.opts.webSocketHost}
      this._connectInternalSocketClient()

      await this.socketClient.on('_connected', async () => {
        this._subscribe(_callback, opts)
      })
    } catch (error) {
      throw new PaymentsError(
        `Unable to initialize websocket client: ${this.opts.webSocketHost} - ${(error as Error).message}`,
      )
    }
  }

  protected async connectTasksSocket(
    _callback: (err?: any) => any,
    tasks: string[],
    history = true,
  ) {
    try {
      if (tasks.length === 0) {
        throw new Error('No task rooms to join in configuration')
      }

      this._connectInternalSocketClient()

      tasks.forEach((task) => {
        this.taskCallbacks.set(task, _callback)
      })

      await this.socketClient.emit('_join-tasks', JSON.stringify({ tasks, history }))
      this.socketClient.on('_join-tasks_', async () => {
        this.socketClient.on('task-updated', this.handleTaskUpdateEvent.bind(this, tasks))
      })
    } catch (error) {
      throw new PaymentsError(
        `Unable to initialize websocket client: ${this.opts.webSocketHost} - ${(error as Error).message}`,
      )
    }
  }

  /**
   * Handles the 'task-updated' event from the websocket.
   * Parses the incoming data, retrieves the corresponding callback,
   * executes it, and removes the callback if the task is completed or failed.
   *
   * @param boundTasks - The list of task IDs that the callback is bound to.
   * @param data - The data received from the websocket event.
   */
  private handleTaskUpdateEvent(boundTasks: string[], data: any): void {
    const parsedData = JSON.parse(data)
    const { task_id: taskId } = parsedData

    // If the task ID is not in the list of bound tasks, ignore the event
    if (!boundTasks.includes(taskId)) {
      return
    }

    const callback = this.taskCallbacks.get(taskId)
    if (callback && parsedData.did !== this.did) {
      // Execute the stored callback
      callback(data)
      if (['Completed', 'Failed'].includes(parsedData.task_status)) {
        // Remove the callback from the map once the task is completed
        this.removeTaskCallback(taskId)
      }
    }
  }

  /**
   * Removes the callback associated with the given task ID.
   * Logs the removal of the callback.
   *
   * @param taskId - The ID of the task whose callback is to be removed.
   */
  private removeTaskCallback(taskId: string) {
    if (this.taskCallbacks.has(taskId)) {
      this.taskCallbacks.delete(taskId)
    }
  }

  private disconnectSocket() {
    if (this.isWebSocketConnected()) {
      this.socketClient.disconnect()
    }
  }

  public isWebSocketConnected() {
    if (this.socketClient) return this.socketClient.connected
    return false
  }

  protected async _subscribe(_callback: (err?: any) => any, opts: SubscriptionOptions) {
    if (!opts.joinAccountRoom && opts.joinAgentRooms.length === 0) {
      throw new Error('No rooms to join in configuration')
    }

    await this.socketClient.emit('_join-rooms', JSON.stringify(opts))

    opts.subscribeEventTypes.forEach(async (eventType) => {
      await this.socketClient.on(eventType, (data: any) => {
        this.eventHandler(data, _callback, opts)
      })
    })
    if (opts.getPendingEventsOnSubscribe) {
      await this._emitStepEvents(AgentExecutionStatus.Pending, opts.joinAgentRooms)
    }
  }

  private async eventHandler(data: any, _callback: (err?: any) => any, _opts: SubscriptionOptions) {
    try {
      _callback(data)
      this.did = JSON.parse(data).did
    } catch (error) {
      throw new Error(`Unable to parse data: ${(error as Error).message}`)
    }
  }

  protected async _emitStepEvents(
    status: AgentExecutionStatus = AgentExecutionStatus.Pending,
    dids: string[] = [],
  ) {
    const message = {
      status,
      dids,
    }
    this.socketClient.emit('_emit-steps', JSON.stringify(message))
  }

  protected async _emitTaskLog(logMessage: TaskLogMessage) {
    this.socketClient.emit('_task-log', JSON.stringify(logMessage))
  }

  disconnect() {
    this.disconnectSocket()
    // nvm-backend:: Disconnected from the server
  }

  parseUrl(uri: string, reqOptions: HTTPRequestOptions) {
    let _host: URL
    if (reqOptions.sendThroughProxy) {
      if (reqOptions.proxyHost) _host = new URL(reqOptions.proxyHost)
      else if (this.opts.proxyHost) _host = new URL(this.opts.proxyHost)
      else _host = new URL(this.opts.backendHost)
    } else _host = new URL(this.opts.backendHost)
    return `${_host.origin}${uri}`
  }

  parseHeaders(additionalHeaders: { [key: string]: string }) {
    return {
      ...this.opts.headers,
      ...additionalHeaders,
    }
  }

  setBearerToken(token: string) {
    this.opts.headers = {
      ...this.opts.headers,
      Authorization: `Bearer ${token}`,
    }
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any,
    reqOptions: HTTPRequestOptions = {
      sendThroughProxy: false,
    },
  ) {
    try {
      const response = await axios({
        method,
        url: this.parseUrl(url, reqOptions),
        headers: this.parseHeaders(reqOptions.headers || {}),
        ...(data && { data }), // Only include `data` for methods that support it
      })

      return response
    } catch (err) {
      if (axios.isAxiosError(err) && err.response) {
        throw new Error(
          `HTTP ${err.response.status}: ${err.response.data?.message || 'Request failed'}`,
        )
      }
      throw new Error('Network error or request failed without a response.')
    }
  }

  async get(url: string, reqOptions: HTTPRequestOptions = { sendThroughProxy: true }) {
    return this.request('GET', url, undefined, reqOptions)
  }

  async post(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return this.request('POST', url, data, reqOptions)
  }

  async put(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return this.request('PUT', url, data, reqOptions)
  }

  async delete(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return this.request('DELETE', url, data, reqOptions)
  }
}
