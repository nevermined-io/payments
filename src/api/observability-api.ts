/**
 * observability-api.ts
 * Provides reusable utilities for wrapping API calls with Helicone logging for AI agents
 */

import { HeliconeManualLogger } from '@helicone/helpers'
import axios from 'axios'
import { generateDeterministicAgentId, generateSessionId, logSessionInfo } from '../utils.js'
import { BasePaymentsAPI } from './base-payments.js'
import { PaymentOptions } from '../common/types.js'

/**
 * Configuration for creating a Helicone payload
 */
export interface HeliconePayloadConfig {
  model: string
  inputData: Record<string, any>
  temperature?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  n?: number
  stream?: boolean
}

/**
 * Configuration for creating a Helicone response
 */
export interface HeliconeResponseConfig {
  idPrefix: string
  model: string
  resultData: any
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
      audio_tokens: number
    }
    completion_tokens_details?: {
      reasoning_tokens: number
      audio_tokens: number
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
  systemFingerprint?: string
}

export type CustomProperties = {
  agentid: string
  sessionid: string
} & Record<string, string | number>

export type DefaultHeliconeHeaders = {
  'Helicone-Auth': string
  'Helicone-Request-Id': string
  'Helicone-Property-accountAddress': string
} & Record<string, string>

export type ChatOpenAIConfiguration = {
  model: string
  apiKey: string
  configuration: {
    baseURL: string
    defaultHeaders: DefaultHeliconeHeaders,
  }
}

export type OpenAIConfiguration = {
  apiKey: string
  baseURL: string
  defaultHeaders: DefaultHeliconeHeaders
}

/**
 * Creates a standardized Helicone payload for API logging
 */
export function createHeliconePayload(config: HeliconePayloadConfig) {
  return {
    model: config.model,
    temperature: config.temperature ?? 1,
    top_p: config.top_p ?? 1,
    frequency_penalty: config.frequency_penalty ?? 0,
    presence_penalty: config.presence_penalty ?? 0,
    n: config.n ?? 1,
    stream: config.stream ?? false,
    messages: [
      {
        role: 'user',
        content: JSON.stringify(config.inputData),
      },
    ],
  }
}

/**
 * Creates a standardized Helicone response for API logging
 */
export function createHeliconeResponse(config: HeliconeResponseConfig) {
  const timestamp = Date.now()

  return {
    id: `${config.idPrefix}-${timestamp}`,
    object: 'chat.completion',
    created: Math.floor(timestamp / 1000),
    model: config.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(config.resultData),
          refusal: null,
          annotations: [],
        },
        logprobs: null,
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: config.usage.prompt_tokens,
      completion_tokens: config.usage.completion_tokens,
      total_tokens: config.usage.total_tokens,
      prompt_tokens_details: config.usage.prompt_tokens_details ?? {
        cached_tokens: 0,
        audio_tokens: 0,
      },
      completion_tokens_details: config.usage.completion_tokens_details ?? {
        reasoning_tokens: 0,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0,
      },
    },
    service_tier: 'default',
    system_fingerprint: config.systemFingerprint ?? `fp_${timestamp}`,
  }
}

/**
 * Wraps an async operation with Helicone logging
 *
 * @param agentName - Name of the agent for logging purposes
 * @param payloadConfig - Configuration for the Helicone payload
 * @param operation - The async operation to execute (returns internal result with extra data)
 * @param resultExtractor - Function to extract the user-facing result from internal result
 * @param usageCalculator - Function to calculate usage metrics from the internal result
 * @param responseIdPrefix - Prefix for the response ID
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeManualLoggingUrl - The Helicone manual logging endpoint URL
 * @param accountAddress - The account address for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
 * @returns Promise that resolves to the extracted user result
 */
