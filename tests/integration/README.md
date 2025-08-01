# Integration Tests

This directory contains integration tests for the A2A payments system, refactored to improve readability, maintainability, and organization.

## Structure

```
tests/integration/
├── README.md                           # This file
├── a2a.integration.test.ts            # Main A2A tests
├── paymentsRequestHandler.integration.test.ts  # PaymentsRequestHandler tests
├── helpers/
│   ├── a2a-test-helpers.ts            # A2A test helpers
│   └── payments-request-handler-helpers.ts  # PaymentsRequestHandler helpers
└── fixtures/
    └── a2a-test-data.ts               # Reusable test data
```

## Tests Overview

### A2A Integration Tests (`a2a.integration.test.ts`)

Comprehensive integration tests for the A2A (Agent-to-Agent) protocol with payment integration:

#### Setup & Configuration Tests
- **Server startup**: Verifies A2A server starts successfully
- **Agent card exposure**: Tests that agent card is properly exposed at `.well-known/agent.json`
- **Plan and agent registration**: Validates successful registration of payment plans and agents
- **Access token generation**: Ensures proper token generation for agent access

#### Authentication & Authorization Tests
- **Server connectivity**: Basic connectivity and accessibility tests
- **Token validation**: Tests rejection of requests with invalid tokens (402 Payment Required)

#### Message Processing Tests
- **Blocking requests**: Tests synchronous message processing with immediate response
- **Credit validation**: Verifies credit burning during request processing
- **Non-blocking requests**: Tests asynchronous processing with polling for completion
- **Credit tracking**: Validates that credits are properly deducted from user accounts

#### Push Notification Tests
- **Configuration setup**: Tests setting push notification configuration for tasks
- **Configuration retrieval**: Verifies ability to get push notification settings
- **Notification delivery**: Tests that notifications are sent when tasks complete
- **Error handling**: Tests error scenarios for non-existent tasks

#### Error Handling Tests
- **Invalid JSON-RPC**: Tests handling of malformed JSON requests
- **Missing parameters**: Validates proper error responses for missing required parameters

#### Credit Management Tests
- **Credit burning validation**: Ensures correct amount of credits are burned per request
- **Multiple request handling**: Tests credit deduction across multiple requests
- **Concurrent requests**: Validates credit management under concurrent load

### PaymentsRequestHandler Integration Tests (`paymentsRequestHandler.integration.test.ts`)

Integration tests for the PaymentsRequestHandler component that manages payment validation and task execution:

#### Message Validation Tests
- **Invalid message scenarios**: Tests error handling for missing message, messageId, role, and parts
- **Valid message scenarios**: Tests successful processing of messages with different configurations
- **Message structure validation**: Ensures proper JSON-RPC error responses for invalid structures

#### HTTP Context Handling Tests
- **Valid HTTP context**: Tests message processing with proper authentication context
- **Custom validation**: Tests handling of custom validation configurations
- **Bearer token handling**: Tests different token scenarios and validation

#### Service Integration Tests
- **Payments service calls**: Verifies that payment service methods are called correctly
- **Agent executor calls**: Tests that agent executor methods are invoked properly
- **Multiple message processing**: Tests handling of multiple concurrent messages

#### Error Handling Tests
- **Service errors**: Tests handling of payments service failures
- **Executor errors**: Tests handling of agent executor failures
- **Invalid tokens**: Tests scenarios with invalid authentication tokens
- **Missing HTTP context**: Tests error handling when HTTP context is not available

#### Configuration and Customization Tests
- **Custom agent cards**: Tests handler with different agent card configurations
- **Custom task stores**: Tests with different task storage implementations

#### Edge Cases Tests
- **Empty message parts**: Tests handling of messages with empty parts arrays
- **Multiple message parts**: Tests processing of messages with multiple parts
- **Message metadata**: Tests handling of messages with custom metadata

## Helpers

### A2A Test Helpers (`helpers/a2a-test-helpers.ts`)

Provides utilities for A2A integration tests:

#### Configuration
- `TEST_CONFIG`: Centralized configuration (ports, timeouts, API keys)
- `TEST_DATA`: Static test data
- `TaskState`: Enum for task states

#### Main Classes
- `A2ATestContext`: Manages complete test environment setup/teardown
  - `setup()`: Sets up payment plan, agent, A2A server, access token, and webhook server
  - `teardown()`: Cleans up all resources
  - `getPlanBalance()`: Gets current plan balance
  - `validateCreditsBurned()`: Validates credit burning with proper timing
  - `sendMessageAndValidate()`: Sends message and validates response
  - `pollForTaskCompletion()`: Polls for task completion

- `A2ATestFactory`: Factory functions for creating test components
- `A2ATestUtils`: Utilities for polling, waiting, and data creation
- `A2AAssertions`: Reusable assertion helpers
  - `assertValidTaskResponse()`: Validates task response structure
  - `assertTaskState()`: Validates specific task state
  - `assertTaskCompleted()`: Validates completed task with agent message
  - `assertCreditsBurned()`: Validates credit burning
  - `assertJsonRpcError()`: Validates JSON-RPC errors
  - `assertValidAgentCard()`: Validates agent card structure
  - `assertServerAccessible()`: Validates server accessibility
  - `assertPaymentRequired()`: Validates payment required responses

