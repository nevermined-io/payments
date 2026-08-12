/**
 * Unit tests for the typed MPP error hierarchy's retryable-code grouping.
 */
import { isRetryableMppCode } from '../../../src/mpp/errors.js'

describe('isRetryableMppCode', () => {
  it('treats BCK.MPP.0004 (expired) as retryable', () => {
    expect(isRetryableMppCode('BCK.MPP.0004')).toBe(true)
  })

  it('treats BCK.MPP.0005 (body digest mismatch) as retryable', () => {
    // The fresh challenge on the same 402 is sealed to the digest of the
    // request that just arrived, so retrying with the same body succeeds.
    expect(isRetryableMppCode('BCK.MPP.0005')).toBe(true)
  })

  it('treats BCK.MPP.0003 (credential rejected) as terminal', () => {
    expect(isRetryableMppCode('BCK.MPP.0003')).toBe(false)
  })

  it('treats BCK.MPP.0002 (not configured) as terminal', () => {
    expect(isRetryableMppCode('BCK.MPP.0002')).toBe(false)
  })

  it('treats an unrecognised code as terminal, not retryable by default', () => {
    expect(isRetryableMppCode('network_error')).toBe(false)
    expect(isRetryableMppCode('http_500')).toBe(false)
  })

  it('treats an absent code as terminal (false), distinct from "not yet paid")', () => {
    // isRetryableMppCode only classifies a PRESENT code; the middleware only
    // calls it when code is truthy, so this is a defensive default.
    expect(isRetryableMppCode(undefined)).toBe(false)
  })
})
