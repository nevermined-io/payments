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

  // `resource` and `httpVerb` are what a v3 token is bound to: they go inside
  // the EIP-712 signature next to `agentId` and the one-time nonce, so a v3
  // token minted for one seller endpoint cannot be presented to another. They
  // are inert for v1/v2 (whose signature covers `[from, sessionKeysProvider,
  // sessionKeys, planId]` only) but still worth sending — without `resource.url`
  // the backend logs `resource.url not provided in token … skipping endpoint
  // validation` and has nothing to bind to.
  //
  // Omitted rather than sent empty when the caller did not supply them: a field
  // absent at mint is signed as the empty string AND must stay absent from the
  // unsigned envelope, so sending `{ url: '' }` and sending nothing must not
  // diverge.
  const { resource, httpVerb, tokenVersion } = tokenOptions

  // Build x402-aligned request body
  return {
    ...(resource && { resource }),
    accepted: {
      scheme,
      network,
      planId,
      extra: {
        ...(agentId && { agentId }),
        ...(httpVerb && { httpVerb }),
      },
    },
    // Add delegation config for both erc4337 and card-delegation schemes.
    // delegationConfig is guaranteed present here (the absence check above throws).
    delegationConfig: tokenOptions.delegationConfig,
    // Opt-in only. Left out entirely when unset so a v2 mint stays byte-identical
    // to what it was before v3 existed. A backend that predates the v3 struct
    // drops this field silently (ValidationPipe whitelists without
    // forbidNonWhitelisted) and returns v2 — which is why no caller may infer
    // the version from what it asked for. See detectAccessTokenVersion().
    ...(tokenVersion !== undefined && { tokenVersion }),
  }
}
