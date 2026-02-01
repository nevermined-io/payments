/**
 * Unit tests for config commands
 */

import { expect, test, describe, beforeEach, afterEach } from '@jest/globals'
import ConfigInit from '../../src/commands/config/init.js'
import ConfigShow from '../../src/commands/config/show.js'
import ConfigSet from '../../src/commands/config/set.js'
import { createTestConfig, cleanupTestConfig, OutputCapture } from '../helpers/test-utils.js'

describe('config commands', () => {
  let tmpDir: string
  let configPath: string
  let output: OutputCapture

  beforeEach(async () => {
    output = new OutputCapture()
    output.start()
  })

  afterEach(async () => {
    output.stop()
    if (tmpDir) {
      await cleanupTestConfig(tmpDir)
    }
  })

  describe('config init', () => {
    test('should initialize config with flags', async () => {
      const { configPath: testConfigPath, tmpDir: testTmpDir } = await createTestConfig()
      tmpDir = testTmpDir
      configPath = testConfigPath

      process.env.NVM_CONFIG = configPath

      await ConfigInit.run(['--api-key', 'test-key', '--environment', 'staging_sandbox'])

      const logs = output.getOutput()
      expect(logs).toContain('Configuration initialized')
      expect(logs).toContain('staging_sandbox')

      delete process.env.NVM_CONFIG
    })

    test('should fail with invalid environment', async () => {
      await expect(
        ConfigInit.run(['--api-key', 'test-key', '--environment', 'invalid'])
      ).rejects.toThrow()
    })
  })

  describe('config show', () => {
    beforeEach(async () => {
      const testConfig = await createTestConfig('my-api-key', 'staging_live')
      tmpDir = testConfig.tmpDir
      configPath = testConfig.configPath
      process.env.NVM_CONFIG = configPath
    })

    afterEach(() => {
      delete process.env.NVM_CONFIG
    })

    test('should display current config', async () => {
      await ConfigShow.run([])

      const logs = output.getOutput()
      expect(logs).toContain('my-api-key')
      expect(logs).toContain('staging_live')
    })

    test('should display config in JSON format', async () => {
      await ConfigShow.run(['--format', 'json'])

      const logs = output.getOutput()
      expect(logs).toContain('"nvmApiKey"')
      expect(logs).toContain('"environment"')
      expect(logs).toContain('staging_live')
    })
  })

  describe('config set', () => {
    beforeEach(async () => {
      const testConfig = await createTestConfig()
      tmpDir = testConfig.tmpDir
      configPath = testConfig.configPath
      process.env.NVM_CONFIG = configPath
    })

    afterEach(() => {
      delete process.env.NVM_CONFIG
    })

    test('should set nvmApiKey', async () => {
      await ConfigSet.run(['nvmApiKey', 'new-api-key'])

      const logs = output.getOutput()
      expect(logs).toContain('Set nvmApiKey = new-api-key')
    })

    test('should set environment', async () => {
      await ConfigSet.run(['environment', 'live'])

      const logs = output.getOutput()
      expect(logs).toContain('Set environment = live')
    })

    test('should fail with invalid environment', async () => {
      await expect(ConfigSet.run(['environment', 'invalid'])).rejects.toThrow()
    })
  })
})
