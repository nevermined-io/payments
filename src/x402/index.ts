/**
 * X402 API module for token generation and facilitator operations.
 */

export { X402TokenAPI } from './token.js'
export {
  FacilitatorAPI,
  buildPaymentRequired,
  resolveNetwork,
  resolveScheme,
} from './facilitator-api.js'
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

// Delegation exports
export { DelegationAPI } from './delegation-api.js'
export type {
  CardProvider,
  DelegationProvider,
  PaymentMethodSummary,
  UpdatePaymentMethodDto,
  DelegationSummary,
  DelegationListResponse,
  PurchasingPower,
  ListOptions,
} from './delegation-api.js'

// Scheme and delegation types
export type {
  X402SchemeType,
  DelegationConfig,
  CreateDelegationPayload,
  CreateDelegationResponse,
  X402TokenOptions,
} from '../common/types.js'
export { X402_SCHEME_NETWORKS, getDefaultNetwork, isValidScheme } from '../common/types.js'
