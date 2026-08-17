/**
 * The access-token request body, shared by the x402 and MPP mints.
 *
 * Both routes take identical inputs — only the EIP-712 domain the backend signs
 * under differs — so the body is built in one place to keep them from drifting.
 */

import { PaymentsError } from '../common/payments.error.js'
import { X402TokenOptions, getDefaultNetwork } from '../common/types.js'
import type { EnvironmentName } from '../environments.js'

export function buildX402TokenRequestBody(params: {
  planId: string
  agentId?: string
  tokenOptions?: X402TokenOptions
  environmentName: EnvironmentName
}): Record<string, any> {
  const { planId, agentId, tokenOptions, environmentName } = params
  const scheme = tokenOptions?.scheme ?? 'nvm:erc4337'
  const network = tokenOptions?.network ?? getDefaultNetwork(scheme, environmentName)

  // Validate delegationConfig is provided — the backend requires it for token generation
  if (!tokenOptions?.delegationConfig) {
    throw PaymentsError.validation(
      `delegationConfig is required for ${scheme} token generation. ` +
        'Create a delegation first with payments.delegation.createDelegation(), ' +
        'then request the token with delegationConfig.delegationId.',
    )
  }

  // Deprecation: the supported flow is create-first — create the delegation
  // with createDelegation(), then request the token with { delegationId }.
  // A delegationConfig that carries an inline-create signal instead of a
  // delegationId triggers inline create-on-the-fly, which the backend has
  // deprecated (auto-select and providerPaymentMethodId/cardId creation).
  // Warn once per call; the { delegationId } (± apiKeyId) path is silent.
  // Predicate mirrors the Python SDK (payments-py#224): no delegationId AND
  // at least one creation field present — a bare/invalid config is left to
  // fail downstream rather than warned.
  const { delegationId, cardId, providerPaymentMethodId, spendingLimitCents, durationSecs } =
    tokenOptions.delegationConfig
  // Reject an explicit empty/blank delegationId early — it is neither a valid
  // reuse id nor an inline-create signal, and forwarding `delegationId: ''`
  // would 4xx at the backend. (Symmetric with the Python SDK, payments-py#225.)
  if (delegationId !== undefined && delegationId.trim() === '') {
    throw PaymentsError.validation(
      'delegationConfig.delegationId must not be an empty string. ' +
        'Pass a valid delegation UUID or omit the field.',
    )
  }
  const isInlineCreate =
    !delegationId &&
    (cardId !== undefined ||
      providerPaymentMethodId !== undefined ||
      spendingLimitCents !== undefined ||
      durationSecs !== undefined)
  if (isInlineCreate) {
    // Neutral wording: this body builder is shared by getX402AccessToken and
    // the MPP mint (payments.mpp.fetch / getMppAccessToken), so the message
    // must not name one caller specifically — an MPP buyer grepping for
    // "getX402AccessToken" after seeing this warning would find nothing.
    console.warn(
      '[DEPRECATED] delegationConfig: inline create-on-the-fly delegationConfig ' +
        '(no delegationId) is deprecated and will be removed in a future release. ' +
        'Create the delegation first with payments.delegation.createDelegation(), ' +
        'then request the token with delegationConfig: { delegationId }.',
    )
  }

  // Build x402-aligned request body
  return {
    accepted: {
      scheme,
      network,
      planId,
      extra: {
        ...(agentId && { agentId }),
      },
    },
    // Add delegation config for both erc4337 and card-delegation schemes.
    // delegationConfig is guaranteed present here (the absence check above throws).
    delegationConfig: tokenOptions.delegationConfig,
  }
}
