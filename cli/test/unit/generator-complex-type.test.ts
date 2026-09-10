/**
 * Unit tests for CommandGenerator.isComplexType — the check that decides whether
 * an SDK method parameter is an options/DTO object (skipped for optional params,
 * or JSON-string flag otherwise) versus a plain scalar flag.
 *
 * Regression for nevermined-io/payments#431: a generic-wrapped options type such
 * as `Partial<PaginationOptions>` must still be recognized as complex. Before the
 * fix the trailing `>` defeated the `Options$` suffix match, so the param leaked
 * out as a raw `Flags.string` that was silently ignored at runtime.
 */
import { expect, test, describe } from '@jest/globals'
import { CommandGenerator } from '../../src/generator/command-generator.js'

// isComplexType is private; exercise it directly (its output drives whether a
// broken flag is emitted).
const isComplexType = (type: string): boolean =>
  (new CommandGenerator('/tmp/unused') as unknown as { isComplexType(t: string): boolean }).isComplexType(
    type,
  )

describe('CommandGenerator.isComplexType', () => {
  test.each([
    'PaginationOptions',
    'Partial<PaginationOptions>',
    'Partial<PaginationOptions> | undefined',
    'FooConfig',
    'Readonly<BarMetadata>',
    'object',
    '{ page: number; offset: number }',
  ])('treats %s as a complex type', (type) => {
    expect(isComplexType(type)).toBe(true)
  })

  test.each(['string', 'number', 'boolean', 'string | undefined', '`0x${string}`'])(
    'treats %s as a scalar type',
    (type) => {
      expect(isComplexType(type)).toBe(false)
    },
  )
})
