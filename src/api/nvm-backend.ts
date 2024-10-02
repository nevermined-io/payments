import axios from 'axios'
import { io } from 'socket.io-client'
import { decodeJwt } from 'jose'

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

export class SubscriptionOptions {
  joinAccountRoom: boolean = true
  joinAgentRooms: string[] = []
}

export const DefaultSubscriptionOptions = {
  joinAccountRoom: true,
  joinAgentRooms: [],
}

export class NVMBackendApi {
  private opts: BackendApiOptions
  private socketClient: any
  private userRoomId: string | undefined = undefined
  private hasKey = false
  private _defaultSocketOptions: BackendWebSocketOptions = {
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

    if (opts.webSocketOptions?.bearerToken)
      opts.webSocketOptions = {
        ...opts.webSocketOptions,
        transportOptions: {
          websocket: {
            extraHeaders: { Authorization: `Bearer ${opts.webSocketOptions!.bearerToken}` },
          },
        },
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
        if (jwt.sub && !jwt.sub.match(/^0x[a-fA-F0-9]{40}$/)) {
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

    console.log(JSON.stringify(this.opts))
  }

  private async connectSocket() {
    if (!this.hasKey)
      throw new Error('Unable to subscribe to the server becase a key was not provided')

    if (this.socketClient && this.socketClient.connected) {
      return
    }
    try {
      console.log(`nvm-backend:: Connecting to websocket server: ${this.opts.webSocketHost}`)
      console.log(this.opts.webSocketOptions)
      this.socketClient = io(this.opts.webSocketHost, this.opts.webSocketOptions)
      await this.socketClient.connect()
      console.log('is connected: ', this.socketClient.connected)
    } catch (error) {
      throw new Error(
        `Unable to initialize websocket client: ${this.opts.webSocketHost} - ${(error as Error).message}`,
      )
    }
  }

  private disconnectSocket() {
    if (this.socketClient && this.socketClient.connected) {
      this.socketClient.disconnect()
    }
  }

  protected async _subscribe(_callback: (err?: any) => any, opts: SubscriptionOptions) {
    if (!opts.joinAccountRoom && opts.joinAgentRooms.length === 0) {
      throw new Error('No rooms to join in configuration')
    }
    await this.connectSocket()
    await this.socketClient.on('connect', () => {
      console.log('nvm-backend:: Subscribe:: Connected to the server')
    })

    if (opts.joinAccountRoom) {
      await this.socketClient.on(this.userRoomId, _callback)
      console.log(`nvm-backend:: Joined room: ${this.userRoomId}`)
    }

    opts.joinAgentRooms.forEach(async (room) => {
      await this.socketClient.on(room, _callback)
      console.log(`nvm-backend:: Joined room: ${room}`)
    })
  }

  protected async _emitEvents(data: any) {
    await this.connectSocket()
    if (data.steps.length > 0) {
      data.steps.forEach(async (step: any) => {
        try {
          const message = JSON.stringify({
            event: 'step-created',
            data: {
              stepId: step.step_id,
              taskId: step.task_id,
            },
          })
          await this.socketClient.emit(this.userRoomId, message)
          await this.socketClient.emit(`room:${step.did}`, message)
        } catch {
          console.error('nvm-backend:: Error emitting events')
        }
      })
    }
  }

  disconnect() {
    this.disconnectSocket()
    console.log('nvm-backend:: Disconnected from the server')
  }

  parseUrl(uri: string) {
    return this.opts.proxyHost ? `${this.opts.proxyHost}${uri}` : `${this.opts.backendHost}${uri}`
  }

  setBearerToken(token: string) {
    this.opts.headers = {
      ...this.opts.headers,
      Authorization: `Bearer ${token}`,
    }
  }

  async get(url: string) {
    return axios({
      method: 'GET',
      url: this.parseUrl(url),
      headers: this.opts.headers,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async post(url: string, data: any) {
    return axios({
      method: 'POST',
      url: this.parseUrl(url),
      headers: this.opts.headers,
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async put(url: string, data: any) {
    return axios({
      method: 'PUT',
      url: this.parseUrl(url),
      headers: this.opts.headers,
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }

  async delete(url: string, data: any) {
    return axios({
      method: 'DELETE',
      url: this.parseUrl(url),
      headers: this.opts.headers,
      data: data,
    }).catch((err) => {
      return { data: err.response.data, status: err.response.status, headers: err.response.headers }
    })
  }
}
