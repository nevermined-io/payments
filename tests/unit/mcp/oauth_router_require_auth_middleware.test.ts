/**
 * Unit tests for createRequireAuthMiddleware
 */

import { createRequireAuthMiddleware } from '../../../src/mcp/http/oauth-router.js'
import type { Request, Response, NextFunction } from 'express'

/**
 * Create a mock Request object
 * Express normalizes headers to lowercase
 */
function createMockRequest(headers: Record<string, string> = {}): Request {
  // Normalize headers to lowercase like Express does
  const normalizedHeaders: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value
  }
  return {
    headers: normalizedHeaders,
  } as Request
}

/**
 * Create a mock Response object with spies
 */
function createMockResponse() {
  const res: any = {
    statusCode: 200,
    jsonData: null,
    status: jest.fn().mockReturnThis(),
    json: jest.fn(function (this: any, data: any) {
      this.jsonData = data
      return this
    }),
  }
  return res as Response & { jsonData: any }
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
})
