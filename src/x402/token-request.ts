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
  /**
   * Which mint this body is for. MPP has no token version at all — it is not
   * "x402 v2 by another name": the two protocols stopped sharing a version
   * ladder (nvm-monorepo#3266), and `MppService.createPermission` refuses ANY
   * `tokenVersion` with `BCK.MPP.0007`, `2` included. Sending one would 400 the
   * mint, so this builder refuses it here, where the caller can be told why.
   */
  protocol?: 'x402' | 'mpp'
}): Record<string, any> {
  const { planId, agentId, tokenOptions, environmentName, protocol = 'x402' } = params
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
  // token minted for one seller endpoint cannot be presented to another.
  //
  // On a v1/v2 token they are outside the signature — but NOT inert. The
  // backend compares a token's `resource.url` against the seller's
  // `paymentRequired.resource.url` (origin + path, exact string when it cannot
  // parse either as a URL) for ANY token that carries one, so a v2 token bound
  // to a URL the seller does not advertise verbatim fails verification with
  // `BCK.X402.0013`. Measured against staging, not inferred.
  //
  // They are still forwarded when the caller supplies them — this is the
  // low-level builder, and a caller that names a resource means it (binding a
  // v2 token to the URL the seller really advertises is valid, and once the
  // backend default flips to v3 the binding is needed without anyone asking for
  // a version). What the builder will not do is let that happen silently: see
  // the warning below.
  //
  // Omitted rather than sent empty when the caller did not supply them: a field
  // absent at mint is signed as the empty string AND must stay absent from the
  // unsigned envelope, so sending `{ url: '' }` and sending nothing must not
  // diverge — which is why the guard below tests `resource?.url`, not the
  // object.
  const { resource, tokenVersion } = tokenOptions
  // Normalized here, once, rather than in each consumer: sellers advertise
  // `req.method`, i.e. upper case, and `httpVerb: 'post'` mints a token that
  // can never match. Both in-tree consumers already upper-cased it themselves;
  // a direct SDK caller had no such defence.
  const httpVerb = tokenOptions.httpVerb?.toUpperCase()
  const boundUrl = resource?.url

  // A binding on a token that is not v3 is legal but rarely intended, and its
  // failure mode (verify rejecting with BCK.X402.0013 at the seller) points
  // nowhere near this call. Say so once, here, where the cause is visible.
  //
  // MPP gets the same warning for the same reason: the MPP mint accepts
  // `resource`/`httpVerb` (its DTO is `OmitType(GenerateX402TokenDto,
  // ['tokenVersion'])`, so only the version is refused) and forwards them into
  // the same comparison — but MPP has no v3 to opt into, so a binding there is
  // never signed and can only narrow what the credential verifies against.
  if (boundUrl || httpVerb) {
    if (protocol === 'mpp') {
      console.warn(
        '[mpp] resource/httpVerb were supplied on an MPP mint. MPP tokens carry no version and ' +
          'nothing is signed over them, but the backend still compares the resource against what ' +
          'the seller advertises — a mismatch fails the credential. Omit them unless the string ' +
          'matches the seller exactly.',
      )
    } else if (tokenVersion !== 3) {
      console.warn(
        '[x402] resource/httpVerb were supplied without tokenVersion: 3. They are NOT inert on a ' +
          'v2 token: the backend compares the token resource against the URL the seller advertises ' +
          "in its paymentRequired, and a mismatch fails verification with BCK.X402.0013. Pass " +
          'tokenVersion: 3 for a seller-bound token, or omit resource/httpVerb, or make sure the ' +
          'string matches what the seller advertises exactly.',
      )
    }
  }

  // MPP's single-use unit is the CHALLENGE, not the token: one MPP access token
  // is presented across many challenges by design, so the x402 v3 per-token
  // nonce would kill every buyer's second challenge. The backend enforces this
  // by refusing the field outright; refuse it here too rather than let the
  // caller discover it as a 400 whose cause is a field they set two layers up.
  if (protocol === 'mpp' && tokenVersion !== undefined) {
    throw PaymentsError.validation(
      'tokenVersion is not supported on MPP access tokens: MPP and x402 no longer share a ' +
        'token version ladder, and the backend refuses any tokenVersion on an MPP mint ' +
        '(BCK.MPP.0007). Omit the field — an MPP token is reusable across challenges, and the ' +
        'challenge is what is single-use.',
    )
  }

  // Build x402-aligned request body
  return {
    ...(boundUrl && { resource }),
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
    // Opt-in only, and x402-only (the MPP guard above has already thrown).
    // Left out entirely when unset so a v2 mint stays byte-identical to what it
    // was before v3 existed. A backend that predates the v3 struct drops this
    // field silently (ValidationPipe whitelists without forbidNonWhitelisted)
    // and returns v2 — which is why no caller may infer the version from what
    // it asked for. See detectAccessTokenVersion().
    //
    // `tokenVersion: 3` WITHOUT a resource is deliberately allowed, not an
    // oversight: the backend signs an absent binding member as the empty
    // string, so the result is a single-use token bound to nothing. That is a
    // supported mode — single-use without seller binding — and the only one
    // available when the caller does not know the seller's advertised URL.
    ...(tokenVersion !== undefined && { tokenVersion }),
  }
}