export async function withHeliconeLogging<TInternal = any, TExtracted = any>(
  agentName: string,
  payloadConfig: HeliconePayloadConfig,
  operation: () => Promise<TInternal>,
  resultExtractor: (internalResult: TInternal) => TExtracted,
  usageCalculator: (internalResult: TInternal) => HeliconeResponseConfig['usage'],
  responseIdPrefix: string,
  heliconeApiKey: string,
  heliconeManualLoggingUrl: string,
  accountAddress: string,
  requestId: string | undefined,
  customProperties: CustomProperties,
): Promise<TExtracted> {
  // Extract agentId and sessionId from properties, or generate defaults
  const agentId = customProperties.agentid
    ? String(customProperties.agentid)
    : generateDeterministicAgentId('')
  const sessionId = customProperties.sessionid
    ? String(customProperties.sessionid)
    : generateSessionId()

  // Log session info if these weren't provided in custom properties
  if (!customProperties.agentid || !customProperties.sessionid) {
    logSessionInfo(agentId, sessionId, agentName)
  }

  // Build custom property headers from all properties
  const customHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(customProperties)) {
    // Convert property names to Helicone-Property format and ensure string values
    customHeaders[`Helicone-Property-${key}`] = String(value)
  }

  const fallbackRequestId = crypto.randomUUID()
  requestId = requestId || fallbackRequestId

  const heliconeLogger = new HeliconeManualLogger({
    apiKey: heliconeApiKey,
    loggingEndpoint: heliconeManualLoggingUrl,
    headers: {
      ...customHeaders,
      'Helicone-Property-accountAddress': accountAddress,
      'Helicone-Request-Id': requestId,
    },
  })

  const heliconePayload = createHeliconePayload(payloadConfig)

  return await heliconeLogger.logRequest(heliconePayload, async (resultRecorder: any) => {
    const internalResult = await operation()

    const usage = usageCalculator(internalResult)

    const extractedResult = resultExtractor(internalResult)

    const heliconeResponse = createHeliconeResponse({
      idPrefix: responseIdPrefix,
      model: payloadConfig.model,
      resultData: extractedResult,
      usage,
      systemFingerprint: (extractedResult as any)?.jobId
        ? `fp_${(extractedResult as any).jobId}`
        : undefined,
    })

    resultRecorder.appendResults(heliconeResponse)

    return extractedResult
  })
}

/**
 * Helper function to calculate usage for image operations based on pixels
 */
export function calculateImageUsage(pixels: number): HeliconeResponseConfig['usage'] {
  return {
    prompt_tokens: 0,
    completion_tokens: pixels,
    total_tokens: pixels,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  }
}

/**
 * Helper function to calculate usage for video operations (typically 1 token)
 */
export function calculateVideoUsage(): HeliconeResponseConfig['usage'] {
  return {
    prompt_tokens: 0,
    completion_tokens: 1,
    total_tokens: 1,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  }
}

/**
 * Helper function to calculate usage for song operations based on tokens/quota
 */
export function calculateSongUsage(tokens: number): HeliconeResponseConfig['usage'] {
  return {
    prompt_tokens: 0,
    completion_tokens: tokens,
    total_tokens: tokens,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  }
}

/**
 * Helper function to calculate usage for dummy song operations
 */
export function calculateDummySongUsage(): HeliconeResponseConfig['usage'] {
  return calculateSongUsage(6) // Default dummy token count
}

/**
 * Creates a ChatOpenAI configuration with Helicone logging enabled
 *
 * Usage: const llm = new ChatOpenAI(withHeliconeLangchain("gpt-4o-mini", apiKey, heliconeApiKey, heliconeBaseLoggingUrl, accountAddress, customProperties));
 *
 * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeBaseLoggingUrl - The Helicone base logging endpoint URL
 * @param accountAddress - The account address for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
 * @returns Configuration object for ChatOpenAI constructor with Helicone enabled
 */
export function withHeliconeLangchain(
  model: string,
  apiKey: string,
  heliconeApiKey: string,
  heliconeBaseLoggingUrl: string,
  accountAddress: string,
  requestId: string | undefined,
  customProperties: CustomProperties,
): ChatOpenAIConfiguration {
  // Extract agentId and sessionId from properties, or generate defaults
  const agentId = customProperties.agentid
    ? String(customProperties.agentid)
    : generateDeterministicAgentId('')
  const sessionId = customProperties.sessionid
    ? String(customProperties.sessionid)
    : generateSessionId()

  // Log session info if these weren't provided in custom properties
  if (!customProperties.agentid || !customProperties.sessionid) {
    logSessionInfo(agentId, sessionId, 'LangChainChatOpenAI')
  }

  // Build custom property headers from all properties
  const customHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(customProperties)) {
    // Convert property names to Helicone-Property format and ensure string values
    customHeaders[`Helicone-Property-${key}`] = String(value)
  }

  const fallbackRequestId = crypto.randomUUID()
  requestId = requestId || fallbackRequestId

  return {
    model,
    apiKey,
    configuration: {
      baseURL: heliconeBaseLoggingUrl,
      defaultHeaders: {
        'Helicone-Auth': `Bearer ${heliconeApiKey}`,
        'Helicone-Property-accountAddress': accountAddress,
        'Helicone-Request-Id': requestId,
        ...customHeaders,
      },
    },
  }
}

