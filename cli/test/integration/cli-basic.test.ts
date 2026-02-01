/**
 * Basic integration tests for CLI
 * Tests core functionality that works reliably
 */

import { expect, test, describe, beforeAll } from '@jest/globals'
import { execSync } from 'child_process'
import { join } from 'path'

const CLI_PATH = join(__dirname, '../../bin/run.js')

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
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

describe('CLI Basic Integration Tests', () => {
  beforeAll(() => {
    // Ensure CLI is built
    try {
      execSync('yarn build', {
        cwd: join(__dirname, '../..'),
        stdio: 'ignore',
      })
    } catch {
      // Build already done
    }
  })

  describe('Core Functionality', () => {
    test('should display version', () => {
      const { stdout, exitCode } = runCLI(['--version'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('@nevermined-io/payments-cli')
      // Version should be in format x.y.z or x.y.z-rcN
      expect(stdout).toMatch(/\d+\.\d+\.\d+(-rc\d+)?/)
    })

    test('should display main help', () => {
      const { stdout, exitCode } = runCLI(['--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('CLI for Nevermined Payments SDK')
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('TOPICS')
      expect(stdout).toContain('config')
      expect(stdout).toContain('plans')
      expect(stdout).toContain('agents')
      expect(stdout).toContain('x402')
    })
  })

  describe('Error Handling', () => {
    test('should show error for unknown command', () => {
      const { stderr, exitCode } = runCLI(['unknown-command'])

      expect(exitCode).not.toBe(0)
      expect(stderr).toBeTruthy()
    })

    test('should show error for invalid flag', () => {
      const { exitCode } = runCLI(['--invalid-flag'])

      expect(exitCode).not.toBe(0)
    })
  })

  describe('Command Help (Integration)', () => {
    test('config commands exist', () => {
      const { stdout } = runCLI(['--help'])

      expect(stdout).toContain('config')
    })

    test('plans commands exist', () => {
      const { stdout } = runCLI(['--help'])

      expect(stdout).toContain('plans')
    })

    test('agents commands exist', () => {
      const { stdout } = runCLI(['--help'])

      expect(stdout).toContain('agents')
    })

    test('x402 commands exist', () => {
      const { stdout } = runCLI(['--help'])

      expect(stdout).toContain('x402')
    })
  })
})