- `WebhookServerManager`: Webhook server management for push notifications
  - `start()`: Starts webhook server
  - `stop()`: Stops webhook server
  - `getWebhookUrl()`: Gets webhook URL
  - `waitForNotification()`: Waits for specific notification

#### Basic Usage
```typescript
import { A2ATestContext, A2ATestUtils, A2AAssertions } from './helpers/a2a-test-helpers.js'

describe('A2A Tests', () => {
  let testContext: A2ATestContext

  beforeAll(async () => {
    testContext = new A2ATestContext()
    await testContext.setup()
  })

  afterAll(async () => {
    await testContext.teardown()
  })

  it('should process message', async () => {
    const message = A2ATestUtils.createTestMessage('Hello world')
    const result = await testContext.sendMessageAndValidate(message)
    A2AAssertions.assertTaskCompleted(result)
  })
})
```

### PaymentsRequestHandler Helpers (`helpers/payments-request-handler-helpers.ts`)

Specific utilities for PaymentsRequestHandler tests:

#### Main Classes
- `PaymentsRequestHandlerFactory`: Factory for creating handler instances
- `PaymentsRequestHandlerTestUtils`: Utilities for test setup
- `PaymentsRequestHandlerAssertions`: Specific assertions
- `PaymentsRequestHandlerTestScenarios`: Predefined test scenarios
- `MockPaymentsService` and `MockAgentExecutor`: Reusable mocks with improved error handling

#### Basic Usage
```typescript
import { 
  PaymentsRequestHandlerFactory,
  PaymentsRequestHandlerTestUtils,
  PaymentsRequestHandlerAssertions 
} from './helpers/payments-request-handler-helpers.js'

describe('PaymentsRequestHandler', () => {
  let handler: any

  beforeEach(() => {
    handler = PaymentsRequestHandlerFactory.create()
  })

  it('should validate message', async () => {
    const testScenario = await PaymentsRequestHandlerTestUtils.createTestScenario()
    const result = await testScenario.handler.sendMessage(testScenario.params)
    PaymentsRequestHandlerAssertions.assertValidTaskResponse(result)
  })
})
```

## Fixtures (`fixtures/a2a-test-data.ts`)

Reusable test data and predefined scenarios:

- `TEST_MESSAGES`: Test messages with different configurations
- `TEST_HTTP_CONTEXTS`: HTTP contexts for different scenarios
- `TEST_JSON_RPC_REQUESTS`: Predefined JSON-RPC requests
- `TEST_SCENARIOS`: Complete test scenarios
- `TEST_ERROR_CASES`: Common error cases
- `TestDataFactory`: Factory functions for creating dynamic data

## Key Improvements in Refactored Version

### Enhanced Credit Management
- **Credit validation**: All tests now validate that credits are properly burned
- **Balance tracking**: Tests track initial and final balances
- **Concurrent handling**: Tests validate credit management under concurrent load

### Improved Error Handling
- **Service error tests**: Tests for payments service failures
- **Executor error tests**: Tests for agent executor failures
- **HTTP context validation**: Tests for missing HTTP context scenarios

### Better Test Organization
- **Modular helpers**: Reusable components for common test operations
- **Centralized configuration**: All test configuration in one place
- **Consistent assertions**: Standardized validation methods

### Enhanced Push Notifications
- **Webhook server management**: Automated webhook server setup/teardown
- **Notification validation**: Tests for push notification delivery
- **Configuration testing**: Tests for push notification setup and retrieval

## Running Tests

```bash
# Run all integration tests
npm test -- tests/integration/

# Run specific tests
npm test -- tests/integration/a2a.integration.test.ts
npm test -- tests/integration/paymentsRequestHandler.integration.test.ts

# Run with coverage
npm test -- tests/integration/ --coverage
```

## Conventions

### Naming
- **Tests**: `should [action] when [condition]`
- **Helpers**: `[ClassName].[methodName]`
- **Constants**: `UPPER_SNAKE_CASE`
- **Enums**: `PascalCase`

### Test Structure
```typescript
describe('Feature', () => {
  describe('Sub-feature', () => {
    it('should do something when condition', async () => {
      // Arrange
      const testData = TestDataFactory.createSomething()
      
      // Act
      const result = await handler.process(testData)
      
      // Assert
      Assertions.assertSomething(result)
    })
  })
})
```

### Timeouts
- **Individual tests**: Use `TEST_CONFIG.TIMEOUT`
- **Setup/teardown**: Use appropriate timeouts for slow operations
- **Polling**: Use `A2ATestUtils.pollForCondition` for intelligent waiting

## Troubleshooting

### Common Issues

1. **Port in use**: Change `TEST_CONFIG.PORT` in helpers
2. **Timeouts**: Adjust `TEST_CONFIG.TIMEOUT` for slow environments
3. **API keys**: Configure environment variables or use fallbacks in `TEST_CONFIG`
4. **Credit validation failures**: Ensure proper timing between credit operations

### Debugging
- Use `console.log` in helpers for debugging
- Check webhook server logs for push notifications
- Review credit balance in payment validation tests
- Monitor server logs for A2A server issues 