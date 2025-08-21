import { Payments } from '../../src/payments'

describe('Observability-Api (unit)', () => {
  const nvmApiKeyHash =
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDQzQ0FDZUQxNURhRWE4MDE2RTIzNDI5NThFZjgyQTk0NTAxMTJlMTgiLCJqdGkiOiIweDJmNzZlN2ZkYzI3ZWIyYmYzYjQ0ODRlYmY1Mzk4YWQ5MjllMjMxYTYwODlmMDE5Zjk5ZDAzMjk3Mjk4YWYzZTkiLCJleHAiOjE3ODczMjc3MDEsIm8xMXkiOiJzay1oZWxpY29uZS1tamZ6MzJhLXF4aXVpMnEteDV5YmNoeS11NnJjZXhpIn0.KdMMHlHvpENmvT6ozVdfmtNC6KFMnh_XNNQEV_qxPpFgzvUM86vM21E5YKFVWkjK_yMAnNh6XVJGVjqPVuew6xs'

  it('should initialize correctly with the helicone api key', () => {
    const payments = Payments.getInstance({
      nvmApiKey: nvmApiKeyHash,
      environment: 'staging_sandbox',
    })

    const cfg = payments.observability.withHeliconeOpenAI('sk-openai')
    expect(cfg.defaultHeaders['Helicone-Auth']).toBe(
      'Bearer sk-helicone-mjfz32a-qxiui2q-x5ybchy-u6rcexi',
    )
  })
})