/**
 * Applies margin-based pricing to a specific request ID with polling/retry logic
 * The margin percentage is retrieved from the database record associated with the request ID
 *
 * @param requestId - The Helicone request ID to update
 * @param backendUrl - Optional backend URL override
 * @param maxRetries - Maximum number of retry attempts (default: 6)
 * @param retryDelayMs - Initial delay between retries in milliseconds (default: 5000)
 * @param initialDelayMs - Initial delay before first attempt in milliseconds (default: 1000)
 * @returns Promise that resolves to updated cost data or null if not found
 */
export async function applyMarginPricing(
  requestId: string,
  backendUrl?: string,
  maxRetries = 6,
  retryDelayMs = 5000,
  initialDelayMs = 1000
): Promise<any | null> {
  const url = `${backendUrl || 'http://localhost:3001'}/api/cost/${encodeURIComponent(requestId)}/apply-margin`
  
  // Initial delay before first attempt
  if (initialDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, initialDelayMs))
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url)
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Unknown error from pricing backend')
      }
      
      // Successfully applied margin pricing
      return response.data.data
      
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Data not found yet, might need more time for Helicone to process
        if (attempt < maxRetries) {
          console.log(`Cost data not found for margin pricing ${requestId} (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs}ms...`)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs))
          // Increase delay for next attempt (exponential backoff)
          retryDelayMs = Math.min(retryDelayMs * 1.5, 15000) // Cap at 15 seconds
          continue
        } else {
          console.warn(`Request not found for margin pricing after ${maxRetries} attempts: ${requestId}`)
          return null
        }
      } else {
        // Other errors (network, server error, etc.) - don't retry
        console.error('Error applying margin pricing:', error.message || error)
        return null
      }
    }
  }
  
  return null
}

/**
 * Fetches cost data for a specific request ID from the pricing analysis backend with polling/retry logic
 *
 * @param requestId - The Helicone request ID to get cost data for
 * @param maxRetries - Maximum number of retry attempts (default: 6)
 * @param retryDelayMs - Initial delay between retries in milliseconds (default: 5000)
 * @param initialDelayMs - Initial delay before first attempt in milliseconds (default: 1000)
 * @returns Promise that resolves to cost data or null if not found after all retries
 */
export async function getCostByRequestId(
  requestId: string,
  maxRetries = 6,
  retryDelayMs = 5000,
  initialDelayMs = 1000,
): Promise<any | null> {
  const backendUrl = process.env.PRICING_ANALYSIS_BACKEND_URL || 'http://localhost:3001'
  const url = `${backendUrl || 'http://localhost:3001'}/api/cost/${encodeURIComponent(requestId)}`
  
  // Initial delay before first attempt
  if (initialDelayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, initialDelayMs))
  }
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.get(url)
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Unknown error from pricing backend')
      }
      // Successfully found cost data
      return response.data.data
      
    } catch (error: any) {
      if (error.response?.status === 404) {
        // Data not found yet, might need more time for Helicone to process
        if (attempt < maxRetries) {
          console.log(`Cost data not found for request ID ${requestId} (attempt ${attempt}/${maxRetries}). Retrying in ${retryDelayMs}ms...`)
          await new Promise(resolve => setTimeout(resolve, retryDelayMs))
          // Increase delay for next attempt (exponential backoff)
          retryDelayMs = Math.min(retryDelayMs * 1.5, 15000) // Cap at 15 seconds
          continue
        } else {
          console.warn(`Cost data not found for request ID ${requestId} after ${maxRetries} attempts`)
          return null
        }
      } else {
        // Other errors (network, server error, etc.) - don't retry
        console.error('Error fetching cost data:', error.message || error)
        return null
      }
    }
  }
  
  return null
}

