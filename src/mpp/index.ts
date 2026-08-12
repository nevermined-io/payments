/**
 * Machine Payments Protocol (MPP) module.
 */

export { MppAPI } from './mpp-api.js'
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
} from './errors.js'
// `mppFetch` and `MppTokenMinter` are deliberately NOT re-exported here.
// `payments.mpp.fetch` (via `MppAPI`, exported above) is the intended public
// surface — it routes through `MppAPI.post`'s error translation and the
// `Nevermined-Version` pinning. Exporting the free function would hand
// consumers a supported way to bypass both, which could not be withdrawn
// later without a major bump. Tests import `./fetch.js` directly.
export type { MppFetchOptions, MppFetchResult } from './fetch.js'
