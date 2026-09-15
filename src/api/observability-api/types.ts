import type OpenAI from 'openai'
import type Together from 'together-ai'
import type * as anthropic from '@anthropic-ai/sdk'
import type * as cohere from 'cohere-ai'
import type * as bedrock from '@aws-sdk/client-bedrock-runtime'
import type * as google_aiplatform from '@google-cloud/aiplatform'

/**
 * A LangChain entry-point module handed over by the caller.
 *
 * On the resolved `@traceloop/node-server-sdk` (0.26.0) nothing reads a member
 * of it. `observability-api.ts` forwards the bag to
 * `traceloop.initialize({ instrumentModules })` behind an `as any`, and there
 * the field is declared `langchain?: boolean` and never consulted —
 * `instrumentModules?.langchain` appears nowhere in its `dist/` — because
 * LangChain is instrumented unconditionally by hooking
 * `@langchain/core/callbacks/manager`.
 *
 * That was not always so. traceloop 0.14 declared five module fields
 * (`chainsModule`, `agentsModule`, `toolsModule`, `runnablesModule`,
 * `vectorStoreModule`) and passed them to `manuallyInstrument`; #158 took three
 * of them, and they went inert with the 0.26 bump in #312. They stay for source
 * compatibility with callers written against that contract.
 *
 * Typing the three as `typeof import('langchain/chains')` and friends therefore
 * bought no checking, and cost twice. It pinned this SDK's build to one
 * LangChain layout — v1 moved the legacy chains and agents entry points out, so
 * those subpaths stopped resolving and a dev-only bump failed with TS2307
 * (#317) — and, because declaration emit keeps those imports in the published
 * `types.d.ts` while `langchain` is neither a dependency nor a peer, it broke
 * the typecheck of any consumer building with `skipLibCheck: false` unless they
 * happened to have a 0.3-layout `langchain` installed.
 */
export type LangChainModule = Record<string, unknown>

export type AsyncLoggerProviders = {
  openAI?: typeof OpenAI
  anthropic?: typeof anthropic
  cohere?: typeof cohere
  bedrock?: typeof bedrock
  google_aiplatform?: typeof google_aiplatform
  together?: typeof Together
  /**
   * Inert on the resolved traceloop (0.26.0), which instruments LangChain
   * unconditionally and ignores these modules. See {@link LangChainModule}.
   */
  langchain?: {
    chainsModule?: LangChainModule
    agentsModule?: LangChainModule
    toolsModule?: LangChainModule
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
