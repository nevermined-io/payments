import { AbstractHTTPClient, HTTPRequestOptions } from './nvm-api.js'
import { AgentAccessCredentials } from '../common/types.js'

/**
 * The AIQueryApi class provides methods to query AI Agents on Nevermined.

 * @remarks
 * This API is oriented for AI users who already purchased access to an AI Agent and want to start querying them.
 */
export class AIQueryApi extends AbstractHTTPClient {
  /**
   * This method is used to create a singleton instance of the AIQueryApi class.
   *
   * @param options - The options to initialize the payments class.
   * @returns The instance of the AIQueryApi class.
   */
  static getInstance(): AIQueryApi {
    return new AIQueryApi()
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
   * await payments.query.send(accessCredentials, 'POST', 'http://example.com/agent/prompt', {'input': 'Hello'})
   * ```
   *
   * @param method - The HTTP method to use when querying the Agent @see {@link AxiosRequestConfig.method}
   * @param url - The URL of the endpoint to query the Agent/Service.
   * @param data - The data to send to the Agent/Service.
   * @param reqOptions - The request options to use when querying the Agent/Service.
   * @returns The result of query
   */
  async send(
    accessCredentials: AgentAccessCredentials,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url: string,
    data?: any,
    reqOptions: HTTPRequestOptions = {
      sendThroughProxy: false,
    },
  ) {
    reqOptions.accessToken = accessCredentials.accessToken
    if (accessCredentials.proxies && accessCredentials.proxies.length > 0) {
      reqOptions.proxyHost = accessCredentials.proxies[0]
      reqOptions.sendThroughProxy = true
    }
    return this.request(method, url, data, reqOptions)
  }
}
