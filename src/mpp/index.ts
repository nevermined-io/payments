/**
 * Machine Payments Protocol (MPP) module.
 */

export { MppAPI, normalizeCredits } from './mpp-api.js'
export type { IssueMppChallengeParams, RedeemMppParams, MppSettleResult } from './mpp-api.js'
export {
  parseChallengeHeader,
  buildCredentialHeader,
  parseReceiptHeader,
  extractPaymentScheme,
} from './codec.js'
export type { MppChallenge, MppChallengeRequest, MppReceipt } from './types.js'
export {
  MppError,
  MppNotConfiguredError,
  MppCredentialRejectedError,
  MppChallengeExpiredError,
  MppBodyDigestMismatchError,
  MppSettlementOutcomeUnknownError,
  // The docstring on isRetryableMppCode exists to stop a buyer hardcoding
  // ['BCK.MPP.0004','BCK.MPP.0005'] at their call site, where it goes stale
  // the moment a code joins the set — so the function has to be reachable
  // from the package, not just from inside it. The wire-level `retryable`
  // flag the middleware puts on its 402s only helps buyers of THIS
  // middleware; a buyer calling payments.mpp.* directly and catching
  // MppError has nothing but `error.code`.
  isRetryableMppCode,
  MPP_SETTLEMENT_OUTCOME_UNKNOWN_CODE,
} from './errors.js'
export type { MppSettlementOutcomeUnknown } from './errors.js'
// `mppFetch` and `MppTokenMinter` are deliberately NOT re-exported here.
// `payments.mpp.fetch` (via `MppAPI`, exported above) is the intended public
// surface — it routes through `MppAPI.post`'s error translation and the
// `Nevermined-Version` pinning. Exporting the free function would hand
// consumers a supported way to bypass both, which could not be withdrawn
// later without a major bump. Tests import `./fetch.js` directly.
export type { MppFetchOptions, MppFetchResult } from './fetch.js'
