/**
 * Unit tests for x402 commands
 */

import { expect, test, describe, beforeEach, afterEach, jest } from '@jest/globals'
import X402GetToken from '../../src/commands/x402/get-token.js'
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

  describe('x402 get-token', () => {
    test('should get access token', async () => {
      await X402GetToken.run(['did:nvm:test-plan-1'])

      const logs = output.getOutput()
      expect(logs).toContain('Access token generated')
      expect(logs).toContain('mock-token-for-did:nvm:test-plan-1')
      expect(logs).toContain('X-NVM-PROXY-ACCESS-TOKEN')
    })

    test('should get token in JSON format', async () => {
      await X402GetToken.run(['did:nvm:test-plan-1', '--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)

      expect(parsed.accessToken).toBe('mock-token-for-did:nvm:test-plan-1')
    })
  })
})
