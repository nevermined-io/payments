/**
 * Pure functions to generate OAuth 2.1 metadata responses.
 * These generators produce the JSON payloads for OAuth discovery endpoints
 * without any framework dependencies, making them reusable across different HTTP servers.
 */
import { Environments, type EnvironmentName } from '../../environments.js'
import type {
  OAuthUrls,
  OAuthConfig,
  ProtectedResourceMetadata,
  McpProtectedResourceMetadata,
  AuthorizationServerMetadata,
  OidcConfiguration,
} from '../types/http.types.js'

/**
 * The query parameter that tells the Nevermined web app WHICH API tier an OAuth ceremony belongs
 * to, and its two values. Each tier (sandbox / live) is its own authorization server, but ONE web
 * app serves the consent screens for both and boots on whatever tier the user's browser last chose
 * — Live by default. A bare `https://nevermined.app/oauth/authorize` therefore sends a sandbox MCP
 * server's users to the LIVE consent screen, where the connector is not registered ("Connector not
 * authorized"). The tier is stated on the URL instead; RFC 6749 §3.1 obliges clients to retain the
 * query component when they add their own parameters. Same name and values as the Nevermined API's
 * own RFC 8414 document and the embed widget (nvm-monorepo#3430 / #1787).
 */
export const OAUTH_TIER_PARAM = 'network'
export const OAUTH_TIERS = ['sandbox', 'live'] as const
export type OAuthTier = (typeof OAUTH_TIERS)[number]

/**
 * The API tier an environment belongs to. The four named environments map directly. `custom` is
 * derived from the host of the backend it will publish as `token_endpoint`: a Nevermined API host has
 * an `api` label immediately followed by the tier label — `api.sandbox.nevermined.app`,
 * `<slug>.api.live.nevermined.app` (branded per-org subdomains), `mcp.api.sandbox.nevermined.dev` —
 * so that label pair is what is matched, never a bare `sandbox` anywhere in the host. When the host
 * cannot be classified (a `localhost` stack, a proxy/CNAME in front of the API) the tier is
 * **omitted**, not guessed: the URL stays the pre-#3430 bare one, and the operator sets
 * `oauthUrls.authorizationUri` (with `?network=` on it) to say which tier that deployment is —
 * `getOAuthUrlsForEnvironment` warns once when that happens, so the degradation is never silent.
 *
 * ⚠️ This is not the only classifier of a `custom` backend for the `network` value. Two siblings
 * apply DIFFERENT rules to the same input and can disagree on real hosts (payments#455 review):
 * `cli/src/utils/widget-redirect-flow.ts` `resolveEmbedNetwork` matches `live` as a dot/slash-bounded
 * segment anywhere in `NVM_BACKEND_URL` and DEFAULTS to `sandbox`; nvm-monorepo
 * `apps/mcp/src/config.ts` `deriveEmbedNetwork` needs a `nevermined.{app,dev}` suffix AND a tier
 * segment, and refuses otherwise. Decided 2026-09-18: all three converge on THIS rule (the `api.<tier>`
 * pair, never guessing) — the CLI in payments#456, the monorepo in nvm-monorepo#3638. Do not derive a
 * fourth rule here.
 */
export function resolveOAuthTier(
  environment: EnvironmentName,
  backendUrl: string,
): OAuthTier | undefined {
  switch (environment) {
    case 'sandbox':
    case 'staging_sandbox':
      return 'sandbox'
    case 'live':
    case 'staging_live':
      return 'live'
    default:
      return tierFromHost(backendUrl)
  }
}

/** The `api.<tier>` label-pair match behind {@link resolveOAuthTier}'s `custom` branch. */
function tierFromHost(url: string): OAuthTier | undefined {
  let labels: string[]
  try {
    // WHATWG `hostname` is lowercased and carries no port/credentials/path.
    labels = new URL(url).hostname.split('.')
  } catch {
    return undefined
  }
  const tierAfterApi = labels[labels.indexOf('api') + 1]
  if (labels.includes('api') && (OAUTH_TIERS as readonly string[]).includes(tierAfterApi)) {
    return tierAfterApi as OAuthTier
  }
  return undefined
}

