import { Payments } from '../../src/payments'
import { Environments } from '../../src/environments'
import { StartAgentRequest } from '../../src/common/types'

describe('Observability-Api (unit)', () => {
  const nvmApiKeyHash =
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDQzQ0FDZUQxNURhRWE4MDE2RTIzNDI5NThFZjgyQTk0NTAxMTJlMTgiLCJqdGkiOiIweDJmNzZlN2ZkYzI3ZWIyYmYzYjQ0ODRlYmY1Mzk4YWQ5MjllMjMxYTYwODlmMDE5Zjk5ZDAzMjk3Mjk4YWYzZTkiLCJleHAiOjE3ODczMjc3MDEsIm8xMXkiOiJzay1oZWxpY29uZS1tamZ6MzJhLXF4aXVpMnEteDV5YmNoeS11NnJjZXhpIn0.KdMMHlHvpENmvT6ozVdfmtNC6KFMnh_XNNQEV_qxPpFgzvUM86vM21E5YKFVWkjK_yMAnNh6XVJGVjqPVuew6xs'
  const agentRequest = {
    agentRequestId: 'test-agent-request-id',
    agentName: 'test-agent-name',
    agentId: 'test-agent-id',
    balance: {
      planId: 'test-plan-id',
      planName: 'test-plan-name',
      planType: 'test-plan-type',
      pricePerCredit: 0.001,
    },
    urlMatching: 'test-url-matching',
    verbMatching: 'test-verb-matching',
  } as StartAgentRequest

  it('should initialize correctly with the helicone api key and helicone url', () => {
    const payments = Payments.getInstance({
      nvmApiKey: nvmApiKeyHash,
      environment: 'custom',
    })

    const cfg = payments.observability.withHeliconeOpenAI('sk-openai', agentRequest, {
      agentid: 'test-agent',
      sessionid: 'test-session',
    })
    expect(cfg.defaultHeaders['Helicone-Auth']).toBe(
      'Bearer sk-helicone-mjfz32a-qxiui2q-x5ybchy-u6rcexi',
    )
    expect(cfg.baseURL).toBe('http://localhost:8585/jawn/v1/gateway/oai/v1')
  })

  it('should override the helicone api key and helicone url', () => {
    const originalEnv = { ...process.env }
    const originalCustom = Environments.custom

    process.env.HELICONE_API_KEY = 'sk-custom-helicone-key'
    process.env.HELICONE_URL = 'https://custom.helicone.com'
    Environments.custom = { ...originalCustom, heliconeUrl: 'https://custom.helicone.com' }

    const payments = Payments.getInstance({ nvmApiKey: nvmApiKeyHash, environment: 'custom' })
    const cfg = payments.observability.withHeliconeOpenAI('sk-openai', agentRequest, {
      agentid: 'test-agent',
      sessionid: 'test-session',
    })

    expect(cfg.defaultHeaders['Helicone-Auth']).toBe('Bearer sk-custom-helicone-key')
    expect(cfg.baseURL).toBe('https://custom.helicone.com/jawn/v1/gateway/oai/v1')

    process.env = originalEnv
    Environments.custom = originalCustom
  })
})
