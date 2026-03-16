import {
  Currency,
  EURC_TOKEN_ADDRESS,
  EURC_TOKEN_ADDRESS_TESTNET,
  Address,
} from '../../src/common/types.js'
import {
  getFiatPriceConfig,
  getEURCPriceConfig,
  getERC20PriceConfig,
} from '../../src/plans.js'
import { ZeroAddress } from '../../src/environments.js'

const receiver: Address = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'

describe('Currency support', () => {
  describe('getFiatPriceConfig', () => {
    test('defaults to USD when no currency is provided', () => {
      const config = getFiatPriceConfig(1000n, receiver)
      expect(config.isCrypto).toBe(false)
      expect(config.currency).toBe(Currency.USD)
      expect(config.amounts).toEqual([1000n])
      expect(config.receivers).toEqual([receiver])
      expect(config.tokenAddress).toBe(ZeroAddress)
    })

    test('accepts Currency.EUR', () => {
      const config = getFiatPriceConfig(2900n, receiver, Currency.EUR)
      expect(config.isCrypto).toBe(false)
      expect(config.currency).toBe('EUR')
      expect(config.amounts).toEqual([2900n])
    })

    test('accepts a string currency code', () => {
      const config = getFiatPriceConfig(500n, receiver, 'GBP')
      expect(config.currency).toBe('GBP')
    })
  })

  describe('getEURCPriceConfig', () => {
    test('returns correct EURC config with default mainnet address', () => {
      const config = getEURCPriceConfig(2900n, receiver)
      expect(config.isCrypto).toBe(true)
      expect(config.currency).toBe(Currency.EURC)
      expect(config.tokenAddress).toBe(EURC_TOKEN_ADDRESS)
      expect(config.amounts).toEqual([2900n])
      expect(config.receivers).toEqual([receiver])
    })

    test('accepts custom EURC address (testnet)', () => {
      const config = getEURCPriceConfig(100n, receiver, EURC_TOKEN_ADDRESS_TESTNET)
      expect(config.tokenAddress).toBe(EURC_TOKEN_ADDRESS_TESTNET)
      expect(config.currency).toBe(Currency.EURC)
    })
  })

  describe('backward compatibility', () => {
    test('getERC20PriceConfig does not include currency by default', () => {
      const usdcAddress: Address = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
      const config = getERC20PriceConfig(20n, usdcAddress, receiver)
      expect(config.isCrypto).toBe(true)
      expect(config.currency).toBeUndefined()
      expect(config.tokenAddress).toBe(usdcAddress)
    })
  })

  describe('Currency enum', () => {
    test('has correct values', () => {
      expect(Currency.USD).toBe('USD')
      expect(Currency.EUR).toBe('EUR')
      expect(Currency.USDC).toBe('USDC')
      expect(Currency.EURC).toBe('EURC')
    })
  })

  describe('EURC token addresses', () => {
    test('mainnet address is correct', () => {
      expect(EURC_TOKEN_ADDRESS).toBe('0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42')
    })

    test('testnet address is correct', () => {
      expect(EURC_TOKEN_ADDRESS_TESTNET).toBe('0x808456652fdb597867f38412077A9182bf77359F')
    })
  })
})
