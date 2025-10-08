import { StartAgentRequest } from '../../common/types.js'
import { EnvironmentName } from '../../environments.js'
import {
  CustomProperties,
  DefaultHeliconeHeaders,
  HeliconePayloadConfig,
  NeverminedHeliconeHeaders,
  HeliconeResponseConfig,
} from './types.js'

export function getDefaultHeliconeHeaders(
  heliconeApiKey: string,
  accountAddress: string,
  environmentName: EnvironmentName,
  agentRequest: StartAgentRequest,
  customProperties?: CustomProperties,
): DefaultHeliconeHeaders {
  const neverminedHeliconeHeaders: NeverminedHeliconeHeaders = {
    'Helicone-Auth': `Bearer ${heliconeApiKey}`,
    'Helicone-Property-accountaddress': accountAddress,
    'Helicone-Property-consumeraddress': agentRequest.balance.holderAddress,
    'Helicone-Property-agentid': agentRequest.agentId,
    'Helicone-Property-planid': agentRequest.balance.planId,
    'Helicone-Property-plantype': agentRequest.balance.planType,
    'Helicone-Property-planname': agentRequest.balance.planName,
    'Helicone-Property-agentname': agentRequest.agentName,
    'Helicone-Property-agentrequestid': agentRequest.agentRequestId,
    'Helicone-Property-pricepercredit': agentRequest.balance.pricePerCredit.toString(),
    'Helicone-Property-environmentname': environmentName,
    'Helicone-Property-batch': agentRequest.batch.toString(),
    'Helicone-Property-ismarginbased': 'false',
    'Helicone-Property-marginpercent': '0',
  }

  // Build custom property headers from all properties
  const customHeaders: CustomProperties = {}
  if (customProperties) {
    for (const [key, value] of Object.entries(customProperties)) {
      // Convert property names to Helicone-Property format
      customHeaders[`Helicone-Property-${key.toLowerCase()}`] = value
    }
  }

  return {
    ...neverminedHeliconeHeaders,
    ...customHeaders,
  }
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
