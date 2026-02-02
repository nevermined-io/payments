/**
 * Integration tests for ConfigManager
 * These tests actually create and manipulate config files
 */

import { expect, test, describe, beforeEach, afterEach } from '@jest/globals'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('ConfigManager Integration Tests', () => {
  let tmpDir: string
  let configPath: string
  let originalEnv: string | undefined

  beforeEach(async () => {
    // Create temp directory for test config
    tmpDir = await mkdtemp(join(tmpdir(), 'nvm-test-'))
    configPath = join(tmpDir, 'config.json')

    // Save original env
    originalEnv = process.env.NVM_CONFIG

    // Set test config path
    process.env.NVM_CONFIG = configPath
  })

  afterEach(async () => {
    // Restore original env
    if (originalEnv) {
      process.env.NVM_CONFIG = originalEnv
    } else {
      delete process.env.NVM_CONFIG
    }

    // Cleanup temp directory
    try {
      await rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('save and load', () => {
    test('should save and load config', async () => {
      const manager = ConfigManager.getInstance()

      const config = {
        profiles: {
          default: {
            nvmApiKey: 'test-key',
            environment: 'staging_sandbox',
          },
        },
        activeProfile: 'default',
      }

      await manager.save(config)
      const loaded = await manager.load()

      expect(loaded).not.toBeNull()
      expect(loaded?.activeProfile).toBe('default')
      expect(loaded?.profiles.default.nvmApiKey).toBe('test-key')
    })

    test('should return null when no config exists', async () => {
      const manager = ConfigManager.getInstance()
      const config = await manager.load()

      expect(config).toBeNull()
    })
  })

  describe('get and set', () => {
    test('should set and get values', async () => {
      const manager = ConfigManager.getInstance()

      await manager.set('nvmApiKey', 'new-key')
      await manager.set('environment', 'staging_live')

      const apiKey = await manager.get('nvmApiKey')
      const environment = await manager.get('environment')

      expect(apiKey).toBe('new-key')
      expect(environment).toBe('staging_live')
    })

    test('should get entire profile when no key specified', async () => {
      const manager = ConfigManager.getInstance()

      await manager.set('nvmApiKey', 'test-key')
      await manager.set('environment', 'sandbox')

      const profile = await manager.get()

      expect(profile).not.toBeNull()
      expect(profile.nvmApiKey).toBe('test-key')
      expect(profile.environment).toBe('sandbox')
    })

    test('should return null for non-existent key', async () => {
      const manager = ConfigManager.getInstance()

      const value = await manager.get('nonExistent')

      expect(value).toBeNull()
    })
  })

  describe('profiles', () => {
    test('should manage multiple profiles', async () => {
      const manager = ConfigManager.getInstance()

      // Create default profile
      await manager.set('nvmApiKey', 'default-key')

      // Create production profile
      await manager.setActiveProfile('production')
      await manager.set('nvmApiKey', 'prod-key')

      // Switch back to default
      await manager.setActiveProfile('default')
      const defaultKey = await manager.get('nvmApiKey')

      // Check production
      const prodKey = await manager.get('nvmApiKey', 'production')

      expect(defaultKey).toBe('default-key')
      expect(prodKey).toBe('prod-key')
    })

    test('should list all profiles', async () => {
      const manager = ConfigManager.getInstance()

      await manager.set('nvmApiKey', 'key1')
      await manager.setActiveProfile('production')
      await manager.set('nvmApiKey', 'key2')
      await manager.setActiveProfile('staging')
      await manager.set('nvmApiKey', 'key3')

      const profiles = await manager.listProfiles()

      expect(profiles).toContain('default')
      expect(profiles).toContain('production')
      expect(profiles).toContain('staging')
      expect(profiles.length).toBeGreaterThanOrEqual(3)
    })

    test('should get and set active profile', async () => {
      const manager = ConfigManager.getInstance()

      await manager.setActiveProfile('production')
      const active = await manager.getActiveProfile()

      expect(active).toBe('production')
    })

    test('should create profile on first set', async () => {
      const manager = ConfigManager.getInstance()

      await manager.set('nvmApiKey', 'test-key', 'newProfile')
      const profiles = await manager.listProfiles()

      expect(profiles).toContain('newProfile')
    })
  })

  describe('getDefaultConfigPath', () => {
    test('should return default config path', () => {
      const manager = ConfigManager.getInstance()
      const path = manager.getDefaultConfigPath()

      expect(path).toContain('.config')
      expect(path).toContain('nvm')
      expect(path).toContain('config.json')
    })
  })

  describe('error handling', () => {
    test('should handle invalid JSON gracefully', async () => {
      const manager = ConfigManager.getInstance()

      // Write invalid JSON
      await writeFile(configPath, 'invalid json{', 'utf-8')

      const config = await manager.load()

      // Should return null on parse error
      expect(config).toBeNull()
    })
  })
})
