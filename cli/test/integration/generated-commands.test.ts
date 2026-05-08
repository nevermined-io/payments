/**
 * Integration tests for auto-generated commands
 * Tests generated commands work correctly with proper help and error handling
 */

import { execSync } from 'child_process'
import { join } from 'path'

const CLI_PATH = join(__dirname, '../../bin/run.js')

function runCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  // Strip NODE_ENV=test from the child env: oclif treats that as development
  // mode and scans src/ instead of dist/, which breaks command resolution for
  // commands with positional args (oclif misinterprets the arg as a subcommand).
  const childEnv = { ...process.env }
  delete childEnv.NODE_ENV
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv,
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
      expect(stdout).toContain('agentMetadata as JSON string')
      expect(stdout).toContain('agentApi as JSON string')
    })

    test('agents register-agent-and-plan documents agent-api as JSON', () => {
      const { stdout, exitCode } = runCLI(['agents', 'register-agent-and-plan', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('agentApi as JSON string')
    })

    test('agents update-agent-metadata documents agent-api as JSON', () => {
      const { stdout, exitCode } = runCLI(['agents', 'update-agent-metadata', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('agentApi as JSON string')
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

    test('x402token build-payment-required shows help', () => {
      const { stdout, exitCode } = runCLI(['x402token', 'build-payment-required', '--help'])

      expect(exitCode).toBe(0)
      expect(stdout).toContain('USAGE')
      expect(stdout).toContain('build-payment-required')
      expect(stdout).toContain('plan identifier')
      expect(stdout).toContain('--resource-url')
      expect(stdout).toContain('--scheme')
    })

    test('x402token build-payment-required emits valid X402PaymentRequired JSON', () => {
      const { stdout, exitCode } = runCLI([
        'x402token',
        'build-payment-required',
        '12345',
        '--resource-url',
        'https://example.com/api/test',
        '--agent-id',
        '999',
        '--http-verb',
        'POST',
        '--description',
        'TestResource',
        '--mime-type',
        'application/json',
        '--environment',
        'sandbox',
        '-f',
        'json',
      ])

      expect(exitCode).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.x402Version).toBe(2)
      expect(payload.resource).toEqual({
        url: 'https://example.com/api/test',
        description: 'TestResource',
        mimeType: 'application/json',
      })
      expect(payload.extensions).toEqual({})
      expect(Array.isArray(payload.accepts)).toBe(true)
      expect(payload.accepts).toHaveLength(1)
      expect(payload.accepts[0]).toEqual({
        scheme: 'nvm:erc4337',
        network: 'eip155:84532',
        planId: '12345',
        extra: {
          version: '1',
          agentId: '999',
          httpVerb: 'POST',
        },
      })
    })

    test('x402token build-payment-required resolves live network from --environment', () => {
      const { stdout, exitCode } = runCLI([
        'x402token',
        'build-payment-required',
        '12345',
        '--resource-url',
        'https://example.com/api/test',
        '--environment',
        'live',
        '-f',
        'json',
      ])

      expect(exitCode).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.resource.url).toBe('https://example.com/api/test')
      expect(payload.accepts[0].network).toBe('eip155:8453')
    })

    test('x402token build-payment-required uses card-delegation defaults', () => {
      const { stdout, exitCode } = runCLI([
        'x402token',
        'build-payment-required',
        '12345',
        '--resource-url',
        'https://example.com/api/test',
        '--scheme',
        'nvm:card-delegation',
        '-f',
        'json',
      ])

      expect(exitCode).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.resource.url).toBe('https://example.com/api/test')
      expect(payload.accepts[0].scheme).toBe('nvm:card-delegation')
      expect(payload.accepts[0].network).toBe('stripe')
    })

    test('x402token build-payment-required requires plan argument', () => {
      const { stderr, exitCode } = runCLI(['x402token', 'build-payment-required'])

      expect(exitCode).not.toBe(0)
      expect(stderr.length).toBeGreaterThan(0)
    })

    test('x402token build-payment-required requires --resource-url', () => {
      const { stderr, exitCode } = runCLI(['x402token', 'build-payment-required', '12345'])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('resource-url')
    })

    test('x402token build-payment-required rejects unknown --environment', () => {
      const { stderr, exitCode } = runCLI([
        'x402token',
        'build-payment-required',
        '12345',
        '--resource-url',
        'https://example.com/api/test',
        '--environment',
        'mainnet',
      ])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain('environment')
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
