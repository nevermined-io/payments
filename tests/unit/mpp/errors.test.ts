/**
 * Unit tests for the typed MPP error hierarchy's retryable-code grouping.
 */
import { isRetryableMppCode, MppError, MppSettlementOutcomeUnknownError } from '../../../src/mpp/errors.js'

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

describe('package barrel exports', () => {
  it('re-exports MppSettlementOutcomeUnknownError from the package root, so a caller can instanceof-check settleCredential rejections without matching on error.name strings', async () => {
    // A previous round added this class but never wired it through
    // src/mpp/index.ts, so `import { MppSettlementOutcomeUnknownError }
    // from '@nevermined-io/payments'` compiled fine locally (this test file
    // imports the class straight from errors.ts) but failed with TS2305
    // against the built package -- src/index.ts re-exports the mpp barrel
    // wholesale, so any class missing there is missing at the package root
    // too. Importing from the root barrel here, not errors.ts directly, is
    // the point: it pins the export path a real consumer uses.
    const barrel = await import('../../../src/index.js')
    expect(barrel.MppSettlementOutcomeUnknownError).toBe(MppSettlementOutcomeUnknownError)
    expect(new barrel.MppSettlementOutcomeUnknownError()).toBeInstanceOf(MppError)
  })
})
