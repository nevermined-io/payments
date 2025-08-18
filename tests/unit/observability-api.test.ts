import { Payments } from '../../src/payments'

describe('Observability-Api (unit)', () => {
  const nvmApiKeyHash =
    'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDA2OEVkMDBjRjA0NDFlNDgyOUQ5Nzg0ZkNCZTdiOWUyNkQ0QkQ4ZDAiLCJzdWIiOiIweDc3OUEzMDNEYTA3NjkwMzgxNkNBOTRlODhERDViNDJCMjE3M0YyNjciLCJqdGkiOiIweDM0MzAxYmIyMDYzYjNlYjVkNWE0NjFmZDM1YzI2MmVhNzI5Yzg5NDlhMWYzZTFhNzY4YmM2MWZiN2EzMzkyN2IiLCJleHAiOjE3ODcwODMxMzksIm9ic2VydmFiaWxpdHkiOiJzay1oZWxpY29uZS0zMm1hanFpLWZscGVsZGEtdTcyaWZ0eS1mY2VjY3lxIn0.aHNSLRCNOa3TBP2lTvlqOHuGTA0l7JhpuxoSm7VsB91PbXhVixq79wpxzLoe_H7OCSTzIbKLi5HXv_7vLEr7MBw'

  it('should initialize correctly with the helicone api key', () => {
    const payments = Payments.getInstance({
      nvmApiKey: nvmApiKeyHash,
      environment: 'staging_sandbox',
    })

    const cfg = payments.observability.withHeliconeOpenAI('sk-openai')
    expect(cfg.defaultHeaders['Helicone-Auth']).toBe(
      'Bearer sk-helicone-32majqi-flpelda-u72ifty-fceccyq',
    )
  })
})
