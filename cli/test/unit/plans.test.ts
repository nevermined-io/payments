/**
 * Unit tests for plans commands
 */

import { expect, test, describe, beforeEach, afterEach, jest } from '@jest/globals'
import PlansList from '../../src/commands/plans/get-plans.js'
import PlansGet from '../../src/commands/plans/get-plan.js'
import PlansBalance from '../../src/commands/plans/get-plan-balance.js'
import { createTestConfig, cleanupTestConfig, OutputCapture } from '../helpers/test-utils.js'

// Use manual mock for Payments SDK
jest.mock('@nevermined-io/payments')

describe('plans commands', () => {
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

  describe('plans list', () => {
    test('should list plans in table format', async () => {
      await PlansList.run([])

      const logs = output.getOutput()
      expect(logs).toContain('Test Plan 1')
      expect(logs).toContain('Test Plan 2')
      expect(logs).toContain('did:nvm:test-plan-1')
      expect(logs).toContain('did:nvm:test-plan-2')
    })

    test('should list plans in JSON format', async () => {
      await PlansList.run(['--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)

      // `getPlans` returns the paginated envelope, not a bare array — the
      // command outputs the SDK result verbatim.
      expect(Array.isArray(parsed.plans)).toBe(true)
      expect(parsed.plans.length).toBe(2)
      expect(parsed.plans[0].name).toBe('Test Plan 1')
      expect(parsed.plans[1].name).toBe('Test Plan 2')
      expect(parsed.total).toBe(2)
    })

    test('should work with quiet format', async () => {
      await PlansList.run(['--format', 'quiet'])

      const logs = output.getOutput()
      expect(logs).toBe('')
    })
  })

  describe('plans get', () => {
    test('should get plan details', async () => {
      await PlansGet.run(['did:nvm:test-plan-1'])

      const logs = output.getOutput()
      expect(logs).toContain('Test Plan 1')
      expect(logs).toContain('did:nvm:test-plan-1')
    })

    test('should get plan in JSON format', async () => {
      await PlansGet.run(['did:nvm:test-plan-1', '--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)

      expect(parsed.name).toBe('Test Plan 1')
      expect(parsed.did).toBe('did:nvm:test-plan-1')
      expect(parsed.planType).toBe('credits')
    })

    test('should fail with non-existent plan', async () => {
      await expect(PlansGet.run(['did:nvm:non-existent'])).rejects.toThrow()
    })
  })

  describe('plans balance', () => {
    test('should get plan balance', async () => {
      await PlansBalance.run(['did:nvm:test-plan-1'])

      const logs = output.getOutput()
      expect(logs).toContain('Test Plan 1')
      expect(logs).toContain('1000')
      // The table formatter renders values with String(), so a boolean is
      // 'true' — it has no Yes/No mapping and never has. The old expectation
      // could only ever have passed against a formatter that no longer exists.
      expect(logs).toContain('true') // isSubscriber
    })

    test('should get balance in JSON format', async () => {
      await PlansBalance.run(['did:nvm:test-plan-1', '--format', 'json'])

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)

      expect(parsed.planName).toBe('Test Plan 1')
      expect(parsed.isSubscriber).toBe(true)
      expect(BigInt(parsed.balance)).toBe(BigInt(1000))
    })

    test('should fail with non-existent plan', async () => {
      await expect(PlansBalance.run(['did:nvm:non-existent'])).rejects.toThrow()
    })
  })
})
