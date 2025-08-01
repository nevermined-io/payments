/**
 * @file A2A Integration Test Fixtures
 * @description Test data and scenarios for A2A integration tests
 */

import { v4 as uuidv4 } from 'uuid'

// Test Messages
export const TEST_MESSAGES = {
  BASIC: {
    messageId: uuidv4(),
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello world' }],
  },
  
  WITH_CONTEXT: {
    messageId: uuidv4(),
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello with context' }],
    contextId: 'test-context-id',
  },
  
  WITH_METADATA: {
    messageId: uuidv4(),
    role: 'user' as const,
    parts: [{ kind: 'text' as const, text: 'Hello with metadata' }],
    metadata: { testKey: 'testValue' },
  },
  
  MULTIPLE_PARTS: {
    messageId: uuidv4(),
    role: 'user' as const,
    parts: [
      { kind: 'text' as const, text: 'First part' },
      { kind: 'text' as const, text: 'Second part' }
    ],
  },
  
  EMPTY_PARTS: {
    messageId: uuidv4(),
    role: 'user' as const,
    parts: [],
  },
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
  },
  
  CUSTOM_VALIDATION: {
    bearerToken: 'custom-token',
    urlRequested: 'http://localhost:3000/a2a/',
    httpMethodRequested: 'POST',
    validation: { 
      balance: { 
        isSubscriber: true,
        credits: 100 
      } 
    },
  },
}

// Test JSON-RPC Requests
export const TEST_JSON_RPC_REQUESTS = {
  VALID_MESSAGE: {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: TEST_MESSAGES.BASIC,
    },
  },
  
  BLOCKING_REQUEST: {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      configuration: {
        blocking: true,
      },
      message: TEST_MESSAGES.BASIC,
    },
  },
  
  NON_BLOCKING_REQUEST: {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      configuration: {
        blocking: false,
      },
      message: TEST_MESSAGES.BASIC,
    },
  },
  
  INVALID_MISSING_MESSAGE: {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {},
  },
  
  INVALID_MISSING_MESSAGE_ID: {
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'test' }],
      },
    },
  },
}

// Test Push Notification Configs
export const TEST_PUSH_NOTIFICATION_CONFIGS = {
  BASIC: {
    url: 'http://localhost:4001/webhook',
    token: 'test-token-abc',
    authentication: {
      credentials: 'test-token-abc',
      schemes: ['bearer'],
    },
  },
  
  CUSTOM: {
    url: 'http://localhost:4002/webhook',
    token: 'custom-token-xyz',
    authentication: {
      credentials: 'custom-token-xyz',
      schemes: ['bearer'],
    },
  },
  
  ERROR: {
    url: 'http://localhost:4001/webhook',
    token: 'test-token-error',
    authentication: {
      credentials: 'test-token-error',
      schemes: ['bearer'],
    },
  },
}

// Test Scenarios
export const TEST_SCENARIOS = {
  BASIC_MESSAGE_PROCESSING: {
    name: 'Basic message processing',
    message: TEST_MESSAGES.BASIC,
    httpContext: TEST_HTTP_CONTEXTS.VALID,
    expectedState: 'completed',
  },
  
  BLOCKING_REQUEST: {
    name: 'Blocking request with credit validation',
    message: TEST_MESSAGES.BASIC,
    httpContext: TEST_HTTP_CONTEXTS.VALID,
    configuration: { blocking: true },
    expectedState: 'completed',
  },
  
  NON_BLOCKING_REQUEST: {
    name: 'Non-blocking request with polling',
    message: TEST_MESSAGES.BASIC,
    httpContext: TEST_HTTP_CONTEXTS.VALID,
    configuration: { blocking: false },
    expectedState: 'submitted',
  },
  
  PUSH_NOTIFICATION: {
    name: 'Push notification configuration and delivery',
    message: TEST_MESSAGES.BASIC,
    httpContext: TEST_HTTP_CONTEXTS.VALID,
    pushNotificationConfig: TEST_PUSH_NOTIFICATION_CONFIGS.BASIC,
  },
  
  ERROR_INVALID_TOKEN: {
    name: 'Error handling with invalid token',
    message: TEST_MESSAGES.BASIC,
    httpContext: TEST_HTTP_CONTEXTS.INVALID_TOKEN,
    expectedError: 'Invalid token or insufficient balance',
  },
}

// Test Error Cases
export const TEST_ERROR_CASES = {
  PAYMENTS_SERVICE_ERROR: {
    name: 'Payments service throws error',
    setup: (paymentsService: any) => {
      paymentsService.requests.startProcessingRequest.mockRejectedValue(
        new Error('Payment service error')
      )
    },
    expectedError: 'Payment service error',
  },
  
  AGENT_EXECUTOR_ERROR: {
    name: 'Agent executor throws error',
    setup: (agentExecutor: any) => {
      agentExecutor.execute.mockRejectedValue(
        new Error('Agent execution error')
      )
    },
    expectedError: 'Agent execution error',
  },
  
  INVALID_BEARER_TOKEN: {
    name: 'Invalid bearer token',
    httpContext: TEST_HTTP_CONTEXTS.INVALID_TOKEN,
    expectedError: 'Invalid token or insufficient balance',
  },
  
  MISSING_MESSAGE: {
    name: 'Missing message parameter',
    params: {},
    expectedError: {
      code: -32602,
      message: 'message is required.',
    },
  },
  
  MISSING_MESSAGE_ID: {
    name: 'Missing messageId',
    params: {
      message: {
        role: 'user',
        parts: [{ kind: 'text', text: 'test' }],
      },
    },
    expectedError: {
      code: -32602,
      message: 'message.messageId is required.',
    },
  },
}

// Test Agent Cards
export const TEST_AGENT_CARDS = {
  BASIC: {
    name: 'Test A2A Agent',
    description: 'Test agent for A2A integration tests',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3000',
    version: '1.0.0',
  },
  
  WITH_PAYMENT_EXTENSION: {
    name: 'Test A2A Agent with Payment',
    description: 'Test agent with payment extension',
    capabilities: {
      streaming: true,
      pushNotifications: true,
      stateTransitionHistory: true,
      extensions: [
        {
          uri: 'urn:nevermined:payment',
          params: { 
            agentId: 'test-agent-id',
            paymentType: 'fixed',
            credits: 10
          },
        },
      ],
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [],
    url: 'http://localhost:3000',
    version: '1.0.0',
  },
}

// Test Task States
export const TEST_TASK_STATES = {
  SUBMITTED: 'submitted',
  WORKING: 'working',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

// Test Response Templates
export const TEST_RESPONSES = {
  VALID_TASK: {
    jsonrpc: '2.0',
    result: {
      kind: 'task',
      id: 'test-task-id',
      contextId: 'test-context-id',
      status: {
        state: 'completed',
        message: {
          kind: 'message',
          role: 'agent',
          messageId: 'test-message-id',
          parts: [{ kind: 'text', text: 'Request completed successfully!' }],
          taskId: 'test-task-id',
          contextId: 'test-context-id',
        },
        timestamp: new Date().toISOString(),
      },
      history: [TEST_MESSAGES.BASIC],
      metadata: {},
    },
  },
  
  JSON_RPC_ERROR: {
    jsonrpc: '2.0',
    error: {
      code: -32602,
      message: 'Invalid params',
    },
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