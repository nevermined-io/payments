/**
 * observability-api.ts
 * Provides reusable utilities for wrapping API calls with Helicone logging for AI agents
 */

import { HeliconeManualLogger } from '@helicone/helpers'
import { generateDeterministicAgentId, generateSessionId, logSessionInfo } from '../../utils.js'
import { BasePaymentsAPI } from '../base-payments.js'
import { PaymentOptions, StartAgentRequest } from '../../common/types.js'
import { EnvironmentName } from '../../environments.js'
import * as traceloop from '@traceloop/node-server-sdk'
import { Span as ApiSpan, Context, trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import {
  AsyncLoggerProviders,
  CustomProperties,
  HeliconePayloadConfig,
  HeliconeResponseConfig,
  ChatOpenAIConfiguration,
  OpenAIConfiguration,
} from './types.js'
import {
  getDefaultHeliconeHeaders,
  createHeliconePayload,
  createHeliconeResponse,
} from './utils.js'

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
 * @param environmentName - The environment name for logging purposes
 * @param startAgentRequest - The agent request for logging purposes
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
  environmentName: EnvironmentName,
  startAgentRequest: StartAgentRequest,
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

  const defaultHeaders = getDefaultHeliconeHeaders(
    heliconeApiKey,
    accountAddress,
    environmentName,
    startAgentRequest,
    customProperties,
  )

  const heliconeLogger = new HeliconeManualLogger({
    apiKey: heliconeApiKey,
    loggingEndpoint: heliconeManualLoggingUrl,
    headers: defaultHeaders,
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
 * Creates a ChatOpenAI configuration with logging enabled
 *
 * Usage: const llm = new ChatOpenAI(withLangchain("gpt-4o-mini", apiKey, heliconeApiKey, heliconeBaseLoggingUrl, accountAddress, agentRequest, customProperties));
 *
 * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeBaseLoggingUrl - The Helicone base logging endpoint URL
 * @param accountAddress - The account address for logging purposes
 * @param environmentName - The environment name for logging purposes
 * @param agentRequest - The agent request for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers
 * @returns Configuration object for ChatOpenAI constructor with logging enabled
 */
export function withLangchain(
  model: string,
  apiKey: string,
  heliconeApiKey: string,
  heliconeBaseLoggingUrl: string,
  accountAddress: string,
  environmentName: EnvironmentName,
  agentRequest: StartAgentRequest,
  customProperties: CustomProperties,
): ChatOpenAIConfiguration {
  const defaultHeaders = getDefaultHeliconeHeaders(
    heliconeApiKey,
    accountAddress,
    environmentName,
    agentRequest,
    customProperties,
  )

  return {
    model,
    apiKey,
    configuration: {
      baseURL: heliconeBaseLoggingUrl,
      defaultHeaders,
    },
  }
}

/**
 * Creates an OpenAI client configuration with logging enabled
 *
 * Usage: const openai = new OpenAI(withOpenAI(apiKey, heliconeApiKey, heliconeBaseLoggingUrl, accountAddress, agentRequest, customProperties));
 *
 * @param apiKey - The OpenAI API key
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeBaseLoggingUrl - The Helicone base logging endpoint URL
 * @param accountAddress - The account address for logging purposes
 * @param environmentName - The environment name for logging purposes
 * @param agentRequest - The agent request for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers
 * @returns Configuration object for OpenAI constructor with logging enabled
 */
export function withOpenAI(
  apiKey: string,
  heliconeApiKey: string,
  heliconeBaseLoggingUrl: string,
  accountAddress: string,
  environmentName: EnvironmentName,
  agentRequest: StartAgentRequest,
  customProperties: CustomProperties,
): OpenAIConfiguration {
  const defaultHeaders = getDefaultHeliconeHeaders(
    heliconeApiKey,
    accountAddress,
    environmentName,
    agentRequest,
    customProperties,
  )

  return {
    apiKey,
    baseURL: heliconeBaseLoggingUrl,
    defaultHeaders: {
      ...defaultHeaders,
    },
  }
}

/**
 * Creates an async logger with Helicone logging enabled using automatic property injection
 *
 * This implementation wraps the OpenTelemetry SpanProcessor to automatically add Helicone
 * properties to ALL spans. This mimics Python's Traceloop.set_association_properties() -
 * no wrapping of individual LLM calls needed!
 *
 * @example
 * ```typescript
 * import OpenAI from 'openai';
 * const logger = withAsyncLogger({ openAI: OpenAI }, heliconeApiKey, url, account, env, request, props);
 * logger.init();
 *
 * // Make LLM calls normally - properties are automatically added to all spans!
 * const openai = new OpenAI({ apiKey });
 * const result = await openai.chat.completions.create({ ... });
 * ```
 *
 * @param providers - AI SDK modules to instrument (OpenAI, Anthropic, etc.)
 * @param heliconeApiKey - The Helicone API key for logging
 * @param heliconeAsyncLoggingUrl - The Helicone async logging URL
 * @param accountAddress - The account address for logging purposes
 * @param environmentName - The environment name for logging purposes
 * @param agentRequest - The agent request for logging purposes
 * @param customProperties - Custom properties to add as Helicone headers
 * @returns The async logger instance with init() method
 */
function withAsyncLogger(
  providers: AsyncLoggerProviders,
  heliconeApiKey: string,
  heliconeAsyncLoggingUrl: string,
  accountAddress: string,
  environmentName: EnvironmentName,
  agentRequest: StartAgentRequest,
  customProperties?: CustomProperties,
): { init: () => void } {
  const defaultHeaders = getDefaultHeliconeHeaders(
    heliconeApiKey,
    accountAddress,
    environmentName,
    agentRequest,
    customProperties,
  )

  return {
    init: () => {
      console.log(
        '[Helicone] Initializing async logger with',
        Object.keys(defaultHeaders).filter((k) => k.startsWith('Helicone-Property-')).length,
        'properties',
      )

      // Create custom OTLP exporter with exact URL (jawn uses /v1/trace/log not /v1/traces)
      const customExporter = new OTLPTraceExporter({
        url: heliconeAsyncLoggingUrl,
        headers: {
          Authorization: `Bearer ${heliconeApiKey}`,
        },
      })

      // Initialize traceloop SDK with custom exporter and provider instrumentation
      traceloop.initialize({
        apiKey: heliconeApiKey,
        baseUrl: heliconeAsyncLoggingUrl,
        disableBatch: true,
        exporter: customExporter,
        instrumentModules: {
          openAI: providers.openAI as any,
          anthropic: providers.anthropic as any,
          cohere: providers.cohere as any,
          bedrock: providers.bedrock as any,
          google_aiplatform: providers.google_aiplatform as any,
          together: providers.together as any,
          langchain: providers.langchain as any,
        },
      })

      console.log(
        '[Helicone] Traceloop initialized with providers:',
        Object.keys(providers).join(', '),
      )

      // Wrap the span processor to automatically inject properties into all spans
      try {
        // Access the real TracerProvider (hidden behind a proxy)
        const proxyProvider = trace.getTracerProvider() as any
        const realProvider = proxyProvider?._delegate || proxyProvider
        const activeProcessor = realProvider?._activeSpanProcessor

        if (activeProcessor && typeof activeProcessor.onStart === 'function') {
          console.log('[Helicone] Wrapping SpanProcessor to auto-inject properties')

          // Store the original onStart method
          const originalOnStart = activeProcessor.onStart.bind(activeProcessor)

          // Wrap it to inject our Helicone properties
          activeProcessor.onStart = (span: ApiSpan, parentContext: Context) => {
            // Call the original onStart first
            originalOnStart(span, parentContext)

            // Add only Helicone-Property-* headers as span attributes
            for (const [key, value] of Object.entries(defaultHeaders)) {
              if (key.startsWith('Helicone-Property-')) {
                const attributeKey = `traceloop.association.properties.${key}`
                span.setAttribute(attributeKey, value)
              }
            }
          }

          console.log('[Helicone] ✓ Properties will be auto-injected into all spans')
        }
      } catch (error) {
        console.error('[Helicone] Failed to wrap SpanProcessor:', error)
        console.warn(
          '[Helicone] Properties will not be automatically added. Use logger.withProperties() to add them.',
        )
      }
    },
  }
}

/**
 * The ObservabilityAPI class provides methods to wrap API calls with Helicone logging
 */
export class ObservabilityAPI extends BasePaymentsAPI {
  protected readonly heliconeBaseLoggingUrl: string
  protected readonly heliconeManualLoggingUrl: string
  protected readonly heliconeAsyncLoggingUrl: string

  constructor(options: PaymentOptions) {
    super(options)

    // TODO: For testing purposes only. Remove once helicone is deployed to staging
    // Get Helicone API key from environment variable and override the base class property
    this.heliconeApiKey = process.env.HELICONE_API_KEY ?? this.heliconeApiKey

    this.heliconeBaseLoggingUrl = new URL(
      'jawn/v1/gateway/oai/v1',
      this.environment.heliconeUrl,
    ).toString()
    this.heliconeManualLoggingUrl = new URL(
      'jawn/v1/trace/custom/v1/log',
      this.environment.heliconeUrl,
    ).toString()
    // For async logging, the full OTLP endpoint URL (jawn uses /v1/trace/log not /v1/traces)
    this.heliconeAsyncLoggingUrl = new URL(
      'jawn/v1/trace/log',
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
   * @param startAgentRequest - The agent request for logging purposes
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
    startAgentRequest: StartAgentRequest,
    customProperties: CustomProperties,
  ): Promise<TExtracted> {
    return withHeliconeLogging(
      agentName,
      payloadConfig,
      operation,
      resultExtractor,
      usageCalculator,
      responseIdPrefix,
      this.heliconeApiKey,
      this.heliconeManualLoggingUrl,
      this.accountAddress,
      this.environmentName,
      startAgentRequest,
      customProperties,
    )
  }

  /**
   * Creates a ChatOpenAI configuration with logging enabled
   *
   * Usage: const llm = new ChatOpenAI(observability.withLangchain("gpt-4o-mini", apiKey, agentRequest, customProperties));
   *
   * @param model - The OpenAI model to use (e.g., "gpt-4o-mini", "gpt-4")
   * @param apiKey - The OpenAI API key
   * @param agentRequest - The agent request for logging purposes
   * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
   * @returns Configuration object for ChatOpenAI constructor with logging enabled
   */
  withLangchain(
    model: string,
    apiKey: string,
    startAgentRequest: StartAgentRequest,
    customProperties: CustomProperties,
  ): ChatOpenAIConfiguration {
    return withLangchain(
      model,
      apiKey,
      this.heliconeApiKey,
      this.heliconeBaseLoggingUrl,
      this.accountAddress,
      this.environmentName,
      startAgentRequest,
      customProperties,
    )
  }

  /**
   * Creates an OpenAI client configuration with logging enabled
   *
   * Usage: const openai = new OpenAI(observability.withOpenAI(apiKey, heliconeApiKey, agentRequest, customProperties));
   *
   * @param apiKey - The OpenAI API key
   * @param agentRequest - The agent request for logging purposes
   * @param customProperties - Custom properties to add as Helicone headers (should include agentid and sessionid)
   * @returns Configuration object for OpenAI constructor with logging enabled
   */
  withOpenAI(
    apiKey: string,
    agentRequest: StartAgentRequest,
    customProperties: CustomProperties,
  ): OpenAIConfiguration {
    return withOpenAI(
      apiKey,
      this.heliconeApiKey,
      this.heliconeBaseLoggingUrl,
      this.accountAddress,
      this.environmentName,
      agentRequest,
      customProperties,
    )
  }

  /**
   * Creates an async logger with Nevermined logging enabled and automatic property injection
   *
   * This method wraps the OpenTelemetry SpanProcessor to automatically add all Helicone
   * properties to every span. This mimics Python's Traceloop.set_association_properties() -
   * no wrapping of individual LLM calls needed!
   *
   * @example
   * ```typescript
   * import OpenAI from 'openai';
   *
   * const logger = observability.withAsyncLogger(\{ openAI: OpenAI \}, agentRequest);
   * logger.init();
   *
   * // Make LLM calls normally - properties are automatically added to all spans!
   * const openai = new OpenAI(\{ apiKey \});
   * const result = await openai.chat.completions.create(\{ ... \});
   * ```
   *
   * @param providers - AI SDK modules to instrument (OpenAI, Anthropic, etc.)
   * @param agentRequest - The agent request for logging purposes
   * @param customProperties - Custom properties to add as Helicone headers
   * @returns The async logger instance with init() method
   */
  withAsyncLogger(
    providers: AsyncLoggerProviders,
    agentRequest: StartAgentRequest,
    customProperties?: CustomProperties,
  ): { init: () => void } {
    return withAsyncLogger(
      providers,
      this.heliconeApiKey,
      this.heliconeAsyncLoggingUrl,
      this.accountAddress,
      this.environmentName,
      agentRequest,
      customProperties,
    )
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
