/**
 * Unit tests for agents commands
 */

import { expect, test, describe, beforeEach, afterEach, jest } from '@jest/globals'
import AgentsGet from '../../src/commands/agents/get.js'
import { createTestConfig, cleanupTestConfig, OutputCapture } from '../helpers/test-utils.js'

// Use manual mock for Payments SDK
jest.mock('@nevermined-io/payments')

describe('agents commands', () => {
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

  describe('agents get', () => {
    test('should get agent details', async () => {
      await AgentsGet.run(['did:nvm:test-agent-1'])

      const logs = output.getOutput()
      expect(logs).toContain('Test Agent 1')
      expect(logs).toContain('did:nvm:test-agent-1')
    })

    test('should get agent in JSON format', async () => {
      await AgentsGet.run(['did:nvm:test-agent-1', '--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)

      expect(parsed.name).toBe('Test Agent 1')
      expect(parsed.did).toBe('did:nvm:test-agent-1')
      expect(parsed.planDid).toBe('did:nvm:test-plan-1')
    })

    test('should fail with non-existent agent', async () => {
      await expect(AgentsGet.run(['did:nvm:non-existent'])).rejects.toThrow()
    })
  })
})
