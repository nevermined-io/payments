/**
 * observability-api.ts
 * Provides reusable utilities for wrapping API calls with Helicone logging for AI agents
 */

import { HeliconeManualLogger } from '@helicone/helpers'
import { generateDeterministicAgentId, generateSessionId, logSessionInfo } from '../utils.js'
import { BasePaymentsAPI } from './base-payments.js'
import { PaymentOptions } from '../common/types.js'

// Helicone API URLs
export const HELICONE_BASE_LOGGING_URL = 'http://localhost:8585/v1/gateway/oai/v1' //'https://oai.helicone.ai/v1
export const HELICONE_MANUAL_LOGGING_URL = 'http://localhost:8585/v1/trace/custom/log' //https://api.worker.helicone.ai/custom/v1/log

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
 * @param customAgentId - Optional custom agent ID
 * @param customSessionId - Optional custom session ID
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
  customAgentId?: string,
  customSessionId?: string,
): Promise<TExtracted> {
  const agentId = customAgentId ?? generateDeterministicAgentId(customAgentId ?? '')
  const sessionId = customSessionId ?? generateSessionId()

  if (!customAgentId || !customSessionId) {
    logSessionInfo(agentId, sessionId, agentName)
  }

  const heliconeLogger = new HeliconeManualLogger({
    apiKey: heliconeApiKey,
    loggingEndpoint: HELICONE_MANUAL_LOGGING_URL,
    headers: {
      'Helicone-Property-AgentId': agentId,
      'Helicone-Property-SessionId': sessionId,
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
 * Usage: const llm = new ChatOpenAI(withHeliconeLangchain("gpt-4o-mini", apiKey, heliconeApiKey));
 *
 * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param customAgentId - Optional custom agent ID
 * @param customSessionId - Optional custom session ID
 * @returns Configuration object for ChatOpenAI constructor with Helicone enabled
 */
export function withHeliconeLangchain(
  model: string,
  apiKey: string,
  heliconeApiKey: string,
  customAgentId?: string,
  customSessionId?: string,
) {
  const agentId = customAgentId ?? generateDeterministicAgentId(customAgentId ?? '')
  const sessionId = customSessionId ?? generateSessionId()

  if (!customAgentId || !customSessionId) {
    logSessionInfo(agentId, sessionId, 'LangChainChatOpenAI')
  }

  return {
    model,
    apiKey,
    configuration: {
      baseURL: HELICONE_BASE_LOGGING_URL,
      defaultHeaders: {
        'Helicone-Auth': `Bearer ${heliconeApiKey}`,
        'Helicone-Property-AgentId': agentId,
        'Helicone-Property-SessionId': sessionId,
      },
    },
  }
}

/**
 * Creates an OpenAI client configuration with Helicone logging enabled
 *
 * Usage: const openai = new OpenAI(withHeliconeOpenAI(apiKey, heliconeApiKey, customProperties));
 *
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
 * @returns Configuration object for OpenAI constructor with Helicone enabled
 */
export function withHeliconeOpenAI(
  apiKey: string,
  heliconeApiKey: string,
  customProperties: Record<string, string | number>,
) {
  // Extract agentId and sessionId from properties, or generate defaults
  const agentId = customProperties.agentid ? String(customProperties.agentid) : generateDeterministicAgentId('')
  const sessionId = customProperties.sessionid ? String(customProperties.sessionid) : generateSessionId()

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

  return {
    apiKey,
    baseURL: HELICONE_BASE_LOGGING_URL,
    defaultHeaders: {
      'Helicone-Auth': `Bearer ${heliconeApiKey}`,
      ...customHeaders,
    },
  }
}

/**
 * The ObservabilityAPI class provides methods to wrap API calls with Helicone logging
 */
export class ObservabilityAPI extends BasePaymentsAPI {
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
   * @param customAgentId - Optional custom agent ID
   * @param customSessionId - Optional custom session ID
   * @returns Promise that resolves to the extracted user result
   */
  async withHeliconeLogging<TInternal = any, TExtracted = any>(
    agentName: string,
    payloadConfig: HeliconePayloadConfig,
    operation: () => Promise<TInternal>,
    resultExtractor: (internalResult: TInternal) => TExtracted,
    usageCalculator: (internalResult: TInternal) => HeliconeResponseConfig['usage'],
    responseIdPrefix: string,
    customAgentId?: string,
    customSessionId?: string,
  ): Promise<TExtracted> {
    return withHeliconeLogging(
      agentName,
      payloadConfig,
      operation,
      resultExtractor,
      usageCalculator,
      responseIdPrefix,
      this.heliconeApiKey!,
      customAgentId,
      customSessionId,
    )
  }

  /**
   * Creates a ChatOpenAI configuration with Helicone logging enabled
   *
   * Usage: const llm = new ChatOpenAI(observability.withHeliconeLangchain("gpt-4o-mini", apiKey, heliconeApiKey));
   *
   * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
   * @param apiKey - The OpenAI API key
   * @param heliconeApiKey - The Helicone API key for logging
   * @param customAgentId - Optional custom agent ID
   * @param customSessionId - Optional custom session ID
   * @returns Configuration object for ChatOpenAI constructor with Helicone enabled
   */
  withHeliconeLangchain(
    model: string,
    apiKey: string,
    customAgentId?: string,
    customSessionId?: string,
  ) {
    return withHeliconeLangchain(
      model,
      apiKey,
      this.heliconeApiKey!,
      customAgentId,
      customSessionId,
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
  withHeliconeOpenAI(
    apiKey: string,
    heliconeApiKey: string,
    customProperties: Record<string, string | number>,
  ): any {
    return withHeliconeOpenAI(apiKey, heliconeApiKey, customProperties)
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
