/**
 * Unit tests for the typed MPP error hierarchy's retryable-code grouping.
 */
import {
  isRetryableMppCode,
  MppError,
  MppSettlementOutcomeUnknownError,
  MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE,
} from '../../../src/mpp/errors.js'

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

describe('MppSettlementOutcomeUnknownError.code', () => {
  it('carries a stable synthetic code, so the branch is discriminable without instanceof', () => {
    // `instanceof` is not enough on a published package: two copies of
    // @nevermined-io/payments in one dependency tree (or a process /
    // serialization boundary) make it false for a genuinely-MPP error, and
    // the check degrades SILENTLY to the "nothing was burned" path that the
    // integration guide tells sellers to rely on. `code` is the only
    // data-level discriminant this hierarchy has.
    const error = new MppSettlementOutcomeUnknownError()
    expect(error.code).toBe(MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE)
    expect(error.code).toBe('settlement_outcome_unknown')
  })

  it('cannot be mistaken for a backend code', () => {
    // Follows the SDK-invented convention (network_error, http_<status>),
    // deliberately outside the BCK.MPP.* namespace the backend owns.
    expect(MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE.startsWith('BCK.')).toBe(false)
    expect(isRetryableMppCode(MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE)).toBe(false)
  })
})

describe('buyer-facing helpers reachable from the package root', () => {
  it('exports isRetryableMppCode and normalizeCredits', async () => {
    // isRetryableMppCode's own docstring exists to stop a buyer hardcoding
    // ['BCK.MPP.0004','BCK.MPP.0005'] -- which is exactly what they had to
    // do while the function was unreachable from the package. normalizeCredits
    // is the only validator for the amount contract, and a seller pre-checking
    // a `credits` function result before it is sealed into a challenge needs
    // the same rules the middleware applies.
    const barrel = await import('../../../src/index.js')
    expect(typeof barrel.isRetryableMppCode).toBe('function')
    expect(barrel.isRetryableMppCode('BCK.MPP.0004')).toBe(true)
    expect(typeof barrel.normalizeCredits).toBe('function')
    expect(barrel.normalizeCredits(10n)).toBe('10')
  })
})
