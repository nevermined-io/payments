import { BackendApiOptions, HTTPRequestOptions, NVMBackendApi } from './nvm-api'

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
   * Get the required configuration for accessing a remote service agent.
   * This configuration includes:
   * - The JWT access token
   * - The Proxy url that can be used to query the agent/service.
   *
   * @example
   * ```
   * const accessConfig = await payments.query.getServiceAccessConfig(agentId)
   * console.log(`Agent JWT Token: ${accessConfig.accessToken}`)
   * console.log(`Agent Proxy URL: ${accessConfig.neverminedProxyUri}`)
   * ```
   *
   * @param agentId - The unique identifier of the agent
   * @returns A promise that resolves to the service token.
   */
  public async getServiceAccessConfig(agentId: string): Promise<{
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
    const url = new URL(`/api/v1/payments/service/token/${agentId}`, this.opts.backendHost)
    const response = await fetch(url, options)
    if (!response.ok) {
      throw Error(`${response.statusText} - ${await response.text()}`)
    }

    return (await response.json()).token
  }

  /**
   * It sends a request to the AI Agent/Service.
   *
   * @remarks
   * This method is used to query an existing AI Agent. It requires the user controlling the NVM API Key to have access to the agent.
   *
   * @remarks
   * To send this request through a Nevermined proxy, it's necessary to specify the "sendThroughProxy" in the reqOptions parameter
   * @example
   * ```
   * await payments.query.send('POST', 'http://example.com/agent/prompt', {'input': 'Hello'})
   * ```
   *
   * @param method - The HTTP method to use when querying the Agent @see {@link AxiosRequestConfig.method}
   * @param url - The URL of the endpoint to query the Agent/Service.
   * @param data - The data to send to the Agent/Service.
   * @param reqOptions - The request options to use when querying the Agent/Service.
   * @returns The result of query
   */
  async send(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    reqOptions: HTTPRequestOptions = {
      sendThroughProxy: false,
    },
  ) {
    return this.request(method, url, data, reqOptions)
  }
}
