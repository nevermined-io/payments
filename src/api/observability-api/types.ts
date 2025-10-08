import type OpenAI from 'openai'
import type Together from 'together-ai'
import type * as ChainsModule from 'langchain/chains'
import type * as AgentsModule from 'langchain/agents'
import type * as ToolsModule from 'langchain/tools'
import type * as anthropic from '@anthropic-ai/sdk'
import type * as cohere from 'cohere-ai'
import type * as bedrock from '@aws-sdk/client-bedrock-runtime'
import type * as google_aiplatform from '@google-cloud/aiplatform'

export type AsyncLoggerProviders = {
  openAI?: typeof OpenAI
  anthropic?: typeof anthropic
  cohere?: typeof cohere
  bedrock?: typeof bedrock
  google_aiplatform?: typeof google_aiplatform
  together?: typeof Together
  langchain?: {
    chainsModule?: typeof ChainsModule
    agentsModule?: typeof AgentsModule
    toolsModule?: typeof ToolsModule
  }
}

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

export type CustomProperties = Record<string, string>

export type NeverminedHeliconeHeaders = {
  'Helicone-Auth': string
  'Helicone-Property-accountaddress': string
  'Helicone-Property-consumeraddress': string
  'Helicone-Property-agentid': string
  'Helicone-Property-planid': string
  'Helicone-Property-plantype': string
  'Helicone-Property-planname': string
  'Helicone-Property-agentname': string
  'Helicone-Property-agentrequestid': string
  'Helicone-Property-pricepercredit': string
  'Helicone-Property-environmentname': string
  'Helicone-Property-batch': string
  'Helicone-Property-ismarginbased': string
  'Helicone-Property-marginpercent': string
}

export type DefaultHeliconeHeaders = NeverminedHeliconeHeaders & CustomProperties

export type ChatOpenAIConfiguration = {
  model: string
  apiKey: string
  configuration: {
    baseURL: string
    defaultHeaders: DefaultHeliconeHeaders
  }
}

export type OpenAIConfiguration = {
  apiKey: string
  baseURL: string
  defaultHeaders: DefaultHeliconeHeaders
}
