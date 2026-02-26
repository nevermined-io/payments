/**
 * Unit tests for x402 and delegation commands
 */

import { expect, test, describe, beforeEach, afterEach, jest } from '@jest/globals'
import GetX402AccessToken from '../../src/commands/x402token/get-x402-access-token.js'
import ListPaymentMethods from '../../src/commands/delegation/list-payment-methods.js'
import { createTestConfig, cleanupTestConfig, OutputCapture } from '../helpers/test-utils.js'

// Use manual mock for Payments SDK
jest.mock('@nevermined-io/payments')

describe('x402 commands', () => {
  let tmpDir: string
  let configPath: string
  let output: OutputCapture

  beforeEach(async () => {
    const testConfig = await createTestConfig()
    tmpDir = testConfig.tmpDir
    configPath = testConfig.configPath
    process.env.NVM_CONFIG = configPath

    output = new OutputCapture()
    output.start()
  })

  afterEach(async () => {
    output.stop()
    delete process.env.NVM_CONFIG
    await cleanupTestConfig(tmpDir)
  })

  describe('get-x402-access-token', () => {
    test('should get access token (crypto default)', async () => {
      await GetX402AccessToken.run(['did:nvm:test-plan-1'])

      const logs = output.getOutput()
      expect(logs).toContain('mock-token-for-did:nvm:test-plan-1')
    })

    test('should get token in JSON format', async () => {
      await GetX402AccessToken.run(['did:nvm:test-plan-1', '--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      expect(parsed.accessToken).toBe('mock-token-for-did:nvm:test-plan-1')
    })

    test('should get fiat token with --payment-type fiat', async () => {
      await GetX402AccessToken.run([
        'did:nvm:test-plan-1',
        '--payment-type', 'fiat',
        '--format', 'json',
      ])

      // Auto-select info goes to stderr, JSON output to stdout
      const errors = output.getErrorOutput()
      expect(errors).toContain('Auto-selected payment method')

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      expect(parsed.accessToken).toBe('mock-token-for-did:nvm:test-plan-1-fiat')
    })

    test('should get fiat token with explicit payment method ID', async () => {
      await GetX402AccessToken.run([
        'did:nvm:test-plan-1',
        '--payment-type', 'fiat',
        '--payment-method-id', 'pm_custom_123',
        '--spending-limit-cents', '5000',
        '--delegation-duration-secs', '7200',
        '--format', 'json',
      ])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      expect(parsed.accessToken).toBe('mock-token-for-did:nvm:test-plan-1-fiat')
    })

    test('should auto-resolve scheme from plan metadata', async () => {
      await GetX402AccessToken.run([
        'did:nvm:test-plan-1',
        '--auto-resolve-scheme',
        '--format', 'json',
      ])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      // resolveScheme mock returns 'nvm:erc4337' by default, so crypto behavior
      expect(parsed.accessToken).toBe('mock-token-for-did:nvm:test-plan-1')
    })
  })

  describe('delegation list-payment-methods', () => {
    test('should list payment methods', async () => {
      await ListPaymentMethods.run([])

      const logs = output.getOutput()
      expect(logs).toContain('visa')
      expect(logs).toContain('4242')
    })

    test('should list payment methods in JSON format', async () => {
      await ListPaymentMethods.run(['--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].id).toBe('pm_test_visa_4242')
      expect(parsed[0].brand).toBe('visa')
      expect(parsed[0].last4).toBe('4242')
      expect(parsed[1].id).toBe('pm_test_mc_5555')
      expect(parsed[1].brand).toBe('mastercard')
    })
  })
})
