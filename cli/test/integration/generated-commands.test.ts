/**
 * Integration tests for auto-generated commands
 * Tests generated commands work correctly with proper help and error handling
 */

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

describe('Generated Commands Integration Tests', () => {
  describe('Plans Commands', () => {
    test('plans get-plan shows help correctly', () => {
      const { stdout, exitCode } = runCLI(['plans', 'get-plan', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('get-plan')
      expect(stdout).toContain('plan identifier')
    })

    test('plans get-plan requires plan argument', () => {
      const { stderr, exitCode } = runCLI(['plans', 'get-plan'])

      expect(exitCode).not.toBe(0)
      expect(stderr.length).toBeGreaterThan(0)
    })

    test('plans get-plan-balance shows help with optional flag', () => {
      const { stdout, exitCode } = runCLI(['plans', 'get-plan-balance', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('account-address')
      expect(stdout).toContain('plan identifier')
    })

    test('plans register-credits-plan shows required flags', () => {
      const { stdout, exitCode } = runCLI(['plans', 'register-credits-plan', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('plan-metadata')
      expect(stdout).toContain('price-config')
      expect(stdout).toContain('credits-config')
      expect(stdout).toContain('required')
    })
  })

  describe('Agents Commands', () => {
    test('agents get-agent shows help correctly', () => {
      const { stdout, exitCode } = runCLI(['agents', 'get-agent', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('get-agent')
      expect(stdout).toContain('agent identifier')
    })

    test('agents register-agent shows complex type flags', () => {
      const { stdout, exitCode } = runCLI(['agents', 'register-agent', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('agent-metadata')
      expect(stdout).toContain('agent-api')
      expect(stdout).toContain('payment-plans')
      expect(stdout).toContain('JSON string')
    })

    test('agents register-agent requires all flags', () => {
      const { stderr, exitCode } = runCLI(['agents', 'register-agent'])

      expect(exitCode).not.toBe(0)
      expect(stderr.length).toBeGreaterThan(0)
    })
  })

  describe('X402Token Commands', () => {
    test('x402token get-x402-access-token shows help', () => {
      const { stdout, exitCode } = runCLI(['x402token', 'get-x402-access-token', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('x402')
    })
  })

  describe('Facilitator Commands', () => {
    test('facilitator verify-permissions shows help', () => {
      const { stdout, exitCode } = runCLI(['facilitator', 'verify-permissions', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('verify-permissions')
    })

    test('facilitator settle-permissions shows help', () => {
      const { stdout, exitCode } = runCLI(['facilitator', 'settle-permissions', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('settle-permissions')
    })
  })

  describe('Organizations Commands', () => {
    test('organizations create-member shows help', () => {
      const { stdout, exitCode } = runCLI(['organizations', 'create-member', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('create-member')
    })

    test('organizations get-members shows help', () => {
      const { stdout, exitCode } = runCLI(['organizations', 'get-members', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('get-members')
    })
  })

  describe('Output Format Flags', () => {
    test('commands accept format flag', () => {
      const { stdout, exitCode } = runCLI(['plans', 'get-plan', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('--format')
      expect(stdout).toContain('table')
      expect(stdout).toContain('json')
      expect(stdout).toContain('quiet')
    })

    test('commands accept profile flag', () => {
      const { stdout, exitCode } = runCLI(['agents', 'get-agent', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('--profile')
      expect(stdout).toContain('Configuration profile')
    })

    test('commands accept verbose flag', () => {
      const { stdout, exitCode } = runCLI(['x402token', 'get-x402-access-token', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('--verbose')
      expect(stdout).toContain('Verbose output')
    })
  })

  describe('Command Discovery', () => {
    test('all plans commands are discoverable', () => {
      const { stdout, exitCode } = runCLI(['plans', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('get-plan')
      expect(stdout).toContain('register-plan')
      expect(stdout).toContain('order-plan')
    })

    test('all agents commands are discoverable', () => {
      const { stdout, exitCode } = runCLI(['agents', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('get-agent')
      expect(stdout).toContain('register-agent')
    })

    test('x402token commands are discoverable', () => {
      const { stdout, exitCode } = runCLI(['x402token', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('get-x402-access-token')
    })
  })
})