/** Best-effort host for a warning line; never throws on a malformed URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// Warn-once flags, module-level like `environmentOptionDeprecationWarned` in `base-payments.ts`:
// discovery documents are rebuilt per request, and a warning per request is noise nobody reads.
let tierlessWarned = false
let crossTierWarned = false

/**
 * Append `?network=<tier>` to the authorize URL. Goes through the URL API so the result is a
 * canonical absolute URL with one query string; a frontend that is not an absolute URL (a relative
 * `NVM_FRONTEND_URL` such as `/webapp`) cannot be parsed, and falls back to plain concatenation —
 * the same shape the tier-less URL always had for that misconfiguration.
 */
function withTierParam(authorizeUrl: string, tier: OAuthTier | undefined): string {
  if (!tier) return authorizeUrl
  try {
    const url = new URL(authorizeUrl)
    url.searchParams.set(OAUTH_TIER_PARAM, tier)
    return url.toString()
  } catch {
    return `${authorizeUrl}${authorizeUrl.includes('?') ? '&' : '?'}${OAUTH_TIER_PARAM}=${tier}`
  }
}

/**
 * Build OAuth URLs from frontend and backend URLs.
 * - issuer and authorizationUri use the frontend (user-facing); authorizationUri carries the tier
 * - tokenUri, jwksUri, userinfoUri use the backend (API)
 *
 * @param frontendUrl - The frontend URL (e.g., https://nevermined.app)
 * @param backendUrl - The backend URL (e.g., https://api.sandbox.nevermined.app)
 * @param tier - The API tier to stamp on the authorize URL (see {@link resolveOAuthTier})
 * @returns OAuth URLs configuration
 */
function buildOAuthUrls(
  frontendUrl: string,
  backendUrl: string,
  tier: OAuthTier | undefined,
): OAuthUrls {
  // Remove trailing slashes
  const frontend = frontendUrl.replace(/\/$/, '')
  const backend = backendUrl.replace(/\/$/, '')

  return {
    issuer: frontend,
    authorizationUri: withTierParam(`${frontend}/oauth/authorize`, tier),
    tokenUri: `${backend}/oauth/token`,
    jwksUri: `${backend}/.well-known/jwks.json`,
    userinfoUri: `${backend}/oauth/userinfo`,
  }
}

/**
 * Get OAuth URLs for an environment.
 * Uses frontend and backend URLs from Environments configuration. An unknown environment name (a
 * JS caller / cast — `EnvironmentName` is closed) falls back to `sandbox`, as it always did; the
 * fallback is now internally consistent (a sandbox `token_endpoint` AND a sandbox-tagged authorize).
 *
 * @param environment - The Nevermined environment name
 * @param backendForTier - The backend the document will actually publish as `token_endpoint` —
 *   the environment's, or an `oauthUrls.tokenUri` override. The tier follows THAT under `custom`,
 *   exactly as `resolveAuthorizationServer` derives the AS origin from it: a `custom` server whose
 *   `tokenUri` is overridden to `api.sandbox.…` must not publish a sandbox token endpoint next to a
 *   tier-blind authorize URL (payments#455 review). Under a NAMED environment the environment's tier
 *   takes precedence over the override — deliberately: a same-tier proxy (`sandbox` +
 *   `tokenUri: https://gw.corp.com/…`) classifies to nothing and must keep the tier it has. When the
 *   override's host classifies to the OTHER tier the combination is always a misconfiguration (the
 *   consent screen on one tier, the token endpoint on the other, and the code exchange failing as a
 *   "bad or expired code"), so it is warned once rather than silently honoured.
 * @returns OAuth URLs configuration
 */
function getOAuthUrlsForEnvironment(
  environment: EnvironmentName,
  backendForTier?: string,
): OAuthUrls {
  const known = environment in Environments
  const effective: EnvironmentName = known ? environment : 'sandbox'
  const envConfig = Environments[effective]
  const backend = backendForTier || envConfig.backend
  const tier = resolveOAuthTier(effective, backend)

  if (effective === 'custom' && !tier && !tierlessWarned) {
    // Omitting beats guessing, but never silently: the document is served 200 and cached for an
    // hour, and the operator's first evidence would otherwise be a user on the wrong consent screen.
    tierlessWarned = true
    console.warn(
      `[Nevermined] Could not derive the API tier from backend host '${hostOf(backend)}' — ` +
        `authorization_endpoint will be advertised without ?${OAUTH_TIER_PARAM}=. Set ` +
        `oauthUrls.authorizationUri to the Nevermined web app URL including ` +
        `?${OAUTH_TIER_PARAM}=sandbox|live for this deployment.`,
    )
  }
  if (effective !== 'custom' && backendForTier && !crossTierWarned) {
    const overrideTier = tierFromHost(backendForTier)
    if (overrideTier && overrideTier !== tier) {
      crossTierWarned = true
      console.warn(
        `[Nevermined] oauthUrls.tokenUri points at the ${overrideTier} API ` +
          `('${hostOf(backendForTier)}') but the environment is '${effective}' (${tier}); ` +
          `authorization_endpoint keeps ?${OAUTH_TIER_PARAM}=${tier} from the environment, so the ` +
          `consent screen and the token endpoint would sit on different tiers. Use the same tier ` +
          `for both.`,
      )
    }
  }

  return buildOAuthUrls(envConfig.frontend, envConfig.backend, tier)
}

