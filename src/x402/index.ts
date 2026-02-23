/**
 * X402 API module for token generation and facilitator operations.
 */

export { X402TokenAPI } from './token.js'
export { FacilitatorAPI, buildPaymentRequired, resolveScheme } from './facilitator-api.js'
export type {
  // x402 types
  X402Resource,
  X402SchemeExtra,
  X402Scheme,
  X402PaymentRequired,
  X402PaymentAccepted,
  // Facilitator params and results
  VerifyPermissionsParams,
  VerifyPermissionsResult,
  SettlePermissionsParams,
  SettlePermissionsResult,
} from './facilitator-api.js'

// Card delegation exports
export { DelegationAPI } from './delegation-api.js'
export type { PaymentMethodSummary } from './delegation-api.js'

// Scheme types
export type { X402SchemeType, CardDelegationConfig, X402TokenOptions } from '../common/types.js'
export { X402_SCHEME_NETWORKS, isValidScheme } from '../common/types.js'

// Visa x402 exports
export { VisaFacilitatorAPI, buildVisaPaymentRequired, VISA_X402_HEADERS } from './visa-facilitator-api.js'
export type {
  VisaPaymentExtra,
  VisaPaymentRequirements,
  VisaPaymentRequired,
  VisaVerifyResponse,
  VisaSettlementResponse,
} from './visa-facilitator-api.js'
export { VisaTokenAPI } from './visa-token-api.js'
export type { VisaPaymentPayloadResponse } from './visa-token-api.js'