/**
 * Creates an OpenAI client configuration with Helicone logging enabled
 *
 * Usage: const openai = new OpenAI(withHeliconeOpenAI(apiKey, heliconeApiKey, heliconeBaseLoggingUrl, accountAddress, customProperties));
 *
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeBaseLoggingUrl - The Helicone base logging endpoint URL
 * @param accountAddress - The account address for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
 * @returns Configuration object for OpenAI constructor with Helicone enabled
 */
export function withHeliconeOpenAI(
  apiKey: string,
  heliconeApiKey: string,
  heliconeBaseLoggingUrl: string,
  accountAddress: string,
  requestId: string | undefined,
  customProperties: CustomProperties,
): OpenAIConfiguration {
  // Extract agentId and sessionId from properties, or generate defaults
  const agentId = customProperties.agentid
    ? String(customProperties.agentid)
    : generateDeterministicAgentId('')
  const sessionId = customProperties.sessionid
    ? String(customProperties.sessionid)
    : generateSessionId()

  // Log session info if these weren't provided in custom properties
  if (!customProperties.agentid || !customProperties.sessionid) {
    logSessionInfo(agentId, sessionId, 'OpenAI')
  }

  // Build custom property headers from all properties
  const customHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(customProperties)) {
    // Convert property names to Helicone-Property format and ensure string values
    customHeaders[`Helicone-Property-${key}`] = String(value)
  }

  const fallbackRequestId = crypto.randomUUID()
  requestId = requestId || fallbackRequestId

  return {
    apiKey,
    baseURL: heliconeBaseLoggingUrl,
    defaultHeaders: {
      'Helicone-Auth': `Bearer ${heliconeApiKey}`,
      'Helicone-Property-accountAddress': accountAddress,
      'Helicone-Request-Id': requestId,
      ...customHeaders,
    },
  }
}

/**
 * The ObservabilityAPI class provides methods to wrap API calls with Helicone logging
 */
export class ObservabilityAPI extends BasePaymentsAPI {
  protected readonly heliconeBaseLoggingUrl: string
  protected readonly heliconeManualLoggingUrl: string

  constructor(options: PaymentOptions) {
    super(options)

    // TODO: For testing purposes only. Remove once helicone is deployed to staging
    // Get Helicone API key from environment variable and override the base class property
    this.heliconeApiKey = process.env.HELICONE_API_KEY ?? this.heliconeApiKey

    this.heliconeBaseLoggingUrl = new URL(
      '/v1/gateway/oai/v1',
      this.environment.heliconeUrl,
    ).toString()
    this.heliconeManualLoggingUrl = new URL(
      '/v1/trace/custom/v1/log',
      this.environment.heliconeUrl,
    ).toString()
  }
  /**
   * This method is used to create a singleton instance of the ObservabilityAPI class.
   *
   * @param options - The options to initialize the payments class.
   * @returns The instance of the ObservabilityAPI class.
   */
  static getInstance(options: PaymentOptions): ObservabilityAPI {
    return new ObservabilityAPI(options)
  }

  /**
   * Wraps an async operation with Helicone logging
   *
   * @param agentName - Name of the agent for logging purposes
   * @param payloadConfig - Configuration for the Helicone payload
   * @param operation - The async operation to execute (returns internal result with extra data)
   * @param resultExtractor - Function to extract the user-facing result from internal result
   * @param usageCalculator - Function to calculate usage metrics from the internal result
   * @param responseIdPrefix - Prefix for the response ID
   * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
   * @returns Promise that resolves to the extracted user result
   */
  async withHeliconeLogging<TInternal = any, TExtracted = any>(
    agentName: string,
    payloadConfig: HeliconePayloadConfig,
    operation: () => Promise<TInternal>,
    resultExtractor: (internalResult: TInternal) => TExtracted,
    usageCalculator: (internalResult: TInternal) => HeliconeResponseConfig['usage'],
    responseIdPrefix: string,
    requestId: string | undefined,
    customProperties: CustomProperties,
  ): Promise<TExtracted> {
    return withHeliconeLogging(
      agentName,
      payloadConfig,
      operation,
      resultExtractor,
      usageCalculator,
      responseIdPrefix,
      this.heliconeApiKey!,
      this.heliconeManualLoggingUrl,
      this.accountAddress!,
      requestId,
      customProperties,
    )
  }

