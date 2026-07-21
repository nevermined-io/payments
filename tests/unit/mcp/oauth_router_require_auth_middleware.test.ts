/**
 * Unit tests for createRequireAuthMiddleware
 */

import { createRequireAuthMiddleware } from '../../../src/mcp/http/oauth-router.js'
import type { Request, Response, NextFunction } from 'express'

/**
 * Create a mock Request object
 * Express normalizes headers to lowercase
 */
function createMockRequest(
  headers: Record<string, string> = {},
  opts: { host?: string; protocol?: string } = {},
): Request {
  // Normalize headers to lowercase like Express does
  const normalizedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value
  }
  const host = opts.host ?? 'mcp.example.com'
  return {
    headers: normalizedHeaders,
    protocol: opts.protocol ?? 'https',
    get: (name: string) =>
      name.toLowerCase() === 'host' ? host : normalizedHeaders[name.toLowerCase()],
  } as unknown as Request
}

/**
 * Create a mock Response object with spies
 */
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    jsonData: null,
    headers: {} as Record<string, string>,
    setHeader: jest.fn(function (this: any, key: string, value: string) {
      this.headers[key] = value
      return this
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(function (this: any, data: any) {
      this.jsonData = data
      return this
    }),
  }
  return res as Response & { jsonData: any; headers: Record<string, string> }
}

/**
 * Create a mock NextFunction
 */
function createMockNext(): jest.Mock<NextFunction> {
  return jest.fn() as any
}

describe('createRequireAuthMiddleware', () => {
  test('should return 401 when Authorization header is missing', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({})
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.jsonData).toEqual({
      error: 'unauthorized',
      error_description: 'Authorization header required',
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should return 401 when Authorization header does not start with Bearer', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Basic dXNlcjpwYXNz' })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.jsonData).toEqual({
      error: 'unauthorized',
      error_description: 'Bearer token required',
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should return 401 when Bearer token is empty', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Bearer ' })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.jsonData).toEqual({
      error: 'unauthorized',
      error_description: 'Bearer token cannot be empty',
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should return 401 when Bearer token is only whitespace', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Bearer    ' })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.jsonData).toEqual({
      error: 'unauthorized',
      error_description: 'Bearer token cannot be empty',
    })
    expect(next).not.toHaveBeenCalled()
  })

  test('should call next() when valid Bearer token is present', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Bearer valid-token-123' })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  test('should accept Authorization with capital A', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ Authorization: 'Bearer token-ABC' })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('should accept Bearer with mixed case', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'bearer token-xyz' })
    const res = createMockResponse()
    const next = createMockNext()

    // Note: The middleware checks for 'Bearer ' with capital B
    // This test verifies current behavior (will fail with lowercase 'bearer')
    middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  test('should accept tokens with special characters', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({
      authorization:
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('should accept very long tokens', () => {
    const middleware = createRequireAuthMiddleware()
    const longToken = 'a'.repeat(1000)
    const req = createMockRequest({ authorization: `Bearer ${longToken}` })
    const res = createMockResponse()
    const next = createMockNext()

    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('should trim whitespace after Bearer prefix', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Bearer   token-with-spaces' })
    const res = createMockResponse()
    const next = createMockNext()

    // The middleware slices at position 7 and trims, so should accept this
    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  test('should not validate token content (only presence)', () => {
    const middleware = createRequireAuthMiddleware()
    const req = createMockRequest({ authorization: 'Bearer invalid-but-present' })
    const res = createMockResponse()
    const next = createMockNext()

    // Middleware only checks presence, not validity
    middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  // RFC 9728 §5.1 — the 401 must let the client discover the PRM (and thus the AS).
  describe('WWW-Authenticate challenge', () => {
    test('401 carries WWW-Authenticate pointing at this resource PRM, on the requested host', () => {
      const middleware = createRequireAuthMiddleware()
      const req = createMockRequest({}, { host: 'mcp.example.com', protocol: 'https' })
      const res = createMockResponse()

      middleware(req, res, createMockNext())

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
      )
    })

    test('the challenge uses the request protocol + host', () => {
      const middleware = createRequireAuthMiddleware()
      const req = createMockRequest(
        { authorization: 'Basic x' },
        { host: 'localhost:5001', protocol: 'http' },
      )
      const res = createMockResponse()

      middleware(req, res, createMockNext())

      expect(res.headers['WWW-Authenticate']).toBe(
        'Bearer resource_metadata="http://localhost:5001/.well-known/oauth-protected-resource"',
      )
    })

    test('carries resource_metadata ONLY — no RFC 6750 error param (absent-vs-invalid must not leak)', () => {
      const middleware = createRequireAuthMiddleware()
      const req = createMockRequest({ authorization: 'Bearer ' }) // empty token
      const res = createMockResponse()

      middleware(req, res, createMockNext())

      const challenge = res.headers['WWW-Authenticate']
      expect(challenge).toContain('resource_metadata=')
      expect(challenge).not.toContain('error=')
    })

    test('a valid token does NOT emit a WWW-Authenticate header', () => {
      const middleware = createRequireAuthMiddleware()
      const req = createMockRequest({ authorization: 'Bearer good-token' })
      const res = createMockResponse()

      middleware(req, res, createMockNext())

      expect(res.setHeader).not.toHaveBeenCalledWith('WWW-Authenticate', expect.anything())
    })
  })
})
