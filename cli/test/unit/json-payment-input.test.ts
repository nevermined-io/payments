/** Offline regression: JSON payment amounts must not be rounded before SDK invocation. */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { Config } from '@oclif/core'
import type { Payments as PaymentsSDK } from '@nevermined-io/payments'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BaseCommand } from '../../src/base-command.js'
import RegisterCreditsPlan from '../../src/commands/plans/register-credits-plan.js'

jest.mock('@nevermined-io/payments')

class JsonInputCommand extends BaseCommand {
  async run(): Promise<void> {}

  parseInput(input?: string): Promise<unknown> {
    return this.parseJsonInput(input)
  }
}

const EXACT_AMOUNT = '1000000000000000001'

describe('JSON payment amount precision (offline)', () => {
  let directory: string
  let command: JsonInputCommand
  let fileIndex: number
  let exitCode: typeof process.exitCode

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'nvm-json-amounts-'))
    fileIndex = 0
    exitCode = process.exitCode
    command = new JsonInputCommand([], { bin: 'nevermined' } as Config)
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Live services are forbidden'))
  })

  afterEach(async () => {
    // Oclif sets this even when the caller catches an expected command error.
    process.exitCode = exitCode
    jest.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  })

  async function input(json: string, fromFile: boolean): Promise<string> {
    if (!fromFile) return json
    const path = join(directory, `input-${fileIndex++}.json`)
    await writeFile(path, json)
    return path
  }

  describe.each([false, true])('JSON file=%s', (fromFile) => {
    test.each([`{"amount":${EXACT_AMOUNT}}`, `{"priceConfig":{"amounts":[1,${EXACT_AMOUNT}]}}`])(
      'rejects an unsafe numeric payment amount: %s',
      async (json) => {
        await expect(command.parseInput(await input(json, fromFile))).rejects.toThrow(
          /quoted decimal string/,
        )
      },
    )

    test('converts exact decimal strings to the SDK bigint types', async () => {
      const json = `{"amount":"${EXACT_AMOUNT}","priceConfig":{"amounts":["${EXACT_AMOUNT}",0,5]},"minAmount":"1"}`
      await expect(command.parseInput(await input(json, fromFile))).resolves.toEqual({
        amount: 1000000000000000001n,
        priceConfig: { amounts: [1000000000000000001n, 0n, 5n] },
        minAmount: 1n,
      })
    })

    test('preserves safe integer boundaries and unrelated JSON values', async () => {
      const json =
        '{"amount":9007199254740991,"minAmount":0,"metadata":{"ratio":0.25,"count":3,"note":"1000000000000000001"},"isCrypto":true,"optional":null}'
      await expect(command.parseInput(await input(json, fromFile))).resolves.toEqual({
        amount: 9007199254740991n,
        minAmount: 0n,
        metadata: { ratio: 0.25, count: 3, note: EXACT_AMOUNT },
        isCrypto: true,
        optional: null,
      })
    })

    describe('real registration command to SDK boundary', () => {
      let register: jest.Mock<PaymentsSDK['plans']['registerCreditsPlan']>
      let environment: Record<string, string | undefined>

      beforeEach(() => {
        environment = {
          NVM_API_KEY: process.env.NVM_API_KEY,
          NVM_ENVIRONMENT: process.env.NVM_ENVIRONMENT,
          NVM_CONFIG: process.env.NVM_CONFIG,
        }
        process.env.NVM_API_KEY = 'offline-fixture'
        process.env.NVM_ENVIRONMENT = 'sandbox'
        process.env.NVM_CONFIG = join(directory, 'unused-config.json')
        register = jest
          .fn<PaymentsSDK['plans']['registerCreditsPlan']>()
          .mockResolvedValue({ planId: 'offline-plan' })
        const { Payments } = jest.requireMock('@nevermined-io/payments') as {
          Payments: { getInstance: jest.Mock<() => unknown> }
        }
        Payments.getInstance.mockReturnValue({ plans: { registerCreditsPlan: register } })
        jest.spyOn(console, 'error').mockImplementation(() => {})
        jest.spyOn(console, 'log').mockImplementation(() => {})
      })

      afterEach(() => {
        for (const [name, value] of Object.entries(environment)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      })

      async function run(price: string, credits: string): Promise<void> {
        await RegisterCreditsPlan.run([
          '--plan-metadata',
          '{"name":"Offline precision fixture"}',
          '--price-config',
          await input(price, fromFile),
          '--credits-config',
          await input(credits, fromFile),
          '--format',
          'json',
        ])
      }

      test.each(['price', 'credits'])('does not submit a rounded %s amount', async (field) => {
        await expect(
          run(
            `{"amounts":[${field === 'price' ? EXACT_AMOUNT : '1'}]}`,
            `{"amount":${field === 'credits' ? EXACT_AMOUNT : '1'},"durationSecs":0,"minAmount":1,"maxAmount":1}`,
          ),
        ).rejects.toThrow()
        expect(register).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(
          expect.any(String),
          expect.stringContaining('quoted decimal string'),
        )
      })

      test.each(['1.0000000000000001', '9007199254740990.5', '1e-400'])(
        'does not submit a fractional literal rounded to an integer: %s',
        async (literal) => {
          for (const field of ['price', 'credits']) {
            await expect(
              run(
                `{"amounts":[${field === 'price' ? literal : '1'}]}`,
                `{"amount":${field === 'credits' ? literal : '1'},"durationSecs":0,"minAmount":1,"maxAmount":1}`,
              ),
            ).rejects.toThrow()
          }
          expect(register).not.toHaveBeenCalled()
          expect(globalThis.fetch).not.toHaveBeenCalled()
        },
      )

      test('passes exact quoted amounts to the SDK', async () => {
        await run(
          `{"amounts":["${EXACT_AMOUNT}"],"isCrypto":true}`,
          `{"amount":"${EXACT_AMOUNT}","durationSecs":0,"minAmount":1,"maxAmount":1}`,
        )
        expect(register).toHaveBeenCalledTimes(1)
        const [metadata, price, credits] = register.mock.calls[0]
        expect(metadata).toEqual({ name: 'Offline precision fixture' })
        expect(price.amounts).toEqual([1000000000000000001n])
        expect(credits.amount).toBe(1000000000000000001n)
        expect(credits.maxAmount).toBe(1n)
        expect(globalThis.fetch).not.toHaveBeenCalled()
      })
    })
  })

  test.each(['durationSecs', 'minAmount', 'maxAmount', 'amount', 'price', 'amountOfCredits'])(
    'rejects unsafe numeric %s values',
    async (field) => {
      await expect(command.parseInput(`{"${field}":${EXACT_AMOUNT}}`)).rejects.toThrow(
        /quoted decimal string/,
      )
    },
  )

  test.each(['9007199254740992', '-9007199254740993', '1.5', '1e309'])(
    'rejects non-safe-integer payment input %s',
    async (literal) => {
      await expect(command.parseInput(`{"amount":${literal}}`)).rejects.toThrow()
    },
  )

  test('preserves absent input and malformed JSON errors', async () => {
    await expect(command.parseInput()).resolves.toBeUndefined()
    await expect(command.parseInput('{"amount":')).rejects.toThrow(/Failed to parse JSON input/)
  })

  test('accepts exactly integral decimals and scientific notation', async () => {
    await expect(
      command.parseInput('{"amount":1e3,"amounts":[1.00,10e-1,0e-400,-0.00]}'),
    ).resolves.toEqual({ amount: 1000n, amounts: [1n, 1n, 0n, 0n] })
  })

  test('checks escaped property names while preserving strings and unrelated fractions', async () => {
    await expect(command.parseInput('{"\\u0061mount":1.0000000000000001}')).rejects.toThrow(
      /quoted decimal string/,
    )
    await expect(
      command.parseInput(
        '{"metadata":{"text":"{\\\"amount\\\":1.0000000000000001}","fraction":1e-400},"amount":1}',
      ),
    ).resolves.toEqual({
      metadata: { text: '{"amount":1.0000000000000001}', fraction: 0 },
      amount: 1n,
    })
  })
})
