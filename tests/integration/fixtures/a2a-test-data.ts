/**
 * @file A2A Integration Test Fixtures
 * @description Test data and scenarios for A2A integration tests
 */

import { v4 as uuidv4 } from 'uuid'

// Test Messages
export const TEST_MESSAGE ={
  messageId: uuidv4(),
  role: 'user' as const,
  parts: [{ kind: 'text' as const, text: 'Hello world' }],
}

// Test HTTP Contexts
export const TEST_HTTP_CONTEXTS = {
  VALID: {
    bearerToken: 'test-token',
    urlRequested: 'http://localhost:3000/a2a/',
    httpMethodRequested: 'POST',
    validation: { balance: { isSubscriber: true } },
  },
  
  INVALID_TOKEN: {
    bearerToken: 'invalid-token',
    urlRequested: 'http://localhost:3000/a2a/',
    httpMethodRequested: 'POST',
    validation: { balance: { isSubscriber: false } },
  }
}

// Test Push Notification Configs
export const TEST_PUSH_NOTIFICATION_CONFIG = {
  url: 'http://localhost:4001/webhook',
  token: 'test-token-abc',
  authentication: {
    credentials: 'test-token-abc',
    schemes: ['bearer'],
  },
} 

// Factory Functions
export class TestDataFactory {
  /**
   * Creates a test message with custom text
   */
  static createMessage(text: string = 'Test message', overrides: any = {}) {
    return {
      messageId: uuidv4(),
      role: 'user' as const,
      parts: [{ kind: 'text' as const, text }],
      ...overrides,
    }
  }

  /**
   * Creates a test HTTP context with custom token
   */
  static createHttpContext(token: string = 'test-token', overrides: any = {}) {
    return {
      bearerToken: token,
      urlRequested: 'http://localhost:3000/a2a/',
      httpMethodRequested: 'POST',
      validation: { balance: { isSubscriber: true } },
      ...overrides,
    }
  }

  /**
   * Creates a JSON-RPC request
   */
  static createJsonRpcRequest(method: string, params: any, id?: number) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      method,
      params,
    }
  }

  /**
   * Creates a push notification config
   */
  static createPushNotificationConfig(url: string, token: string = 'test-token') {
    return {
      url,
      token,
      authentication: {
        credentials: token,
        schemes: ['bearer'],
      },
    }
  }
} 