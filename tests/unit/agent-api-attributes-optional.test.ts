/**
 * Type-level + runtime checks that AgentAPIAttributes accepts payloads with
 * `endpoints` and `agentDefinitionUrl` omitted. These two fields are now
 * opt-in Additional Security — see nevermined-io/internal#897.
 */

import { AgentAPIAttributes } from '../../src/common/types.js'

describe('AgentAPIAttributes — optional fields', () => {
  it('compiles when endpoints and agentDefinitionUrl are omitted', () => {
    const minimal: AgentAPIAttributes = {}
    expect(minimal).toEqual({})
  })

  it('compiles with only authentication fields', () => {
    const authOnly: AgentAPIAttributes = {
      authType: 'bearer',
      token: 'sk-test-abc',
    }
    expect(authOnly.authType).toBe('bearer')
    expect(authOnly.token).toBe('sk-test-abc')
  })

  it('still accepts the full shape with both fields populated', () => {
    const full: AgentAPIAttributes = {
      endpoints: [{ POST: 'https://example.com/api/run' }],
      openEndpoints: ['https://example.com/health'],
      agentDefinitionUrl: 'https://example.com/openapi.json',
      authType: 'bearer',
      token: 'sk-test',
    }
    expect(full.endpoints).toHaveLength(1)
    expect(full.agentDefinitionUrl).toBe('https://example.com/openapi.json')
  })

  it('compiles when only endpoints is provided (Additional Security opt-in)', () => {
    const allowlistOnly: AgentAPIAttributes = {
      endpoints: [{ POST: 'https://example.com/api/run' }],
    }
    expect(allowlistOnly.agentDefinitionUrl).toBeUndefined()
  })

  it('compiles when only agentDefinitionUrl is provided', () => {
    const definitionOnly: AgentAPIAttributes = {
      agentDefinitionUrl: 'https://example.com/openapi.json',
    }
    expect(definitionOnly.endpoints).toBeUndefined()
  })
})