  /**
   * Creates a ChatOpenAI configuration with Helicone logging enabled
   *
   * Usage: const llm = new ChatOpenAI(observability.withHeliconeLangchain("gpt-4o-mini", apiKey, customProperties));
   *
   * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
   * @param apiKey - The OpenAI API key
   * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
   * @returns Configuration object for ChatOpenAI constructor with Helicone enabled
   */
  withHeliconeLangchain(
    model: string,
    apiKey: string,
    requestId: string | undefined,
    customProperties: CustomProperties,
  ): ChatOpenAIConfiguration {
    return withHeliconeLangchain(
      model,
      apiKey,
      this.heliconeApiKey!,
      this.heliconeBaseLoggingUrl,
      this.accountAddress!,
      requestId,
      customProperties,
    )
  }

  /**
   * Creates an OpenAI client configuration with Helicone logging enabled
   *
   * Usage: const openai = new OpenAI(observability.withHeliconeOpenAI(apiKey, heliconeApiKey, customProperties));
   *
   * @param apiKey - The OpenAI API key
   * @param heliconeApiKey - The Helicone API key for logging
   * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
   * @returns Configuration object for OpenAI constructor with Helicone enabled
   */
  withHeliconeOpenAI(apiKey: string, requestId: string | undefined, customProperties: CustomProperties): OpenAIConfiguration {
    return withHeliconeOpenAI(
      apiKey,
      this.heliconeApiKey!,
      this.heliconeBaseLoggingUrl,
      this.accountAddress!,
      requestId,
      customProperties,
    )
  }

  /**
   * Applies margin-based pricing to a specific request ID with polling/retry logic
   * The margin percentage is retrieved from the database record associated with the request ID
   *
   * @param requestId - The Helicone request ID to update
   * @param maxRetries - Maximum number of retry attempts (default: 6)
   * @param retryDelayMs - Initial delay between retries in milliseconds (default: 5000)
   * @param initialDelayMs - Initial delay before first attempt in milliseconds (default: 1000)
   * @returns Promise that resolves to updated cost data or null if not found
   */
  async applyMarginPricing(
    requestId: string,
    maxRetries = 6,
    retryDelayMs = 5000,
    initialDelayMs = 1000
  ): Promise<any | null> {
    const backendUrl = process.env.PRICING_ANALYSIS_BACKEND_URL || 'http://localhost:3001'
    return applyMarginPricing(requestId, backendUrl, maxRetries, retryDelayMs, initialDelayMs)
  }

  /**
   * Fetches cost data for a specific request ID from the pricing analysis backend
   * 
   * @param requestId - The Helicone request ID to get cost data for
   * @param maxRetries - Maximum number of retry attempts (default: 6)
   * @param retryDelayMs - Initial delay between retries in milliseconds (default: 5000)
   * @param initialDelayMs - Initial delay before first attempt in milliseconds (default: 1000)
   * @returns Promise that resolves to cost data or null if not found after all retries
   */
  async getCostByRequestId(
    requestId: string,
    maxRetries = 6,
    retryDelayMs = 5000,
    initialDelayMs = 1000
  ): Promise<any | null> {
    return getCostByRequestId(requestId, maxRetries, retryDelayMs, initialDelayMs)
  }

  /**
   * Helper function to calculate usage for image operations based on pixels
   */
  calculateImageUsage(pixels: number): HeliconeResponseConfig['usage'] {
    return calculateImageUsage(pixels)
  }

  /**
   * Helper function to calculate usage for video operations (typically 1 token)
   */
  calculateVideoUsage(): HeliconeResponseConfig['usage'] {
    return calculateVideoUsage()
  }

  /**
   * Helper function to calculate usage for song operations based on tokens/quota
   */
  calculateSongUsage(tokens: number): HeliconeResponseConfig['usage'] {
    return calculateSongUsage(tokens)
  }

  /**
   * Helper function to calculate usage for dummy song operations
   */
  calculateDummySongUsage(): HeliconeResponseConfig['usage'] {
    return calculateDummySongUsage()
  }

  /**
   * Creates a standardized Helicone payload for API logging
   */
  createHeliconePayload(config: HeliconePayloadConfig) {
    return createHeliconePayload(config)
  }

  /**
   * Creates a standardized Helicone response for API logging
   */
  createHeliconeResponse(config: HeliconeResponseConfig) {
    return createHeliconeResponse(config)
  }
}
