/**
 * Unit tests for ConfigManager
 */

import { expect, test, describe, beforeEach, afterEach } from '@jest/globals'
import { ConfigManager } from '../../src/utils/config-manager.js'
import { createTestConfig, cleanupTestConfig } from '../helpers/test-utils.js'

describe('ConfigManager', () => {
  let tmpDir: string
  let configPath: string
  let configManager: ConfigManager

  beforeEach(async () => {
    const testConfig = await createTestConfig('test-key', 'staging_sandbox')
    tmpDir = testConfig.tmpDir
    configPath = testConfig.configPath
    process.env.NVM_CONFIG = configPath

    configManager = ConfigManager.getInstance()
  })

  afterEach(async () => {
    delete process.env.NVM_CONFIG
    await cleanupTestConfig(tmpDir)
  })

  test('should load existing config', async () => {
    const config = await configManager.load()

    expect(config).not.toBeNull()
    expect(config?.activeProfile).toBe('default')
    expect(config?.profiles.default.nvmApiKey).toBe('test-key')
    expect(config?.profiles.default.environment).toBe('staging_sandbox')
  })

  test('should get config value', async () => {
    const apiKey = await configManager.get('nvmApiKey')
    expect(apiKey).toBe('test-key')

    const environment = await configManager.get('environment')
    expect(environment).toBe('staging_sandbox')
  })

  test('should set config value', async () => {
    await configManager.set('nvmApiKey', 'new-key')

    const apiKey = await configManager.get('nvmApiKey')
    expect(apiKey).toBe('new-key')
  })

  test('should get active profile', async () => {
    const profile = await configManager.getActiveProfile()
    expect(profile).toBe('default')
  })

  test('should set active profile', async () => {
    await configManager.setActiveProfile('production')

    const profile = await configManager.getActiveProfile()
    expect(profile).toBe('production')
  })

  test('should list profiles', async () => {
    await configManager.setActiveProfile('production')

    const profiles = await configManager.listProfiles()
    expect(profiles).toContain('default')
    expect(profiles).toContain('production')
  })

  test('should return default config path', () => {
    const path = configManager.getDefaultConfigPath()
    expect(path).toContain('.config/nvm/config.json')
  })
})
