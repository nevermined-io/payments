/**
 * Real API integration tests
 * These tests make actual API calls to the sandbox environment
 */

import { expect, test, describe, beforeAll } from '@jest/globals'
import { execSync } from 'child_process'
import { join } from 'path'
import { readFileSync } from 'fs'

const CLI_PATH = join(__dirname, '../../bin/run.js')
const ENV_FILE = join(__dirname, '../../.env.testing')

// Load test credentials
let TEST_API_KEY: string
let TEST_ENVIRONMENT: string

beforeAll(() => {
  // Load credentials from .env.testing
  const envContent = readFileSync(ENV_FILE, 'utf-8')
  const apiKeyMatch = envContent.match(/NVM_API_KEY="([^"]+)"/)
  const envMatch = envContent.match(/ENVIRONMENT="([^"]+)"/)

  if (!apiKeyMatch || !envMatch) {
    throw new Error('Missing credentials in .env.testing')
  }

  TEST_API_KEY = apiKeyMatch[1]
  TEST_ENVIRONMENT = envMatch[1]

  // Build CLI
  try {
    execSync('yarn build && npx oclif manifest', {
      cwd: join(__dirname, '../..'),
      stdio: 'ignore',
    })
  } catch {
    // Already built
  }
})

function runCLI(args: string[], env: Record<string, string> = {}): {
  stdout: string
  stderr: string
  exitCode: number
} {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NVM_API_KEY: TEST_API_KEY,
        NVM_ENVIRONMENT: TEST_ENVIRONMENT,
        ...env,
      },
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: any) {
    return {
      stdout: error.stdout?.toString() || '',
      stderr: error.stderr?.toString() || '',
      exitCode: error.status || 1,
    }
  }
}

describe('Real API Integration Tests', () => {
  describe('Plans Commands', () => {
    test('should list plans from API', () => {
      const { stdout, exitCode } = runCLI(['plans', 'list', '--format', 'json'])

      expect(exitCode).toBe(0)

      // Should return valid JSON
      const plans = JSON.parse(stdout)
      expect(Array.isArray(plans)).toBe(true)

      console.log(`✓ Found ${plans.length} plans in sandbox environment`)
    }, 30000)

    test('should list plans in table format', () => {
      const { stdout, exitCode } = runCLI(['plans', 'list'])

      expect(exitCode).toBe(0)
      // Table output should contain some structure
      expect(stdout.length).toBeGreaterThan(0)

      console.log('✓ Plans listed in table format')
    }, 30000)

    test('should get specific plan if one exists', () => {
      // First get the list
      const { stdout: listOutput } = runCLI(['plans', 'list', '--format', 'json'])
      const plans = JSON.parse(listOutput)

      if (plans.length > 0) {
        const planId = plans[0].did
        const { stdout, exitCode } = runCLI(['plans', 'get', planId, '--format', 'json'])

        expect(exitCode).toBe(0)
        const plan = JSON.parse(stdout)
        expect(plan.did).toBe(planId)

        console.log(`✓ Retrieved plan: ${plan.name}`)
      } else {
        console.log('⚠ No plans available to test get command')
      }
    }, 30000)

    test('should check plan balance if plan exists', () => {
      // First get the list
      const { stdout: listOutput } = runCLI(['plans', 'list', '--format', 'json'])
      const plans = JSON.parse(listOutput)

      if (plans.length > 0) {
        const planId = plans[0].did
        const { stdout, exitCode } = runCLI(['plans', 'balance', planId, '--format', 'json'])

        expect(exitCode).toBe(0)
        const balance = JSON.parse(stdout)
        expect(balance.planId).toBe(planId)
        expect(balance).toHaveProperty('balance')
        expect(balance).toHaveProperty('isSubscriber')

        console.log(`✓ Plan balance: ${balance.balance}`)
      } else {
        console.log('⚠ No plans available to test balance command')
      }
    }, 30000)
  })

  describe('X402 Commands', () => {
    test('should get X402 token if plan exists', () => {
      // First get a plan
      const { stdout: listOutput } = runCLI(['plans', 'list', '--format', 'json'])
      const plans = JSON.parse(listOutput)

      if (plans.length > 0) {
        const planId = plans[0].did
        const { stdout, exitCode } = runCLI(['x402', 'get-token', planId, '--format', 'json'])

        expect(exitCode).toBe(0)
        const result = JSON.parse(stdout)
        expect(result).toHaveProperty('accessToken')
        expect(result.accessToken).toBeTruthy()
        expect(typeof result.accessToken).toBe('string')

        console.log('✓ X402 token generated successfully')
        console.log(`  Token preview: ${result.accessToken.substring(0, 50)}...`)
      } else {
        console.log('⚠ No plans available to test X402 token')
      }
    }, 30000)
  })

  describe('Agents Commands', () => {
    test('should get agent if one exists', () => {
      // First get plans to find if any have agents
      const { stdout: listOutput } = runCLI(['plans', 'list', '--format', 'json'])
      const plans = JSON.parse(listOutput)

      if (plans.length > 0 && plans[0].agentDid) {
        const agentId = plans[0].agentDid
        const { stdout, exitCode } = runCLI(['agents', 'get', agentId, '--format', 'json'])

        expect(exitCode).toBe(0)
        const agent = JSON.parse(stdout)
        expect(agent.did).toBe(agentId)

        console.log(`✓ Retrieved agent: ${agent.name}`)
      } else {
        console.log('⚠ No agents available to test get command')
      }
    }, 30000)
  })

  describe('Config Commands', () => {
    test('should initialize config with test credentials', () => {
      const { stdout, exitCode } = runCLI([
        'config', 'init',
        '--api-key', TEST_API_KEY,
        '--environment', TEST_ENVIRONMENT,
      ])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Configuration initialized')

      console.log('✓ Config initialized successfully')
    }, 30000)

    test('should show config', () => {
      const { stdout, exitCode } = runCLI(['config', 'show', '--format', 'json'])

      expect(exitCode).toBe(0)
      const config = JSON.parse(stdout)
      expect(config).toHaveProperty('nvmApiKey')
      expect(config).toHaveProperty('environment')

      console.log('✓ Config displayed successfully')
    }, 30000)
  })

  describe('Error Handling', () => {
    test('should handle invalid plan ID gracefully', () => {
      const { exitCode, stderr } = runCLI([
        'plans', 'get', 'did:nvm:invalid-plan-id',
      ])

      expect(exitCode).not.toBe(0)
      expect(stderr.length).toBeGreaterThan(0)

      console.log('✓ Invalid plan ID handled correctly')
    }, 30000)

    test('should handle invalid agent ID gracefully', () => {
      const { exitCode } = runCLI([
        'agents', 'get', 'did:nvm:invalid-agent-id',
      ])

      expect(exitCode).not.toBe(0)

      console.log('✓ Invalid agent ID handled correctly')
    }, 30000)
  })

  describe('Output Formats', () => {
    test('should support all output formats', () => {
      // Test JSON format
      const jsonResult = runCLI(['plans', 'list', '--format', 'json'])
      expect(jsonResult.exitCode).toBe(0)
      expect(() => JSON.parse(jsonResult.stdout)).not.toThrow()

      // Test table format
      const tableResult = runCLI(['plans', 'list', '--format', 'table'])
      expect(tableResult.exitCode).toBe(0)

      // Test quiet format
      const quietResult = runCLI(['plans', 'list', '--format', 'quiet'])
      expect(quietResult.exitCode).toBe(0)

      console.log('✓ All output formats working')
    }, 30000)
  })
})
