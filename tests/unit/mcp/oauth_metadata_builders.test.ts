/**
 * Unit tests for OAuth metadata builders
 */

import {
  buildProtectedResourceMetadata,
  buildMcpProtectedResourceMetadata,
  buildAuthorizationServerMetadata,
  buildOidcConfiguration,
  buildServerInfoResponse,
  getOAuthUrls,
  resolveOAuthTier,
  OAUTH_TIER_PARAM,
} from '../../../src/mcp/http/oauth-metadata.js'
import type { OAuthConfig } from '../../../src/mcp/types/http.types.js'
import type { EnvironmentName } from '../../../src/environments.js'

describe('OAuth Metadata Builders', () => {
  const baseConfig: OAuthConfig = {
    baseUrl: 'http://localhost:3000',
    agentId: 'did:nv:agent123',
    environment: 'staging_sandbox',
    serverName: 'test-mcp-server',
    tools: ['weather.today', 'weather.forecast'],
    resources: ['weather://today/{city}'],
    prompts: ['weather.ensureCity'],
  }

  describe('buildProtectedResourceMetadata', () => {
    test('should build protected resource metadata with required fields', () => {
      const metadata = buildProtectedResourceMetadata(baseConfig)

      expect(metadata).toBeDefined()
      expect(metadata.resource).toBe('http://localhost:3000')
      // The AS is the BACKEND API origin (it serves the RFC 8414 AS metadata),
      // NOT this MCP server (baseUrl) and NOT the frontend SPA (which 200s HTML on every
      // path). Hardcoded so it can't drift silently. (#463: `issuer` IS that origin now, so the
      // frontend is named literally rather than through `getOAuthUrls().issuer`.)
      expect(metadata.authorization_servers).toEqual(['https://api.sandbox.nevermined.dev'])
      expect(metadata.authorization_servers).not.toContain(baseConfig.baseUrl)
      expect(metadata.authorization_servers).not.toContain('https://nevermined.dev')
      expect(metadata.bearer_methods_supported).toEqual(['header'])
      expect(metadata.resource_documentation).toBe('http://localhost:3000/')
    })

    test('should include default scopes', () => {
      const metadata = buildProtectedResourceMetadata(baseConfig)

      expect(metadata.scopes_supported).toContain('openid')
      expect(metadata.scopes_supported).toContain('profile')
      expect(metadata.scopes_supported).toContain('credits')
      expect(metadata.scopes_supported).toContain('mcp:read')
      expect(metadata.scopes_supported).toContain('mcp:write')
      expect(metadata.scopes_supported).toContain('mcp:tools')
    })

    test('should use custom scopes when provided', () => {
      const config = {
        ...baseConfig,
        scopes: ['custom:scope1', 'custom:scope2'],
      }
      const metadata = buildProtectedResourceMetadata(config)

      expect(metadata.scopes_supported).toEqual(['custom:scope1', 'custom:scope2'])
      expect(metadata.scopes_supported).not.toContain('openid')
    })
  })

  describe('buildMcpProtectedResourceMetadata', () => {
    test('should build MCP-specific protected resource metadata', () => {
      const metadata = buildMcpProtectedResourceMetadata(baseConfig)

      expect(metadata).toBeDefined()
      expect(metadata.resource).toBe('http://localhost:3000/mcp')
      // Same as the base builder: the AS is the backend API origin.
      expect(metadata.authorization_servers).toEqual(['https://api.sandbox.nevermined.dev'])
      expect(metadata.authorization_servers).not.toContain(baseConfig.baseUrl)
      expect(metadata.authorization_servers).not.toContain('https://nevermined.dev')
      expect(metadata.bearer_methods_supported).toEqual(['header'])
    })

    test('should include MCP capabilities', () => {
      const metadata = buildMcpProtectedResourceMetadata(baseConfig)

      expect(metadata.mcp_capabilities).toBeDefined()
      expect(metadata.mcp_capabilities?.tools).toEqual(['weather.today', 'weather.forecast'])
      expect(metadata.mcp_capabilities?.protocol_version).toBe('2024-11-05')
    })

    test('should include both scopes_supported and scopes_required', () => {
      const metadata = buildMcpProtectedResourceMetadata(baseConfig)

      expect(metadata.scopes_supported).toBeDefined()
      expect(metadata.scopes_required).toBeDefined()
      expect(metadata.scopes_supported).toEqual(metadata.scopes_required)
    })

    test('should use custom protocol version when provided', () => {
      const config = {
        ...baseConfig,
        protocolVersion: '2024-12-01',
      }
      const metadata = buildMcpProtectedResourceMetadata(config)

      expect(metadata.mcp_capabilities?.protocol_version).toBe('2024-12-01')
    })
  })

  // Non-tautological: hardcoded backend origins per environment. Catches the
  // frontend-vs-backend regression (issuer=frontend serves no AS metadata) across
  // every environment, not just the one baseConfig happens to use.
  describe('authorization_servers is the backend AS for every environment', () => {
    test.each([
      ['staging_sandbox', 'https://api.sandbox.nevermined.dev', 'https://nevermined.dev'],
      ['staging_live', 'https://api.live.nevermined.dev', 'https://nevermined.dev'],
      ['sandbox', 'https://api.sandbox.nevermined.app', 'https://nevermined.app'],
      ['live', 'https://api.live.nevermined.app', 'https://nevermined.app'],
    ] as const)('%s → [%s], never the frontend', (environment, backend, frontend) => {
      const cfg = { baseUrl: 'http://localhost:3000', environment } as OAuthConfig
      for (const md of [
        buildProtectedResourceMetadata(cfg),
        buildMcpProtectedResourceMetadata(cfg),
      ]) {
        expect(md.authorization_servers).toEqual([backend])
        expect(md.authorization_servers).not.toContain(frontend)
        expect(md.authorization_servers).not.toContain('http://localhost:3000')
      }
    })

    test.each([
      ['undefined', undefined],
      ['a malformed string', 'not a url'],
    ])(
      'a %s tokenUri override falls back to the env default (no crash, no [null])',
      (_label, tokenUri) => {
        const cfg = {
          ...baseConfig,
          oauthUrls: { tokenUri },
        } as unknown as OAuthConfig
        const md = buildProtectedResourceMetadata(cfg)
        expect(md.authorization_servers).toEqual(['https://api.sandbox.nevermined.dev'])
      },
    )
  })

  describe('buildAuthorizationServerMetadata', () => {
    test('should build authorization server metadata with all required endpoints', () => {
      const metadata = buildAuthorizationServerMetadata(baseConfig)

      expect(metadata).toBeDefined()
      expect(metadata.issuer).toBeDefined()
      expect(metadata.authorization_endpoint).toBeDefined()
      expect(metadata.token_endpoint).toBeDefined()
      expect(metadata.registration_endpoint).toBe('http://localhost:3000/register')
      expect(metadata.jwks_uri).toBeDefined()
    })

    test('should include supported response types and grant types', () => {
      const metadata = buildAuthorizationServerMetadata(baseConfig)

      expect(metadata.response_types_supported).toEqual(['code'])
      expect(metadata.grant_types_supported).toContain('authorization_code')
      expect(metadata.grant_types_supported).toContain('refresh_token')
    })

    test('should support PKCE with S256', () => {
      const metadata = buildAuthorizationServerMetadata(baseConfig)

      expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
    })

    test('should include scopes', () => {
      const metadata = buildAuthorizationServerMetadata(baseConfig)

      expect(metadata.scopes_supported).toContain('openid')
      expect(metadata.scopes_supported).toContain('credits')
    })

    test('should support client_secret_post authentication', () => {
      const metadata = buildAuthorizationServerMetadata(baseConfig)

      expect(metadata.token_endpoint_auth_methods_supported).toContain('client_secret_post')
    })

    test('should use custom OAuth URLs when provided', () => {
      const config = {
        ...baseConfig,
        oauthUrls: {
          issuer: 'https://custom-issuer.com',
          authorizationUri: 'https://custom-issuer.com/oauth/authorize',
          tokenUri: 'https://custom-api.com/oauth/token',
          jwksUri: 'https://custom-api.com/.well-known/jwks.json',
          userinfoUri: 'https://custom-api.com/oauth/userinfo',
        },
      }
      const metadata = buildAuthorizationServerMetadata(config)

      expect(metadata.issuer).toBe('https://custom-issuer.com')
      expect(metadata.authorization_endpoint).toBe('https://custom-issuer.com/oauth/authorize')
      expect(metadata.token_endpoint).toBe('https://custom-api.com/oauth/token')
      expect(metadata.jwks_uri).toBe('https://custom-api.com/.well-known/jwks.json')
    })
  })

  describe('buildOidcConfiguration', () => {
    test('should build OIDC configuration with required fields', () => {
      const config = buildOidcConfiguration(baseConfig)

      expect(config).toBeDefined()
      expect(config.issuer).toBeDefined()
      expect(config.authorization_endpoint).toBeDefined()
      expect(config.token_endpoint).toBeDefined()
      expect(config.jwks_uri).toBeDefined()
      expect(config.userinfo_endpoint).toBeDefined()
      expect(config.registration_endpoint).toBe('http://localhost:3000/register')
    })

    test('should include openid scope even if not in custom scopes', () => {
      const config = {
        ...baseConfig,
        scopes: ['profile', 'credits'],
      }
      const oidcConfig = buildOidcConfiguration(config)

      expect(oidcConfig.scopes_supported).toContain('openid')
      expect(oidcConfig.scopes_supported).toContain('profile')
      expect(oidcConfig.scopes_supported).toContain('credits')
    })

    test('should not duplicate openid scope', () => {
      const config = {
        ...baseConfig,
        scopes: ['openid', 'profile'],
      }
      const oidcConfig = buildOidcConfiguration(config)

      const openidCount = oidcConfig.scopes_supported.filter((s) => s === 'openid').length
      expect(openidCount).toBe(1)
    })

    test('should support none and client_secret_post auth methods', () => {
      const config = buildOidcConfiguration(baseConfig)

      expect(config.token_endpoint_auth_methods_supported).toContain('none')
      expect(config.token_endpoint_auth_methods_supported).toContain('client_secret_post')
    })

    test('should include supported signing algorithms', () => {
      const config = buildOidcConfiguration(baseConfig)

      expect(config.id_token_signing_alg_values_supported).toContain('RS256')
      expect(config.id_token_signing_alg_values_supported).toContain('HS256')
    })

    test('should include standard OIDC claims', () => {
      const config = buildOidcConfiguration(baseConfig)

      expect(config.claims_supported).toContain('sub')
      expect(config.claims_supported).toContain('iss')
      expect(config.claims_supported).toContain('aud')
      expect(config.claims_supported).toContain('exp')
      expect(config.claims_supported).toContain('iat')
      expect(config.claims_supported).toContain('name')
      expect(config.claims_supported).toContain('email')
    })
  })

  describe('buildServerInfoResponse', () => {
    test('should build server info with all endpoints', () => {
      const info = buildServerInfoResponse(baseConfig)

      expect(info).toBeDefined()
      expect(info.name).toBe('test-mcp-server')
      expect(info.version).toBe('1.0.0')
      expect(info.endpoints).toBeDefined()
      expect(info.endpoints.mcp).toBe('http://localhost:3000/mcp')
      expect(info.endpoints.health).toBe('http://localhost:3000/health')
      expect(info.endpoints.register).toBe('http://localhost:3000/register')
    })

    test('should include OAuth endpoints', () => {
      const info = buildServerInfoResponse(baseConfig)

      expect(info.oauth).toBeDefined()
      expect(info.oauth.authorization_server_metadata).toBe(
        'http://localhost:3000/.well-known/oauth-authorization-server',
      )
      expect(info.oauth.protected_resource_metadata).toBe(
        'http://localhost:3000/.well-known/oauth-protected-resource',
      )
      expect(info.oauth.openid_configuration).toBe(
        'http://localhost:3000/.well-known/openid-configuration',
      )
    })

    test('should include MCP capabilities', () => {
      const info = buildServerInfoResponse(baseConfig)

      expect(info.tools).toEqual(['weather.today', 'weather.forecast'])
      expect(info.resources).toEqual(['weather://today/{city}'])
      expect(info.prompts).toEqual(['weather.ensureCity'])
    })

    test('should use custom version and description', () => {
      const info = buildServerInfoResponse(baseConfig, {
        version: '2.0.0',
        description: 'Custom MCP server',
      })

      expect(info.version).toBe('2.0.0')
      expect(info.description).toBe('Custom MCP server')
    })

    test('should include client_id (agentId) in OAuth info', () => {
      const info = buildServerInfoResponse(baseConfig)

      expect(info.oauth.client_id).toBe('did:nv:agent123')
    })

    test('should include scopes in OAuth info', () => {
      const info = buildServerInfoResponse(baseConfig)

      expect(info.oauth.scopes).toBeDefined()
      expect(Array.isArray(info.oauth.scopes)).toBe(true)
      expect(info.oauth.scopes.length).toBeGreaterThan(0)
    })
  })

  describe('getOAuthUrls', () => {
    test('should return URLs for staging environment', () => {
      const urls = getOAuthUrls('staging_sandbox')

      expect(urls.issuer).toBeDefined()
      expect(urls.authorizationUri).toContain('/oauth/authorize')
      expect(urls.tokenUri).toContain('/oauth/token')
      expect(urls.jwksUri).toContain('/.well-known/jwks.json')
      expect(urls.userinfoUri).toContain('/oauth/userinfo')
    })

    test('should return URLs for live environment', () => {
      const urls = getOAuthUrls('live')

      expect(urls.issuer).toBeDefined()
      expect(urls.authorizationUri).toContain('/oauth/authorize')
      expect(urls.tokenUri).toContain('/oauth/token')
    })

    test('should allow partial URL overrides', () => {
      const urls = getOAuthUrls('staging_sandbox', {
        issuer: 'https://custom-issuer.com',
      })

      expect(urls.issuer).toBe('https://custom-issuer.com')
      // Other URLs should still use staging defaults
      expect(urls.tokenUri).toBeDefined()
      expect(urls.tokenUri).not.toBe('https://custom-issuer.com')
    })

    test('should allow complete URL overrides', () => {
      const customUrls = {
        issuer: 'https://custom-issuer.com',
        authorizationUri: 'https://custom-issuer.com/auth',
        tokenUri: 'https://custom-api.com/token',
        jwksUri: 'https://custom-api.com/jwks',
        userinfoUri: 'https://custom-api.com/userinfo',
      }
      const urls = getOAuthUrls('staging_sandbox', customUrls)

      expect(urls).toEqual(customUrls)
    })
  })

  // nvm-monorepo#3430 / payments#447: the authorize URL this server advertises must name the API
  // tier, because one Nevermined web app serves both tiers' consent screens and boots on Live by
  // default — a bare URL sent a sandbox server's users to the LIVE consent screen ("Connector not
  // authorized"). Same param name + values as the API's own RFC 8414 document (`network`, #1787).
  describe('authorization_endpoint carries the API tier (#447)', () => {
    test.each([
      ['sandbox', 'https://nevermined.app/oauth/authorize?network=sandbox'],
      ['staging_sandbox', 'https://nevermined.dev/oauth/authorize?network=sandbox'],
      ['live', 'https://nevermined.app/oauth/authorize?network=live'],
      ['staging_live', 'https://nevermined.dev/oauth/authorize?network=live'],
    ] as const)('%s → %s', (environment, expected) => {
      expect(getOAuthUrls(environment).authorizationUri).toBe(expected)
      // Both discovery documents publish the same value.
      const config: OAuthConfig = { ...baseConfig, environment }
      expect(buildAuthorizationServerMetadata(config).authorization_endpoint).toBe(expected)
      expect(buildOidcConfiguration(config).authorization_endpoint).toBe(expected)
      expect(buildServerInfoResponse(config).oauth.authorization_endpoint).toBe(expected)
    })

    test('the param is `network` and the URL has exactly one query string', () => {
      expect(OAUTH_TIER_PARAM).toBe('network')
      const url = new URL(getOAuthUrls('sandbox').authorizationUri)
      expect(url.pathname).toBe('/oauth/authorize')
      expect([...url.searchParams.entries()]).toEqual([['network', 'sandbox']])
      expect(getOAuthUrls('sandbox').authorizationUri.split('?')).toHaveLength(2)
    })

    test('the tier is NOT stamped on the token / jwks / userinfo URLs', () => {
      const urls = getOAuthUrls('sandbox')
      for (const u of [urls.tokenUri, urls.jwksUri, urls.userinfoUri, urls.issuer]) {
        expect(u).not.toContain('network=')
      }
    })

    test('an explicit authorizationUri override is passed through untouched', () => {
      const urls = getOAuthUrls('sandbox', {
        authorizationUri: 'https://custom-issuer.com/oauth/authorize',
      })
      expect(urls.authorizationUri).toBe('https://custom-issuer.com/oauth/authorize')
    })

    test('resolveOAuthTier: named environments map directly; custom derives from the backend host, else omits', () => {
      expect(resolveOAuthTier('sandbox', 'ignored')).toBe('sandbox')
      expect(resolveOAuthTier('staging_sandbox', 'ignored')).toBe('sandbox')
      expect(resolveOAuthTier('live', 'ignored')).toBe('live')
      expect(resolveOAuthTier('staging_live', 'ignored')).toBe('live')
      expect(resolveOAuthTier('custom', 'https://api.sandbox.nevermined.app/')).toBe('sandbox')
      expect(resolveOAuthTier('custom', 'https://api.live.nevermined.dev')).toBe('live')
      // Every host shape the API actually serves: branded per-org subdomains and the Commerce MCP.
      expect(resolveOAuthTier('custom', 'https://acme.api.sandbox.nevermined.app')).toBe('sandbox')
      expect(resolveOAuthTier('custom', 'https://mcp.api.live.nevermined.dev')).toBe('live')
      // WHATWG hostname lowercases and strips port/credentials.
      expect(resolveOAuthTier('custom', 'https://API.Sandbox.nevermined.app:8443/x')).toBe(
        'sandbox',
      )
      // Anchored on the `api.<tier>` label pair — a bare `sandbox` label elsewhere is NOT a tier.
      expect(resolveOAuthTier('custom', 'https://sandbox.nevermined.app')).toBeUndefined()
      expect(resolveOAuthTier('custom', 'https://api.nevermined.app/sandbox')).toBeUndefined()
      // Unclassifiable: a local stack, or a malformed URL — no guessed tier.
      expect(resolveOAuthTier('custom', 'http://localhost:3001')).toBeUndefined()
      expect(resolveOAuthTier('custom', 'not a url')).toBeUndefined()
    })

    test('custom: the tier follows the backend the document PUBLISHES — an overridden tokenUri', () => {
      // `custom` + `oauthUrls.tokenUri` pointing at a real tier used to publish a sandbox
      // token_endpoint next to a BARE authorize URL — the #447 bug, silently (review finding).
      const sandbox = getOAuthUrls('custom', {
        tokenUri: 'https://api.sandbox.nevermined.app/oauth/token',
      })
      expect(new URL(sandbox.authorizationUri).searchParams.get('network')).toBe('sandbox')
      const live = getOAuthUrls('custom', {
        tokenUri: 'https://api.live.nevermined.app/oauth/token',
      })
      expect(new URL(live.authorizationUri).searchParams.get('network')).toBe('live')
      // A local backend override keeps the bare URL — no guessed tier.
      const local = getOAuthUrls('custom', { tokenUri: 'http://localhost:3001/oauth/token' })
      expect(local.authorizationUri).not.toContain('network=')
      // The three documents agree.
      const config: OAuthConfig = {
        ...baseConfig,
        environment: 'custom',
        oauthUrls: { tokenUri: 'https://api.sandbox.nevermined.app/oauth/token' },
      }
      expect(buildAuthorizationServerMetadata(config).authorization_endpoint).toBe(
        sandbox.authorizationUri,
      )
      expect(buildOidcConfiguration(config).authorization_endpoint).toBe(sandbox.authorizationUri)
    })

    test('an unknown environment name falls back to sandbox URLs — now including the tier', () => {
      // Pre-existing fallback (a JS caller / cast); the document is now internally consistent:
      // a sandbox token_endpoint AND a sandbox-tagged authorize, instead of a bare one.
      const urls = getOAuthUrls('bogus' as EnvironmentName)
      expect(urls.tokenUri).toBe('https://api.sandbox.nevermined.app/oauth/token')
      expect(urls.authorizationUri).toBe('https://nevermined.app/oauth/authorize?network=sandbox')
    })
  })

  describe('tier warnings are loud exactly once (#455 review)', () => {
    // Both warn-once flags are module-level (the `environmentOptionDeprecationWarned` pattern), so
    // each case reloads the module to start from "not yet warned" — and asserts a SECOND call in the
    // same module stays silent, which is the half a fresh module cannot show.
    const saved = { backend: process.env.NVM_BACKEND_URL, frontend: process.env.NVM_FRONTEND_URL }
    let warn: jest.SpyInstance
    beforeEach(() => {
      warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    })
    afterEach(() => {
      warn.mockRestore()
      if (saved.backend === undefined) delete process.env.NVM_BACKEND_URL
      else process.env.NVM_BACKEND_URL = saved.backend
      if (saved.frontend === undefined) delete process.env.NVM_FRONTEND_URL
      else process.env.NVM_FRONTEND_URL = saved.frontend
      jest.resetModules()
    })

    const fresh = async (backend = 'https://api.sandbox.nevermined.app') => {
      jest.resetModules()
      process.env.NVM_BACKEND_URL = backend
      process.env.NVM_FRONTEND_URL = 'https://nevermined.app'
      return import('../../../src/mcp/http/oauth-metadata.js')
    }

    test('custom + unclassifiable backend: bare URL, ONE warning naming the host and the remedy', async () => {
      const mod = await fresh('http://localhost:3001')
      expect(mod.getOAuthUrls('custom').authorizationUri).toBe(
        'https://nevermined.app/oauth/authorize',
      )
      expect(warn).toHaveBeenCalledTimes(1)
      const msg = String(warn.mock.calls[0][0])
      expect(msg).toContain("'localhost:3001'")
      expect(msg).toContain('without ?network=')
      expect(msg).toContain('oauthUrls.authorizationUri')
      // Discovery documents are rebuilt per request — the second build must not warn again.
      mod.getOAuthUrls('custom')
      mod.buildAuthorizationServerMetadata({ ...baseConfig, environment: 'custom' })
      expect(warn).toHaveBeenCalledTimes(1)
    })

    test('custom + malformed backend: one tier warning AND one issuer warning, never a throw', async () => {
      const mod = await fresh('not a url')
      const urls = mod.getOAuthUrls('custom')
      expect(urls.authorizationUri).not.toContain('network=')
      // #464: the issuer falls back to the raw string (no origin anywhere) and says so once.
      expect(urls.issuer).toBe('not a url')
      const messages = warn.mock.calls.map((c) => String(c[0]))
      expect(messages).toHaveLength(2)
      expect(messages.find((m) => m.includes('without ?network='))).toContain("'not a url'")
      expect(messages.find((m) => m.includes('Could not derive an OAuth issuer'))).toContain(
        'oauthUrls.issuer',
      )
      mod.getOAuthUrls('custom')
      expect(warn).toHaveBeenCalledTimes(2)
    })

    test('custom on a non-Nevermined host: issuer published AND warned once per value, unless overridden', async () => {
      // `api.live.example.com` classifies to a tier but has no canonical form; it is the right
      // issuer for a foreign API and the WRONG one for a proxy in front of the real API — the SDK
      // cannot tell, so it says what it derived and names `oauthUrls.issuer`.
      const mod = await fresh('https://api.live.example.com')
      expect(mod.getOAuthUrls('custom').issuer).toBe('https://api.live.example.com')
      mod.getOAuthUrls('custom')
      const proxyWarnings = () =>
        warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('proxy or gateway'))
      expect(proxyWarnings()).toHaveLength(1)
      expect(proxyWarnings()[0]).toContain("'api.live.example.com'")
      expect(proxyWarnings()[0]).toContain('oauthUrls.issuer')
      // A DIFFERENT non-canonical value warns again (a changed typo re-alerts) …
      mod.getOAuthUrls('custom', { tokenUri: 'https://gw.corp.com/oauth/token' })
      expect(proxyWarnings()).toHaveLength(2)
      // … an operator who already set `oauthUrls.issuer` is not told to set it …
      mod.getOAuthUrls('custom', {
        tokenUri: 'https://other.example.com/oauth/token',
        issuer: 'https://api.live.nevermined.app',
      })
      expect(proxyWarnings()).toHaveLength(2)
      // … and a loopback stack is not a proxy: it keeps only the tier warning it already had.
      mod.getOAuthUrls('custom', { tokenUri: 'http://localhost:3001/oauth/token' })
      expect(proxyWarnings()).toHaveLength(2)
    })

    test('custom + scheme-less host:port: opaque origin is NOT published as "null"', async () => {
      // `new URL('localhost:3001')` parses (scheme `localhost:`) with `.origin === 'null'`; that must
      // take the fallback path, not be served as an issuer.
      const mod = await fresh('localhost:3001')
      const urls = mod.getOAuthUrls('custom')
      expect(urls.issuer).toBe('localhost:3001')
      expect(urls.issuer).not.toBe('null')
      const config: OAuthConfig = { ...baseConfig, environment: 'custom' }
      // …and the PRM no longer throws on it either — one derivation, one answer.
      expect(mod.buildProtectedResourceMetadata(config).authorization_servers).toEqual([
        'localhost:3001',
      ])
      expect(
        warn.mock.calls.some((c) => String(c[0]).includes('Could not derive an OAuth issuer')),
      ).toBe(true)
    })

    test('custom + classifiable backend: no warning', async () => {
      const mod = await fresh('https://api.live.nevermined.app')
      expect(mod.getOAuthUrls('custom').authorizationUri).toContain('network=live')
      expect(warn).not.toHaveBeenCalled()
    })

    test.each([
      ['sandbox', 'https://api.live.nevermined.app/oauth/token', 'sandbox', 'live'],
      ['staging_sandbox', 'https://api.live.nevermined.dev/oauth/token', 'sandbox', 'live'],
      ['live', 'https://api.sandbox.nevermined.app/oauth/token', 'live', 'sandbox'],
    ] as const)(
      'named %s + cross-tier tokenUri %s: the ENVIRONMENT tier wins (%s), and it warns once',
      async (environment, tokenUri, envTier, overrideTier) => {
        const mod = await fresh()
        const urls = mod.getOAuthUrls(environment, { tokenUri })
        // Precedence is deliberate, not incidental: the named environment's tier is published.
        expect(new URL(urls.authorizationUri).searchParams.get('network')).toBe(envTier)
        expect(urls.tokenUri).toBe(tokenUri)
        expect(warn).toHaveBeenCalledTimes(1)
        const msg = String(warn.mock.calls[0][0])
        expect(msg).toContain(`points at the ${overrideTier} API`)
        expect(msg).toContain(`'${environment}' (${envTier})`)
        expect(msg).toContain(`?network=${envTier}`)
        mod.getOAuthUrls(environment, { tokenUri })
        expect(warn).toHaveBeenCalledTimes(1)
      },
    )

    test('named environment + same-tier or unclassifiable proxy override: tier kept, NO warning', async () => {
      const mod = await fresh()
      // A corporate gateway in front of the sandbox API classifies to nothing — the tier it has stays.
      const proxied = mod.getOAuthUrls('sandbox', { tokenUri: 'https://gw.corp.com/oauth/token' })
      expect(new URL(proxied.authorizationUri).searchParams.get('network')).toBe('sandbox')
      // Same tier spelled out is not a mismatch either.
      const same = mod.getOAuthUrls('sandbox', {
        tokenUri: 'https://acme.api.sandbox.nevermined.app/oauth/token',
      })
      expect(new URL(same.authorizationUri).searchParams.get('network')).toBe('sandbox')
      expect(warn).not.toHaveBeenCalled()
    })
  })

  // payments#463: `issuer` used to be the frontend origin — the same string for both tiers — while
  // `authorization_servers`, `token_endpoint` and the API's own RFC 8414 document all named the
  // backend. Since nvm-monorepo#3532 the web app returns RFC 9207 `iss` = the API origin, which an
  // RFC 9207 client compares with the discovered `issuer` by simple string comparison — so the
  // frontend value made every RFC 9207 direct-discovery client reject its codes. Hardcoded per environment
  // so a regression to the frontend cannot pass by mirroring the implementation.
  describe('issuer is the API origin per tier (#463)', () => {
    test.each([
      ['sandbox', 'https://api.sandbox.nevermined.app', 'https://nevermined.app'],
      ['staging_sandbox', 'https://api.sandbox.nevermined.dev', 'https://nevermined.dev'],
      ['live', 'https://api.live.nevermined.app', 'https://nevermined.app'],
      ['staging_live', 'https://api.live.nevermined.dev', 'https://nevermined.dev'],
    ] as const)('%s → issuer %s, never the frontend %s', (environment, backend, frontend) => {
      const urls = getOAuthUrls(environment)
      expect(urls.issuer).toBe(backend)
      expect(urls.issuer).not.toBe(frontend)
      // Every document that describes this AS agrees on its identifier.
      const config: OAuthConfig = { ...baseConfig, environment }
      expect(buildAuthorizationServerMetadata(config).issuer).toBe(backend)
      expect(buildOidcConfiguration(config).issuer).toBe(backend)
      expect(buildProtectedResourceMetadata(config).authorization_servers).toEqual([backend])
    })

    test('the two tiers now publish DIFFERENT issuers (the whole point)', () => {
      expect(getOAuthUrls('sandbox').issuer).not.toBe(getOAuthUrls('live').issuer)
      expect(getOAuthUrls('staging_sandbox').issuer).not.toBe(getOAuthUrls('staging_live').issuer)
    })

    test('issuer === authorization_servers[0], including under a tokenUri override', () => {
      // The invariant an RFC 9207 client relies on: the identifier it discovered is the AS that
      // answers. Both sides derive from the backend the document PUBLISHES, so an override moves
      // them together.
      for (const environment of ['sandbox', 'live', 'staging_sandbox', 'staging_live'] as const) {
        const config: OAuthConfig = { ...baseConfig, environment }
        expect(buildAuthorizationServerMetadata(config).issuer).toBe(
          buildProtectedResourceMetadata(config).authorization_servers[0],
        )
      }
      const overridden: OAuthConfig = {
        ...baseConfig,
        environment: 'custom',
        oauthUrls: { tokenUri: 'https://api.live.nevermined.app/oauth/token' },
      }
      expect(buildAuthorizationServerMetadata(overridden).issuer).toBe(
        'https://api.live.nevermined.app',
      )
      expect(buildAuthorizationServerMetadata(overridden).issuer).toBe(
        buildProtectedResourceMetadata(overridden).authorization_servers[0],
      )
    })

    test('issuer is an ORIGIN: no path, no trailing slash, host lower-cased', () => {
      // RFC 9207 §2.4 is a simple string comparison against the `iss` the web app returns, which is
      // `new URL(backendUrl).origin` — so this side must reduce the same way.
      const urls = getOAuthUrls('custom', {
        tokenUri: 'HTTPS://API.Sandbox.Nevermined.app/oauth/token',
      })
      expect(urls.issuer).toBe('https://api.sandbox.nevermined.app')
      expect(getOAuthUrls('custom', { tokenUri: 'https://api.live.nevermined.app/' }).issuer).toBe(
        'https://api.live.nevermined.app',
      )
      // Credentials never reach a public document; a non-default port is part of the origin.
      expect(
        getOAuthUrls('custom', { tokenUri: 'https://user:pw@gw.example.com/oauth/token' }).issuer,
      ).toBe('https://gw.example.com')
      expect(
        getOAuthUrls('custom', { tokenUri: 'https://gw.example.com:8443/oauth/token' }).issuer,
      ).toBe('https://gw.example.com:8443')
    })

    test('an explicit issuer override is passed through — and authorization_servers follows it', () => {
      const urls = getOAuthUrls('sandbox', { issuer: 'https://custom-issuer.com' })
      expect(urls.issuer).toBe('https://custom-issuer.com')
      expect(urls.tokenUri).toBe('https://api.sandbox.nevermined.app/oauth/token')
      // RFC 9728 §2: `authorization_servers` entries ARE issuer identifiers. Naming a foreign AS as
      // the issuer means that is also where clients are sent — one derivation, by construction.
      const config: OAuthConfig = {
        ...baseConfig,
        environment: 'sandbox',
        oauthUrls: { issuer: 'https://custom-issuer.com' },
      }
      expect(buildProtectedResourceMetadata(config).authorization_servers).toEqual([
        'https://custom-issuer.com',
      ])
    })

    test('a NAMED environment keeps its canonical issuer under any tokenUri override (proxy, cross-tier, malformed)', () => {
      // The environment IS the identity: the web app returns `iss` for that tier from fixed config,
      // so a proxy in front of the token endpoint must not move the issuer — and neither may a
      // cross-tier or malformed override. `authorization_servers` follows the issuer on every row.
      for (const [environment, canonical] of [
        ['sandbox', 'https://api.sandbox.nevermined.app'],
        ['live', 'https://api.live.nevermined.app'],
        ['staging_sandbox', 'https://api.sandbox.nevermined.dev'],
        ['staging_live', 'https://api.live.nevermined.dev'],
      ] as const) {
        for (const tokenUri of [
          'https://gw.corp.com/oauth/token',
          'https://api.live.nevermined.app/oauth/token',
          'api.sandbox.nevermined.app/oauth/token',
          '/oauth/token',
        ]) {
          const config: OAuthConfig = { ...baseConfig, environment, oauthUrls: { tokenUri } }
          const urls = getOAuthUrls(environment, { tokenUri })
          expect(urls.issuer).toBe(canonical)
          expect(urls.tokenUri).toBe(tokenUri)
          expect(buildAuthorizationServerMetadata(config).issuer).toBe(canonical)
          expect(buildProtectedResourceMetadata(config).authorization_servers).toEqual([canonical])
        }
      }
    })

    test('custom on a Nevermined host publishes the CANONICAL tier origin, not the request host', () => {
      // A branded per-org subdomain and the Commerce MCP host serve the same API as
      // `api.<tier>.nevermined.<tld>`; the API's own document and the web app's `iss` both say the
      // canonical origin, so that is the only value that passes the RFC 9207 compare.
      const cases: Array<[string, string]> = [
        ['https://acme.api.live.nevermined.app/oauth/token', 'https://api.live.nevermined.app'],
        [
          'https://mcp.api.sandbox.nevermined.dev/oauth/token',
          'https://api.sandbox.nevermined.dev',
        ],
        ['https://mcp.api.live.nevermined.dev/oauth/token', 'https://api.live.nevermined.dev'],
        // A trailing-dot FQDN is the same host to DNS — canonicalised, never one byte off.
        ['https://api.sandbox.nevermined.app./oauth/token', 'https://api.sandbox.nevermined.app'],
        [
          'https://API.Sandbox.Nevermined.app:443/oauth/token',
          'https://api.sandbox.nevermined.app',
        ],
        // A foreign host that happens to classify keeps its OWN origin — no canonical form exists.
        ['https://api.live.example.com/oauth/token', 'https://api.live.example.com'],
        ['https://x.api.live.example.com:8443/oauth/token', 'https://x.api.live.example.com:8443'],
      ]
      for (const [tokenUri, issuer] of cases) {
        const config: OAuthConfig = {
          ...baseConfig,
          environment: 'custom',
          oauthUrls: { tokenUri },
        }
        expect(getOAuthUrls('custom', { tokenUri }).issuer).toBe(issuer)
        expect(buildProtectedResourceMetadata(config).authorization_servers).toEqual([issuer])
      }
    })

    test('override hygiene: undefined / empty values never replace the computed issuer', () => {
      expect(getOAuthUrls('sandbox', { issuer: undefined }).issuer).toBe(
        'https://api.sandbox.nevermined.app',
      )
      expect(getOAuthUrls('sandbox', { issuer: '' }).issuer).toBe(
        'https://api.sandbox.nevermined.app',
      )
      expect(getOAuthUrls('sandbox', { tokenUri: undefined }).tokenUri).toBe(
        'https://api.sandbox.nevermined.app/oauth/token',
      )
      // The served document keeps its REQUIRED field.
      const config: OAuthConfig = {
        ...baseConfig,
        environment: 'sandbox',
        oauthUrls: { issuer: undefined },
      }
      expect(buildAuthorizationServerMetadata(config)).toHaveProperty(
        'issuer',
        'https://api.sandbox.nevermined.app',
      )
    })
  })

  describe('custom via NVM_BACKEND_URL (module reload, #447)', () => {
    // `Environments.custom` reads the env at module load, so the public `getOAuthUrls('custom')`
    // path is exercised by reloading the module under each value — the repo's pattern
    // (tests/unit/environment-from-key-prefix.test.ts). This is what kills a mutant that derives the
    // tier from the wrong field of `Environments.custom`.
    const saved = { backend: process.env.NVM_BACKEND_URL, frontend: process.env.NVM_FRONTEND_URL }
    afterEach(() => {
      if (saved.backend === undefined) delete process.env.NVM_BACKEND_URL
      else process.env.NVM_BACKEND_URL = saved.backend
      if (saved.frontend === undefined) delete process.env.NVM_FRONTEND_URL
      else process.env.NVM_FRONTEND_URL = saved.frontend
      jest.resetModules()
    })

    const load = async (backend: string, frontend = 'https://nevermined.app') => {
      jest.resetModules()
      process.env.NVM_BACKEND_URL = backend
      process.env.NVM_FRONTEND_URL = frontend
      const mod = await import('../../../src/mcp/http/oauth-metadata.js')
      return mod.getOAuthUrls('custom')
    }

    test.each([
      [
        'https://api.sandbox.nevermined.app',
        'https://nevermined.app/oauth/authorize?network=sandbox',
        'https://api.sandbox.nevermined.app',
      ],
      [
        'https://api.live.nevermined.app/',
        'https://nevermined.app/oauth/authorize?network=live',
        'https://api.live.nevermined.app',
      ],
      ['http://localhost:3001', 'https://nevermined.app/oauth/authorize', 'http://localhost:3001'],
    ])('NVM_BACKEND_URL=%s → %s, issuer %s', async (backend, expected, issuer) => {
      const urls = await load(backend)
      expect(urls.authorizationUri).toBe(expected)
      // #463: a custom deployment's issuer is ITS backend's origin — a local stack included.
      expect(urls.issuer).toBe(issuer)
    })
  })
})