/**
 * Default scopes supported by Nevermined MCP servers.
 */
const DEFAULT_SCOPES: readonly string[] = [
  'openid',
  'profile',
  'credits',
  'mcp:read',
  'mcp:write',
  'mcp:tools',
]

/**
 * Get OAuth URLs for a given environment with optional overrides.
 *
 * @param environment - The Nevermined environment name
 * @param overrides - Optional partial overrides for specific URLs
 * @returns Complete OAuth URLs configuration
 */
export function getOAuthUrls(
  environment: EnvironmentName,
  overrides?: Partial<OAuthUrls>,
): OAuthUrls {
  // An overridden `authorizationUri` is passed through verbatim — the SDK cannot know whether it is
  // the Nevermined webapp or a foreign AS, so an operator who points it at the webapp includes
  // `?network=` themselves (documented on `OAuthUrls.authorizationUri`).
  const baseUrls = getOAuthUrlsForEnvironment(environment, overrides?.tokenUri)
  return { ...baseUrls, ...overrides }
}

/**
 * Build Protected Resource Metadata (RFC 9728).
 * This metadata tells OAuth clients about the protected resource.
 *
 * @param config - OAuth configuration
 * @returns Protected Resource Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildProtectedResourceMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * // Returns: { resource: 'http://localhost:5001', authorization_servers: [...], ... }
 * ```
 */
export function buildProtectedResourceMetadata(config: OAuthConfig): ProtectedResourceMetadata {
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    resource: config.baseUrl,
    authorization_servers: [resolveAuthorizationServer(config)],
    scopes_supported: scopes,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.baseUrl}/`,
  }
}

/**
 * Resolve the authorization-server identifier for `authorization_servers`.
 *
 * RFC 9728 §2 requires each entry to be an AS issuer identifier — a URL from
 * which `/.well-known/oauth-authorization-server` (RFC 8414) actually resolves.
 * For Nevermined that is the **backend** API origin (which serves the AS
 * metadata and whose own published `issuer` is the backend URL), NOT:
 *   - `config.baseUrl` — that is this MCP server, the protected *resource*; and
 *   - `OAuthUrls.issuer` — that is the *frontend* (a client-routed SPA that 200s
 *     on every path, so an RFC 8414 fetch there silently returns HTML).
 * The backend origin is derived from `tokenUri` (`${backend}/oauth/token`), which
 * respects any `config.oauthUrls.tokenUri` override.
 */
function resolveAuthorizationServer(config: OAuthConfig): string {
  const { tokenUri } = getOAuthUrls(config.environment, config.oauthUrls)
  const envTokenUri = getOAuthUrls(config.environment).tokenUri
  // Guard both a falsy `{ tokenUri: undefined }` override (slips through the
  // `{...baseUrls, ...overrides}` spread — exactOptionalPropertyTypes is off) AND
  // a malformed non-falsy one — fall back to the environment default rather than
  // crash the metadata endpoint with `new URL(...)`.
  try {
    return new URL(tokenUri || envTokenUri).origin
  } catch {
    return new URL(envTokenUri).origin
  }
}

/**
 * Build MCP-specific Protected Resource Metadata.
 * Extends the base metadata with MCP capabilities information.
 *
 * @param config - OAuth configuration
 * @returns MCP Protected Resource Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildMcpProtectedResourceMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox',
 *   tools: ['hello_world', 'weather']
 * })
 * ```
 */
