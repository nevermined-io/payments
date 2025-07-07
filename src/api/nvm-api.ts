import axios from 'axios'

export const API_URL_REGISTER_PLAN = '/api/v1/protocol/plans'
export const API_URL_REGISTER_AGENT = '/api/v1/protocol/agents'
export const API_URL_REGISTER_AGENTS_AND_PLAN = '/api/v1/protocol/agents/plans'
export const API_URL_GET_AGENT = '/api/v1/protocol/agents/:agentId'
export const API_URL_GET_AGENT_PLANS = '/api/v1/protocol/agents/:agentId/plans'
export const API_URL_GET_PLAN = '/api/v1/protocol/plans/:planId'
export const API_URL_GET_PLAN_AGENTS = '/api/v1/protocol/plans/:planId/agents'
export const API_URL_ORDER_PLAN = '/api/v1/protocol/plans/:planId/order'
export const API_URL_MINT_PLAN = '/api/v1/protocol/plans/mint'
export const API_URL_MINT_EXPIRABLE_PLAN = '/api/v1/protocol/plans/mintExpirable'
export const API_URL_ADD_PLAN_AGENT = '/api/v1/protocol/agents/:agentId/plan/:planId'
export const API_URL_REMOVE_PLAN_AGENT = '/api/v1/protocol/agents/:agentId/plan/:planId'
export const API_URL_REDEEM_PLAN = '/api/v1/protocol/plans/redeem'
export const API_URL_PLAN_BALANCE = '/api/v1/protocol/plans/:planId/balance/:holderAddress'
export const API_URL_GET_AGENT_ACCESS_TOKEN = '/api/v1/protocol/token/:planId/:agentId'
export const API_URL_INITIALIZE_AGENT = '/api/v1/protocol/agents/initialize/:agentId'
export const API_URL_TRACK_AGENT_SUB_TASK = '/api/v1/protocol/agent-sub-tasks'
export const API_URL_VALIDATE_AGENT_ACCESS_TOKEN = '/api/v1/protocol/token/validate/:agentId'

export const API_URL_STRIPE_CHECKOUT = '/api/v1/stripe/checkout'

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
   * The host of the Nevermined Proxy
   */
  proxyHost?: string

  /**
   * Additional headers to send with the requests
   */
  headers?: { [key: string]: string }
}

export class HTTPRequestOptions {
  accessToken?: string
  sendThroughProxy: boolean = true
  proxyHost?: string = undefined
  headers?: { [key: string]: string } = {}
}

export abstract class AbstractHTTPClient {
  // protected opts: BackendApiOptions
  // private hasKey = false
  // private agentId = ''

  // constructor(opts: BackendApiOptions) {
  //   const defaultHeaders = {
  //     Accept: 'application/json',
  //     ...opts.headers,
  //     ...(opts.apiKey && { Authorization: `Bearer ${opts.apiKey}` }),
  //   }

  //   this.opts = {
  //     ...opts,
  //     headers: defaultHeaders,
  //   }

  //   try {
  //     if (this.opts.apiKey && this.opts.apiKey.length > 0) {
  //       const jwt = decodeJwt(this.opts.apiKey)
  //       if (isEthereumAddress(jwt.sub)) {
  //         this.hasKey = true
  //       }
  //     }
  //   } catch {
  //     this.hasKey = false
  //   }

  //   let backendUrl
  //   try {
  //     backendUrl = new URL(this.opts.backendHost)
  //     this.opts.backendHost = backendUrl.origin
  //   } catch (error) {
  //     throw new Error(`Invalid URL: ${this.opts.backendHost} - ${(error as Error).message}`)
  //   }
  // }

  constructor() {}

  parseUrl(urlRequested: string, reqOptions: HTTPRequestOptions) {
    let _host: URL
    if (reqOptions.sendThroughProxy) {
      if (!reqOptions.proxyHost)
        throw new Error('Proxy host is required when sendThroughProxy is true')
      return `${new URL(reqOptions.proxyHost).origin}${new URL(urlRequested).href}`
    } else {
      return urlRequested
    }
  }

  parseHeaders(requestHeaders: { [key: string]: string }, accessToken?: string) {
    return {
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      ...requestHeaders,
    }
  }

  // setBearerToken(token: string) {
  //   this.opts.headers = {
  //     ...this.opts.headers,
  //     Authorization: `Bearer ${token}`,
  //   }
  // }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
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
        headers: this.parseHeaders(reqOptions.headers || {}, reqOptions.accessToken),
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
