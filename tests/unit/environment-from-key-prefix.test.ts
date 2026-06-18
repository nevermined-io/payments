/**
 * Unit tests for deriving the environment from the NVM API key prefix
 * (`<prefix>:<jwt>`) and the deprecation of the `environment` init option
 * (nevermined-io/payments#399, part of nvm-monorepo#2004).
 *
 * Settled mapping (inverse of the backend `addPrefixToToken`):
 *   sandbox-staging -> staging_sandbox
 *   live-staging    -> staging_live
 *   sandbox         -> sandbox
 *   live            -> live
 *   (other / none)  -> fall back to the `environment` option, else `custom`
 *
 * The key wins over the option; passing `environment` emits a single
 * deprecation warning. Each test re-imports the modules so the module-level
 * "warned once" flag starts fresh.
 */

// A decodable JWT body (carries `sub`/`o11y`) reused across keys; only the
// environment prefix differs. Mirrors the shared test fixture JWT.
const JWT =
  'eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDIxRjc5ZjlkM2I2ZDUyZUY4Y2M4QjFhN0YyNjFCY2Y1ZjJFRjM1NGEiLCJqdGkiOiIweGUxMjIwMmRkMzZlZmQ4N2FkMjE1MmRlMjlkM2MwNmE5ZDU5N2M4NWJhOGMxOTQ1YjQ5MjlkYTYyYTRiZjQ1NGYiLCJleHAiOjE3OTEwNDc0OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.JI14qfSWHCWRvHOK9TAg3HEXWX7oKEI6fU6gaaWlyDl5btBWLh8FQo1ZnuzixPmgsUR3gc4oRlenLPUuTy-mORw'

const keyWithPrefix = (prefix: string): string => `${prefix}:${JWT}`

describe('getEnvironmentFromApiKey', () => {
  let getEnvironmentFromApiKey: (key: string) => string | undefined

  beforeEach(async () => {
    jest.resetModules()
    ;({ getEnvironmentFromApiKey } = await import('../../src/environments.js'))
  })

  test.each([
    ['sandbox-staging', 'staging_sandbox'],
    ['live-staging', 'staging_live'],
    ['sandbox', 'sandbox'],
    ['live', 'live'],
  ])('maps prefix %s -> %s', (prefix, expected) => {
    expect(getEnvironmentFromApiKey(keyWithPrefix(prefix))).toBe(expected)
  })

  test('returns undefined for a key without a prefix (bare JWT)', () => {
    expect(getEnvironmentFromApiKey(JWT)).toBeUndefined()
  })

  test('returns undefined for an unrecognized prefix', () => {
    expect(getEnvironmentFromApiKey(keyWithPrefix('local'))).toBeUndefined()
  })

  test('returns undefined for an empty key', () => {
    expect(getEnvironmentFromApiKey('')).toBeUndefined()
  })
})

describe('environment resolution at Payments.getInstance', () => {
  let warnSpy: jest.SpyInstance
  let Payments: typeof import('../../src/payments.js').Payments

  beforeEach(async () => {
    jest.resetModules()
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;({ Payments } = await import('../../src/payments.js'))
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  const deprecationWarnings = (): string[] =>
    warnSpy.mock.calls.map((args) => String(args[0])).filter((msg) => msg.includes('[DEPRECATED]'))

  test('derives the environment from the key prefix when no option is passed', () => {
    const payments = Payments.getInstance({ nvmApiKey: keyWithPrefix('sandbox-staging') })
    expect(payments.getEnvironmentName()).toBe('staging_sandbox')
    expect(deprecationWarnings()).toHaveLength(0)
  })

  test('key prefix wins over a conflicting environment option', () => {
    const payments = Payments.getInstance({
      nvmApiKey: keyWithPrefix('live'),
      environment: 'staging_sandbox',
    })
    expect(payments.getEnvironmentName()).toBe('live')
  })

  test('passing environment emits a single deprecation warning', () => {
    Payments.getInstance({
      nvmApiKey: keyWithPrefix('sandbox-staging'),
      environment: 'staging_sandbox',
    })
    // getInstance constructs several sub-API instances from the same options,
    // but the warning must fire at most once per process.
    expect(deprecationWarnings()).toHaveLength(1)
    expect(deprecationWarnings()[0]).toMatch(/environment.*derived.*API key/i)
  })

  test('falls back to the environment option for an unrecognized key prefix', () => {
    const payments = Payments.getInstance({
      nvmApiKey: keyWithPrefix('local'),
      environment: 'custom',
    })
    expect(payments.getEnvironmentName()).toBe('custom')
    // The option was used (fallback), so the deprecation warning still fires.
    expect(deprecationWarnings()).toHaveLength(1)
  })

  test('falls back to custom when neither key prefix nor option resolves', () => {
    const payments = Payments.getInstance({ nvmApiKey: keyWithPrefix('local') })
    expect(payments.getEnvironmentName()).toBe('custom')
    expect(deprecationWarnings()).toHaveLength(0)
  })
})
