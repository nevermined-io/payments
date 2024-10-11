import axios from 'axios'
import { io } from 'socket.io-client'
import { decodeJwt } from 'jose'
import { isEthereumAddress, sleep } from '../common/utils'
import { AgentExecutionStatus } from '../common/types'

export interface BackendApiOptions {
  backendHost: string
  apiKey?: string
  webSocketHost?: string
  proxyHost?: string
  headers?: { [key: string]: string }
  webSocketOptions?: BackendWebSocketOptions
}

export interface BackendWebSocketOptions {
  path?: string
  transports?: string[]
  bearerToken?: string
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
  subscribeEventTypes: string[] = []
  getPendingEventsOnSubscribe: boolean = true
}

export const DefaultSubscriptionOptions = {
  joinAccountRoom: true,
  joinAgentRooms: [],
  subscribeEventTypes: [],
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

    if (opts.webSocketOptions?.bearerToken) { // If the user pass a specific websocketoptions bearer token we use that one
      opts.webSocketOptions = {
        ...opts.webSocketOptions,
        transportOptions: {
          websocket: {
            extraHeaders: { Authorization: `Bearer ${opts.webSocketOptions!.bearerToken}` },
          },
        },
      }
    } else if (opts.apiKey) { // If not use the api key
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
      console.log('nvm-backend:: Already connected to the websocket server')
      return
    }
    try {
      console.log(`nvm-backend:: Connecting to websocket server: ${this.opts.webSocketHost}`)
      console.log(JSON.stringify(this.opts.webSocketOptions))
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
      console.log('is connected: ', this.socketClient.connected)
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
    await this.socketClient.on('connect', async () => {
      console.log(`nvm-backend:: On:: ${this.socketClient.id} Connected to the server`)      
    })
    console.log(`Subscription Options: ${JSON.stringify(opts)}`)
    await this.socketClient.emit('_join-rooms', JSON.stringify(opts))

    // await this.socketClient.on('task-updated', (data: any) => {
    //   console.log(`RECEIVED TASK data: ${JSON.stringify(data)}`)
    //   _callback(data)
    // })
    await this.socketClient.on('step-updated', (data: any) => {
      console.log(`RECEIVED STEP data: ${JSON.stringify(data)}`)
      _callback(data)
    })

    // if (opts.joinAccountRoom) {
    //   // await this.socketClient.on(this.userRoomId, _callback)
    //   await this.socketClient.on(this.userRoomId, (data: any) => {
    //     console.log(`RECEIVED Websocket data [${this.userRoomId}] : ${JSON.stringify(data)}`)
    //     _callback(data)
    //   })
    //   console.log(`nvm-backend:: ${this.socketClient.id} Joined room: ${this.userRoomId}`)
    // }

    // opts.joinAgentRooms.forEach(async (_did) => {
    //   const room = `room:${_did}`
    //   await this.socketClient.on(room, _callback)
    //   console.log(`nvm-backend:: ${this.socketClient.id} Joined room: ${room}`)
    // })
  }

  private async eventHandler(data: any, _callback: (err?: any) => any, _opts: SubscriptionOptions) {
    console.log('nvm-backend:: Event received', data)
    _callback(data)
    // if (opts.subscribeEventTypes.length > 0) {
    //   if (opts.subscribeEventTypes.includes(data.event)) {
    //     _callback(data)
    //   }
    // } else {
    //   _callback(data)
    // }
  }

  protected async _emitStepEvents(status: AgentExecutionStatus = AgentExecutionStatus.Pending, dids: string[] = []) {
    await this.connectSocket()
    const message = {
      status,
      dids
    }
    this.socketClient.emit('_emit-steps', JSON.stringify(message))
  }

  disconnect() {
    this.disconnectSocket()
    console.log('nvm-backend:: Disconnected from the server')
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

    console.log('POST URL', this.parseUrl(url, reqOptions))
    console.log('POST DATA', data)
    console.log('POST HEADERS', this.parseHeaders(reqOptions.headers || {}))
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
