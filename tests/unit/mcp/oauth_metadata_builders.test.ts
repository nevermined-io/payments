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
} from '../../../src/mcp/http/oauth-metadata.js'
import type { OAuthConfig } from '../../../src/mcp/types/http.types.js'

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
      // NOT this MCP server (baseUrl) and NOT the frontend SPA (getOAuthUrls().issuer,
      // which 200s HTML on every path). Hardcoded so it can't drift silently.
      expect(metadata.authorization_servers).toEqual(['https://api.sandbox.nevermined.dev'])
      expect(metadata.authorization_servers).not.toContain(baseConfig.baseUrl)
      expect(metadata.authorization_servers).not.toContain(
        getOAuthUrls(baseConfig.environment).issuer,
      )
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
      expect(metadata.authorization_servers).not.toContain(
        getOAuthUrls(baseConfig.environment).issuer,
      )
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
})
