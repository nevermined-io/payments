/**
 * Integration tests for CLI commands
 * These tests run the actual CLI binary
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

describe('CLI Integration Tests', () => {
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

  describe('Version and Help', () => {
    test('should display version', () => {
      const { stdout, exitCode } = runCLI(['--version'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('@nevermined-io/cli')
      expect(stdout).toContain('1.0.2')
    })

    test('should display help', () => {
      const { stdout, exitCode } = runCLI(['--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('CLI for Nevermined Payments SDK')
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('TOPICS')
    })
  })

  describe('Config Commands', () => {
    test('config help should work', () => {
      const { stdout, stderr } = runCLI(['config', '--help'])

      const output = stdout + stderr
      expect(output).toContain('config init')
      expect(output).toContain('config show')
      expect(output).toContain('config set')
    })

    test('config init help should work', () => {
      const { stdout, stderr } = runCLI(['config', 'init', '--help'])

      const output = stdout + stderr
      expect(output).toContain('Initialize CLI configuration')
      expect(output).toContain('--api-key')
      expect(output).toContain('--environment')
    })
  })

  describe('Plans Commands', () => {
    test('plans help should work', () => {
      const { stdout, stderr } = runCLI(['plans', '--help'])

      const output = stdout + stderr
      expect(output).toContain('plans list')
      expect(output).toContain('plans get')
      expect(output).toContain('plans balance')
    })

    test('plans list help should work', () => {
      const { stdout, stderr } = runCLI(['plans', 'list', '--help'])

      const output = stdout + stderr
      expect(output).toContain('List all payment plans')
      expect(output).toContain('--format')
    })

    test('plans get help should work', () => {
      const { stdout, stderr } = runCLI(['plans', 'get', '--help'])

      const output = stdout + stderr
      expect(output).toContain('Get details of a specific payment plan')
      expect(output).toContain('ARGUMENTS')
      expect(output).toContain('planId')
    })

    test('plans balance help should work', () => {
      const { stdout, stderr } = runCLI(['plans', 'balance', '--help'])

      const output = stdout + stderr
      expect(output).toContain('Get balance information')
      expect(output).toContain('--account')
    })
  })

  describe('Agents Commands', () => {
    test('agents help should work', () => {
      const { stdout, stderr } = runCLI(['agents', '--help'])

      const output = stdout + stderr
      expect(output).toContain('agents get')
      expect(output).toContain('agents list')
    })

    test('agents get help should work', () => {
      const { stdout, stderr } = runCLI(['agents', 'get', '--help'])

      const output = stdout + stderr
      expect(output).toContain('Get details of a specific AI agent')
      expect(output).toContain('agentId')
    })
  })

  describe('X402 Commands', () => {
    test('x402 help should work', () => {
      const { stdout, stderr } = runCLI(['x402', '--help'])

      const output = stdout + stderr
      expect(output).toContain('X402 protocol operations')
      expect(output).toContain('x402 get-token')
    })

    test('x402 get-token help should work', () => {
      const { stdout, stderr } = runCLI(['x402', 'get-token', '--help'])

      const output = stdout + stderr
      expect(output).toContain('Get an X402 access token')
      expect(output).toContain('planId')
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

  describe('Output Formats', () => {
    test('should accept format flag', () => {
      const { stdout, stderr } = runCLI(['plans', 'list', '--help'])

      const output = stdout + stderr
      expect(output).toContain('--format')
    })

    test('should accept profile flag', () => {
      const { stdout, stderr } = runCLI(['config', 'show', '--help'])

      const output = stdout + stderr
      expect(output).toContain('--profile')
    })

    test('should accept verbose flag', () => {
      const { stdout, stderr } = runCLI(['config', 'show', '--help'])

      const output = stdout + stderr
      expect(output).toContain('--verbose')
    })
  })
})
