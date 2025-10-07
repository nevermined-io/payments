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
