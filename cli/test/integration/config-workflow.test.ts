/**
 * Integration tests for config workflow
 * Tests the complete configuration management workflow
 */

import { expect, test, describe, beforeAll, afterAll } from '@jest/globals'
import { execSync } from 'child_process'
import { join } from 'path'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'

const CLI_PATH = join(__dirname, '../../bin/run.js')

function runCLI(
  args: string[],
  env: Record<string, string> = {}
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
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

describe('Config Workflow Integration Tests', () => {
  let tmpDir: string
  let configPath: string

  beforeAll(async () => {
    // Create temp directory for test config
    tmpDir = await mkdtemp(join(tmpdir(), 'nvm-config-test-'))
    configPath = join(tmpDir, 'config.json')

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

  afterAll(async () => {
    // Cleanup
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Config Init Workflow', () => {
    test('should initialize config with API key and environment', () => {
      const { stdout, exitCode } = runCLI(
        [
          'config', 'init',
          '--api-key', 'test-api-key-123',
          '--environment', 'staging_sandbox',
        ],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Configuration initialized')
      expect(stdout).toContain('staging_sandbox')
    })

    test('should reject invalid environment', () => {
      const { exitCode } = runCLI(
        [
          'config', 'init',
          '--api-key', 'test-key',
          '--environment', 'invalid-env',
        ],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).not.toBe(0)
    })
  })

  describe('Config Show Workflow', () => {
    test('should show config after initialization', () => {
      // First initialize
      runCLI(
        [
          'config', 'init',
          '--api-key', 'show-test-key',
          '--environment', 'sandbox',
        ],
        { NVM_CONFIG: configPath }
      )

      // Then show
      const { stdout, exitCode } = runCLI(
        ['config', 'show'],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain('show-test-key')
      expect(stdout).toContain('sandbox')
    })

    test('should show config in JSON format', () => {
      // Initialize first
      runCLI(
        [
          'config', 'init',
          '--api-key', 'json-test-key',
          '--environment', 'staging_live',
        ],
        { NVM_CONFIG: configPath }
      )

      // Show in JSON
      const { stdout, exitCode } = runCLI(
        ['config', 'show', '--format', 'json'],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).toBe(0)

      // Should be valid JSON
      const parsed = JSON.parse(stdout)
      expect(parsed).toHaveProperty('nvmApiKey')
      expect(parsed).toHaveProperty('environment')
      expect(parsed.nvmApiKey).toBe('json-test-key')
      expect(parsed.environment).toBe('staging_live')
    })
  })

  describe('Config Set Workflow', () => {
    test('should update API key', () => {
      // Initialize
      runCLI(
        [
          'config', 'init',
          '--api-key', 'initial-key',
          '--environment', 'sandbox',
        ],
        { NVM_CONFIG: configPath }
      )

      // Update API key
      const { stdout, exitCode } = runCLI(
        ['config', 'set', 'nvmApiKey', 'updated-key'],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain('updated-key')

      // Verify update
      const { stdout: showOutput } = runCLI(
        ['config', 'show', '--format', 'json'],
        { NVM_CONFIG: configPath }
      )

      const config = JSON.parse(showOutput)
      expect(config.nvmApiKey).toBe('updated-key')
    })

    test('should update environment', () => {
      // Initialize
      runCLI(
        [
          'config', 'init',
          '--api-key', 'test-key',
          '--environment', 'sandbox',
        ],
        { NVM_CONFIG: configPath }
      )

      // Update environment
      const { stdout, exitCode } = runCLI(
        ['config', 'set', 'environment', 'live'],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain('live')

      // Verify update
      const { stdout: showOutput } = runCLI(
        ['config', 'show', '--format', 'json'],
        { NVM_CONFIG: configPath }
      )

      const config = JSON.parse(showOutput)
      expect(config.environment).toBe('live')
    })

    test('should reject invalid environment value', () => {
      const { exitCode } = runCLI(
        ['config', 'set', 'environment', 'invalid-environment'],
        { NVM_CONFIG: configPath }
      )

      expect(exitCode).not.toBe(0)
    })
  })

  describe('Profile Management', () => {
    test('should support multiple profiles', () => {
      const testConfigPath = join(tmpDir, 'multi-profile-config.json')

      // Create default profile
      runCLI(
        [
          'config', 'init',
          '--api-key', 'default-key',
          '--environment', 'sandbox',
        ],
        { NVM_CONFIG: testConfigPath }
      )

      // Create production profile
      runCLI(
        [
          'config', 'init',
          '--api-key', 'production-key',
          '--environment', 'live',
          '--profile', 'production',
        ],
        { NVM_CONFIG: testConfigPath }
      )

      // Show default profile
      const { stdout: defaultOutput } = runCLI(
        ['config', 'show', '--format', 'json'],
        { NVM_CONFIG: testConfigPath }
      )

      // Show production profile
      const { stdout: prodOutput } = runCLI(
        ['config', 'show', '--profile', 'production', '--format', 'json'],
        { NVM_CONFIG: testConfigPath }
      )

      const defaultConfig = JSON.parse(defaultOutput)
      const prodConfig = JSON.parse(prodOutput)

      expect(defaultConfig.nvmApiKey).toBe('default-key')
      expect(prodConfig.nvmApiKey).toBe('production-key')
    })
  })

  describe('Environment Variable Override', () => {
    test('should allow env var override of config path', () => {
      const customPath = join(tmpDir, 'custom-config.json')

      const { stdout, exitCode } = runCLI(
        [
          'config', 'init',
          '--api-key', 'env-override-key',
          '--environment', 'sandbox',
        ],
        { NVM_CONFIG: customPath }
      )

      expect(exitCode).toBe(0)
      expect(stdout).toContain('Configuration initialized')
    })
  })
})
