import { Payments } from '../../src/payments.js'
import { PlanRedemptionType, PaymentOptions, Address, Currency } from '../../src/common/types.js'
import {
  getPayAsYouGoPriceConfig,
  getFiatPayAsYouGoPriceConfig,
  getPayAsYouGoCreditsConfig,
} from '../../src/plans.js'

const TEST_API_KEY =
  process.env.TEST_PROXY_BEARER_TOKEN ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDIxRjc5ZjlkM2I2ZDUyZUY4Y2M4QjFhN0YyNjFCY2Y1ZjJFRjM1NGEiLCJqdGkiOiIweGUxMjIwMmRkMzZlZmQ4N2FkMjE1MmRlMjlkM2MwNmE5ZDU5N2M4NWJhOGMxOTQ1YjQ5MjlkYTYyYTRiZjQ1NGYiLCJleHAiOjE3OTEwNDc0OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.JI14qfSWHCWRvHOK9TAg3HEXWX7oKEI6fU6gaaWlyDl5btBWLh8FQo1ZnuzixPmgsUR3gc4oRlenLPUuTy-mORw'

const receiver: Address = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const templateAddress: Address = '0x5e852077b30099106Aa65B4d329FFF9b5C9a8e7C'
const ZERO = '0x0000000000000000000000000000000000000000'

describe('Pay As You Go helpers', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  test('plan helpers require templateAddress and set defaults', () => {
    expect(() => getPayAsYouGoPriceConfig(100n, receiver)).toThrow('templateAddress is required')

    const priceConfig = getPayAsYouGoPriceConfig(100n, receiver, undefined, templateAddress)
    expect(priceConfig.templateAddress).toBe(templateAddress)
    expect(priceConfig.isCrypto).toBe(true)
    expect(priceConfig.amounts).toEqual([100n])
    expect(priceConfig.receivers).toEqual([receiver])

    const credits = getPayAsYouGoCreditsConfig()
    expect(credits.isRedemptionAmountFixed).toBe(false)
    expect(credits.redemptionType).toBe(PlanRedemptionType.ONLY_SUBSCRIBER)
    expect(credits.durationSecs).toBe(0n)
    expect(credits.amount).toBe(1n)
  })

  describe('getFiatPayAsYouGoPriceConfig', () => {
    test('builds a fiat (card) PAYG price config with defaults', () => {
      const priceConfig = getFiatPayAsYouGoPriceConfig(
        1_000_000n,
        receiver,
        undefined,
        templateAddress,
      )
      // Pin the full object (mirrors the crypto sibling) so a mutation of any non-template address
      // field — tokenAddress/contractAddress/feeController/externalPriceAddress away from
      // ZeroAddress, or isCrypto flipped true — is caught, not just the fields the builder stamps.
      expect(priceConfig).toEqual({
        tokenAddress: ZERO,
        amounts: [1_000_000n],
        receivers: [receiver],
        contractAddress: ZERO,
        feeController: ZERO,
        externalPriceAddress: ZERO,
        templateAddress,
        isCrypto: false,
        currency: Currency.USD,
      })
    })

    test('accepts an explicit currency (EUR)', () => {
      const priceConfig = getFiatPayAsYouGoPriceConfig(
        2_000_000n,
        receiver,
        Currency.EUR,
        templateAddress,
      )
      expect(priceConfig.currency).toBe(Currency.EUR)
      expect(priceConfig.isCrypto).toBe(false)
      expect(priceConfig.templateAddress).toBe(templateAddress)
    })

    test('validates the receiver before the templateAddress, like the crypto sibling', () => {
      // Invalid receiver with templateAddress omitted: the receiver error is thrown first,
      // proving the receiver is validated before the missing-template check.
      expect(() => getFiatPayAsYouGoPriceConfig(1_000_000n, '0xnot-an-address' as Address)).toThrow(
        'is not a valid Ethereum address',
      )
    })

    test('throws when templateAddress is missing (valid receiver)', () => {
      expect(() => getFiatPayAsYouGoPriceConfig(1_000_000n, receiver)).toThrow(
        'templateAddress is required',
      )
    })
  })

  test('PlansAPI builds pay-as-you-go configs using contracts API', async () => {
    const deployment = { deployment: { contracts: { PayAsYouGoTemplate: templateAddress } } }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => deployment,
    }) as any

    const options: PaymentOptions = {
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    }
    const payments = Payments.getInstance(options)

    const priceConfig = await payments.plans.getPayAsYouGoPriceConfig(200n, receiver)
    expect(priceConfig.templateAddress).toBe(templateAddress)
    expect(priceConfig.tokenAddress).toBeDefined()

    const credits = payments.plans.getPayAsYouGoCreditsConfig()
    expect(credits.redemptionType).toBe(PlanRedemptionType.ONLY_SUBSCRIBER)
  })

  test('PlansAPI.getFiatPayAsYouGoPriceConfig fetches the template from the contracts API', async () => {
    // Serve a template address DISTINCT from the pure-builder fixture, so the assertion proves the
    // method used the fetched address rather than a hardcoded fixture that happens to match.
    const fetchedTemplate: Address = '0x1111111111111111111111111111111111111111'
    const deployment = { deployment: { contracts: { PayAsYouGoTemplate: fetchedTemplate } } }
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => deployment,
    }) as any

    const options: PaymentOptions = {
      nvmApiKey: TEST_API_KEY,
      environment: 'staging_sandbox',
    }
    const payments = Payments.getInstance(options)

    const priceConfig = await payments.plans.getFiatPayAsYouGoPriceConfig(1_000_000n, receiver)
    expect(priceConfig.templateAddress).toBe(fetchedTemplate)
    expect(priceConfig.templateAddress).not.toBe(templateAddress)
    expect(priceConfig.isCrypto).toBe(false)
    expect(priceConfig.currency).toBe(Currency.USD)

    const eurConfig = await payments.plans.getFiatPayAsYouGoPriceConfig(
      2_000_000n,
      receiver,
      Currency.EUR,
    )
    expect(eurConfig.currency).toBe(Currency.EUR)
    expect(eurConfig.templateAddress).toBe(fetchedTemplate)
  })
})
