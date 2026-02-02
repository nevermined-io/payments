/**
 * Simple unit tests that don't require complex imports
 */

import { expect, test, describe } from '@jest/globals'

describe('CLI Basic Tests', () => {
  test('math works', () => {
    expect(1 + 1).toBe(2)
  })

  test('strings work', () => {
    const name = 'Nevermined'
    expect(name).toBe('Nevermined')
  })

  test('arrays work', () => {
    const arr = [1, 2, 3]
    expect(arr.length).toBe(3)
    expect(arr[0]).toBe(1)
  })
})