export function buildMcpProtectedResourceMetadata(
  config: OAuthConfig,
): McpProtectedResourceMetadata {
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    resource: `${config.baseUrl}/mcp`,
    // See resolveAuthorizationServer: the AS is the backend API origin, not this
    // MCP server (baseUrl) nor the frontend SPA (OAuthUrls.issuer).
    authorization_servers: [resolveAuthorizationServer(config)],
    scopes_supported: scopes,
    scopes_required: scopes,
    bearer_methods_supported: ['header'],
    resource_documentation: `${config.baseUrl}/`,
    mcp_capabilities: {
      tools: config.tools || [],
      protocol_version: config.protocolVersion || '2024-11-05',
    },
  }
}

/**
 * Build OAuth Authorization Server Metadata (RFC 8414).
 * This metadata describes the OAuth authorization server configuration.
 *
 * @param config - OAuth configuration
 * @returns Authorization Server Metadata response object
 *
 * @example
 * ```typescript
 * const metadata = buildAuthorizationServerMetadata({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * ```
 */
export function buildAuthorizationServerMetadata(config: OAuthConfig): AuthorizationServerMetadata {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    issuer: oauthUrls.issuer,
    authorization_endpoint: oauthUrls.authorizationUri,
    token_endpoint: oauthUrls.tokenUri,
    registration_endpoint: `${config.baseUrl}/register`,
    jwks_uri: oauthUrls.jwksUri,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: scopes,
    token_endpoint_auth_methods_supported: ['client_secret_post'],
    subject_types_supported: ['public'],
  }
}

/**
 * Build OpenID Connect Discovery Metadata.
 * Provides OIDC-compatible configuration for clients that expect OpenID Connect.
 *
 * @param config - OAuth configuration
 * @returns OIDC Configuration response object
 *
 * @example
 * ```typescript
 * const metadata = buildOidcConfiguration({
 *   baseUrl: 'http://localhost:5001',
 *   agentId: 'agent_123',
 *   environment: 'staging_sandbox'
 * })
 * ```
 */
export function buildOidcConfiguration(config: OAuthConfig): OidcConfiguration {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]
  const allScopes = scopes.includes('openid') ? scopes : ['openid', ...scopes]

  return {
    issuer: oauthUrls.issuer,
    authorization_endpoint: oauthUrls.authorizationUri,
    token_endpoint: oauthUrls.tokenUri,
    jwks_uri: oauthUrls.jwksUri,
    userinfo_endpoint: oauthUrls.userinfoUri,
    registration_endpoint: `${config.baseUrl}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'HS256'],
    scopes_supported: allScopes,
    claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'name', 'email'],
  }
}

/**
 * Build server info response for the root endpoint.
 *
 * @param config - OAuth configuration
 * @param options - Additional options for the server info
 * @returns Server info response object
 */
export function buildServerInfoResponse(
  config: OAuthConfig,
  options?: {
    version?: string
    description?: string
  },
): {
  name: string
  version: string
  description: string
  endpoints: Record<string, string>
  oauth: Record<string, any>
  tools: string[]
  resources: string[]
  prompts: string[]
} {
  const oauthUrls = getOAuthUrls(config.environment, config.oauthUrls)
  const scopes = config.scopes || [...DEFAULT_SCOPES]

  return {
    name: config.serverName || 'MCP Server',
    version: options?.version || '1.0.0',
    description:
      options?.description || 'MCP server with Nevermined OAuth integration via Streamable HTTP',
    endpoints: {
      mcp: `${config.baseUrl}/mcp`,
      health: `${config.baseUrl}/health`,
      register: `${config.baseUrl}/register`,
    },
    oauth: {
      authorization_server_metadata: `${config.baseUrl}/.well-known/oauth-authorization-server`,
      protected_resource_metadata: `${config.baseUrl}/.well-known/oauth-protected-resource`,
      openid_configuration: `${config.baseUrl}/.well-known/openid-configuration`,
      authorization_endpoint: oauthUrls.authorizationUri,
      token_endpoint: oauthUrls.tokenUri,
      jwks_uri: oauthUrls.jwksUri,
      registration_endpoint: `${config.baseUrl}/register`,
      // agentId is optional under the plan-centric model; omit client_id when absent.
      ...(config.agentId ? { client_id: config.agentId } : {}),
      scopes: scopes,
    },
    tools: config.tools || [],
    resources: config.resources || [],
    prompts: config.prompts || [],
  }
}
