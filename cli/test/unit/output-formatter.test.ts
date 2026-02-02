/**
 * Unit tests for OutputFormatter
 */

import { expect, test, describe, beforeEach, afterEach } from '@jest/globals'
import { OutputFormatter } from '../../src/utils/output-formatter.js'
import { OutputCapture } from '../helpers/test-utils.js'

describe('OutputFormatter', () => {
  let output: OutputCapture

  beforeEach(() => {
    output = new OutputCapture()
    output.start()
  })

  afterEach(() => {
    output.stop()
  })

  describe('JSON format', () => {
    test('should output JSON', () => {
      const formatter = new OutputFormatter('json')
      const data = { foo: 'bar', baz: 123 }

      formatter.output(data)

      const logs = output.getOutput()
      expect(logs).toContain('"foo"')
      expect(logs).toContain('"bar"')
      expect(logs).toContain('123')

      const parsed = JSON.parse(logs)
      expect(parsed).toEqual(data)
    })

    test('should output array as JSON', () => {
      const formatter = new OutputFormatter('json')
      const data = [{ id: 1 }, { id: 2 }]

      formatter.output(data)

      const logs = output.getOutput()
      const parsed = JSON.parse(logs)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed.length).toBe(2)
    })
  })

  describe('Quiet format', () => {
    test('should output nothing in quiet mode', () => {
      const formatter = new OutputFormatter('quiet')

      formatter.output({ foo: 'bar' })
      formatter.success('Success')
      formatter.warning('Warning')
      formatter.info('Info')

      const logs = output.getOutput()
      expect(logs).toBe('')
    })

    test('should not output errors in quiet mode', () => {
      const formatter = new OutputFormatter('quiet')

      formatter.error('Error message')

      const logs = output.getOutput()
      const errors = output.getErrorOutput()
      expect(logs).toBe('')
      expect(errors).toBe('')
    })
  })

  describe('Table format', () => {
    test('should output table for array data', () => {
      const formatter = new OutputFormatter('table')
      const data = [
        { name: 'Item 1', value: 10 },
        { name: 'Item 2', value: 20 },
      ]

      formatter.output(data, {
        columns: [
          { header: 'Name', key: 'name' },
          { header: 'Value', key: 'value' },
        ],
      })

      const logs = output.getOutput()
      expect(logs).toContain('Name')
      expect(logs).toContain('Value')
      expect(logs).toContain('Item 1')
      expect(logs).toContain('Item 2')
    })

    test('should handle empty array', () => {
      const formatter = new OutputFormatter('table')

      formatter.output([], {
        columns: [{ header: 'Name', key: 'name' }],
      })

      const logs = output.getOutput()
      expect(logs).toContain('No data found')
    })
  })

  describe('Status messages', () => {
    test('should output success message', () => {
      const formatter = new OutputFormatter('table')

      formatter.success('Operation successful')

      const logs = output.getOutput()
      expect(logs).toContain('Operation successful')
    })

    test('should output warning message', () => {
      const formatter = new OutputFormatter('table')

      formatter.warning('Warning message')

      const logs = output.getOutput()
      expect(logs).toContain('Warning message')
    })

    test('should output info message', () => {
      const formatter = new OutputFormatter('table')

      formatter.info('Info message')

      const logs = output.getOutput()
      expect(logs).toContain('Info message')
    })

    test('should output error message', () => {
      const formatter = new OutputFormatter('table')

      formatter.error('Error message')

      const errors = output.getErrorOutput()
      expect(errors).toContain('Error message')
    })
  })
})
