import axios from 'axios'
import { decodeJwt } from 'jose'
import { io } from 'socket.io-client'
import { sleep } from '../common/helper'
import { AgentExecutionStatus } from '../common/types'
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
   * The path to connect to the websocket server
   */
  path?: string

  /**
   * The websocket transports to use
   */
  transports?: string[]

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
  private opts: BackendApiOptions
  private socketClient: any
  private userRoomId: string | undefined = undefined
  private hasKey = false
  private _defaultSocketOptions: BackendWebSocketOptions = {
    // path: '',
    transports: ['websocket'],
    transportOptions: {
      websocket: {
        extraHeaders: {},
      },
    },
  }

  constructor(opts: BackendApiOptions) {
    const defaultHeaders = {
      Accept: 'application/json',
      ...opts.headers,
      ...(opts.apiKey && { Authorization: `Bearer ${opts.apiKey}` }),
    }

    if (opts.webSocketOptions?.bearerToken) {
      // If the user pass a specific websocketoptions bearer token we use that one
      opts.webSocketOptions = {
        ...opts.webSocketOptions,
        transportOptions: {
          websocket: {
            extraHeaders: { Authorization: `Bearer ${opts.webSocketOptions!.bearerToken}` },
          },
        },
      }
    } else if (opts.apiKey) {
      // If not use the api key
      opts.webSocketOptions = {
        ...opts.webSocketOptions,
        transportOptions: {
          websocket: {
            extraHeaders: { Authorization: `Bearer ${opts.apiKey}` },
          },
        },
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
        // if (jwt.sub && !jwt.sub.match(/^0x[a-fA-F0-9]{40}$/)) {
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
  }

  private async connectSocket() {
    if (!this.hasKey)
      throw new Error('Unable to subscribe to the server becase a key was not provided')

    if (this.socketClient && this.socketClient.connected) {
      // nvm-backend:: Already connected to the websocket server
      return
    }
    try {
      // nvm-backend:: Connecting to websocket server: ${this.opts.webSocketHost}
      this.socketClient = io(this.opts.webSocketHost!, this.opts.webSocketOptions)
      await this.socketClient.connect()
      for (let i = 0; i < 5; i++) {
        await sleep(1_000)
        if (this.socketClient.connected) {
          break
        }
      }
      if (!this.socketClient.connected) {
        throw new Error('Unable to connect to the websocket server')
      }
    } catch (error) {
      throw new Error(
        `Unable to initialize websocket client: ${this.opts.webSocketHost} - ${(error as Error).message}`,
      )
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
    await this.connectSocket()
    // await this.socketClient.emit('subscribe-agent', '')
    await this.socketClient.on('_connected', async () => {
      await this.socketClient.emit('_join-rooms', JSON.stringify(opts))

      opts.subscribeEventTypes.forEach(async (eventType) => {
        await this.socketClient.on(eventType, (data: any) => {
          _callback(data)
        })
      })
      // nvm-backend:: On:: ${this.socketClient.id} Connected to the server
    })

    // await this.socketClient.on('task-updated', (data: any) => {
    //   console.log(`RECEIVED TASK data: ${JSON.stringify(data)}`)
    //   _callback(data)
    // })
  }

  private async eventHandler(data: any, _callback: (err?: any) => any, _opts: SubscriptionOptions) {
    _callback(data)
  }

  protected async _emitStepEvents(
    status: AgentExecutionStatus = AgentExecutionStatus.Pending,
    dids: string[] = [],
  ) {
    await this.connectSocket()
    const message = {
      status,
      dids,
    }
    this.socketClient.emit('_emit-steps', JSON.stringify(message))
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

  async get(url: string, reqOptions: HTTPRequestOptions = { sendThroughProxy: true }) {
    return axios({
      method: 'GET',
      url: this.parseUrl(url, reqOptions),
      headers: this.parseHeaders(reqOptions.headers || {}),
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async post(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return axios({
      method: 'POST',
      url: this.parseUrl(url, reqOptions),
      headers: this.parseHeaders(reqOptions.headers || {}),
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async put(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return axios({
      method: 'PUT',
      url: this.parseUrl(url, reqOptions),
      headers: this.parseHeaders(reqOptions.headers || {}),
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async delete(url: string, data: any, reqOptions: HTTPRequestOptions) {
    return axios({
      method: 'DELETE',
      url: this.parseUrl(url, reqOptions),
      headers: this.parseHeaders(reqOptions.headers || {}),
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }
}
