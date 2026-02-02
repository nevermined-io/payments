/**
 * Test utilities for CLI testing
 */

import { Config as OclifConfig } from '@oclif/core'
import * as fs from 'fs/promises'
import * as path from 'path'
import { tmpdir } from 'os'

/**
 * Create a temporary config file for testing
 */
export async function createTestConfig(apiKey = 'test-api-key', environment = 'staging_sandbox') {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'nvm-test-'))
  const configPath = path.join(tmpDir, 'config.json')

  const config = {
    profiles: {
      default: {
        nvmApiKey: apiKey,
        environment,
      },
    },
    activeProfile: 'default',
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2))
  return { configPath, tmpDir }
}

/**
 * Clean up temporary test files
 */
export async function cleanupTestConfig(tmpDir: string) {
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Capture console output
 */
export class OutputCapture {
  private originalLog: typeof console.log
  private originalError: typeof console.error
  private logs: string[] = []
  private errors: string[] = []

  constructor() {
    this.originalLog = console.log
    this.originalError = console.error
  }

  start() {
    this.logs = []
    this.errors = []

    console.log = (...args: any[]) => {
      this.logs.push(args.map((a) => String(a)).join(' '))
    }

    console.error = (...args: any[]) => {
      this.errors.push(args.map((a) => String(a)).join(' '))
    }
  }

  stop() {
    console.log = this.originalLog
    console.error = this.originalError
  }

  getLogs(): string[] {
    return this.logs
  }

  getErrors(): string[] {
    return this.errors
  }

  getOutput(): string {
    return this.logs.join('\n')
  }

  getErrorOutput(): string {
    return this.errors.join('\n')
  }
}

/**
 * Get oclif config for testing
 */
export async function getTestConfig() {
  const config = await OclifConfig.load()
  return config
}
