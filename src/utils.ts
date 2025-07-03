import { v4 as uuidv4, validate as uuidValidate } from 'uuid'
import { Endpoint } from './common/types'

/**
 * Validates if a string is a valid Ethereum address
 * @param address - the address to check
 * @returns true if it's a valid Ethereum address
 */
export const isEthereumAddress = (address: string | undefined): boolean => {
  if (address && address.match(/^0x[a-fA-F0-9]{40}$/) !== null) return true
  return false
}

export const getRandomBigInt = (bits = 128): bigint => {
  const bytes = Math.ceil(bits / 8)
  const array = new Uint8Array(bytes)
  crypto.getRandomValues(array)

  let result = 0n
  for (const byte of array) {
    result = (result << 8n) | BigInt(byte)
  }

  return result
}

/**
 * It generates a random step id
 * @returns the step id
 */
export const generateStepId = (): string => {
  return `step-${uuidv4()}`
}

/**
 * It checks the step id has the right format
 * @param stepId - the step id to validate
 * @returns true if it's a valid step id
 */
export const isStepIdValid = (stepId: string): boolean => {
  if (!stepId.startsWith('step-')) return false
  return uuidValidate(stepId.substring(5))
}

/**
 * Decodes a JWT token and returns the full payload for debugging purposes.
 * @param accessToken - The JWT access token
 * @returns The decoded payload object or null if invalid
 */
export const decodeAccessToken = (accessToken: string): any | null => {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payload = parts[1]
    const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const decodedPayload = atob(paddedPayload.replace(/-/g, '+').replace(/_/g, '/'))

    const tokenData = JSON.parse(decodedPayload)

    // Check if this is a nested token structure with authToken field
    if (tokenData.authToken) {
      // Return both the outer token data and the decoded inner authToken
      return {
        ...tokenData,
        authToken: decodeAccessToken(tokenData.authToken),
      }
    }

    return tokenData
  } catch (error) {
    return null
  }
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

/**
 * Giving a server host it returns the URL to the OpenAPI documentation of the AI Hub
 * @param serverHost  - the server host (i.e http://localhost:5000)
 * @returns
 */
export const getAIHubOpenApiUrl = (serverHost: string): string => {
  const url = new URL(serverHost)
  return `${url.origin}/api/v1/rest/docs-json`
}
