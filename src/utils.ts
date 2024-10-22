import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { Endpoint } from './payments'

export const isEthereumAddress = (address: string | undefined): boolean => {
  if (address && address.match(/^0x[a-fA-F0-9]{40}$/) !== null) return true
  return false
}

export const generateStepId = () => {
  return `step-${uuidv4()}`
}

export const isStepIdValid = (id: string) => {
  if (!id.startsWith('step-')) return false
  return uuidValidate(id.substring(5))
}

/**
 * It returns the list of endpoints that are used by agents/services implementing the Nevermined Query Protocol
 * @param serverHost - The host of the server where the agents/services are running
 * @returns the list of endpoints
 */
export const getQueryProtocolEndpoints = (serverHost: string): Endpoint[] => {
  const url = new URL(serverHost)
  return [
    { POST: `${url.origin}/api/v1/agents/(.*)/tasks` },
    { GET: `${url.origin}/api/v1/agents/(.*)/tasks/(.*)` },
  ]
}

export const getAIHubOpenApiUrl = (serverHost: string): string => {
  const url = new URL(serverHost)
  return `${url.origin}/api/v1/rest/docs-json`
}
