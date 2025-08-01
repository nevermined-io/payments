# E2E Tests

This directory contains end-to-end tests for the A2A payments system, refactored to improve readability, maintainability, and organization.

## Structure

```
tests/e2e/
├── README.md                           # This file
├── a2a.e2e.test.ts                    # Main A2A E2E tests
├── payments.e2e.test.ts               # Payments E2E tests
└── helpers/
    └── a2a-e2e-helpers.ts             # A2A E2E test helpers
```

## Tests Overview

### A2A E2E Tests (`a2a.e2e.test.ts`)

End-to-end tests for the A2A (Agent-to-Agent) protocol with real HTTP requests:

#### Server and Client Flow Tests
- **Server startup**: Verifies A2A server starts successfully with valid options
- **Client registration**: Tests client registration and retrieval through Payments.a2a.getClient
- **Multiple client handling**: Tests handling of multiple client registrations

#### Payment Processing Tests
- **Message processing**: Tests A2A message processing through the client (expects failure due to non-existent agent/plan)
- **Invalid request handling**: Tests graceful handling of invalid message requests

#### Static Utilities Tests
- **Agent card building**: Tests building payment agent cards using static methods
- **Integration flow**: Tests integration of agent cards with A2A flow

#### Error Handling Tests
- **Client registration errors**: Tests error handling for invalid client registration parameters

## Helpers

### A2A E2E Helpers (`helpers/a2a-e2e-helpers.ts`)

Provides utilities for A2A E2E tests:

#### Configuration
- `E2E_TEST_CONFIG`: Centralized configuration (timeouts, API keys, environment)
- `E2E_TEST_DATA`: Static test data for different agent cards

#### Main Classes
- `A2AE2EFactory`: Factory functions for creating test components
  - `createTestExecutor()`: Creates a test executor that simulates A2A agent behavior
  - `createPaymentMetadata()`: Creates payment metadata for testing
  - `createTestMessage()`: Creates test messages

- `A2AE2EUtils`: Utilities for test operations
  - `wait()`: Waits for a specified amount of time
  - `createPaymentsInstance()`: Creates a Payments instance for testing

- `A2AE2EAssertions`: Reusable assertion helpers
  - `assertValidServerResult()`: Validates server result structure
  - `assertValidClient()`: Validates client structure and methods
  - `assertValidAgentCard()`: Validates agent card structure
  - `assertPaymentErrorThrown()`: Validates that payment errors are thrown

- `A2AE2EServerManager`: Server management for cleanup
  - `addServer()`: Adds a server to the managed list
  - `cleanup()`: Cleans up all servers

#### Basic Usage
```typescript
import { 
  A2AE2EFactory,
  A2AE2EUtils,
  A2AE2EAssertions,
  A2AE2EServerManager 
} from './helpers/a2a-e2e-helpers.js'

describe('A2A E2E', () => {
  let payments: any
  let serverManager: A2AE2EServerManager

  beforeAll(() => {
    payments = A2AE2EUtils.createPaymentsInstance()
    serverManager = new A2AE2EServerManager()
  })

  afterAll(async () => {
    await serverManager.cleanup()
  })

  it('should start server', async () => {
    const serverResult = payments.a2a.start({
      port: 3001,
      agentCard: E2E_TEST_DATA.BASE_AGENT_CARD,
      executor: A2AE2EFactory.createTestExecutor(),
    })

    A2AE2EAssertions.assertValidServerResult(serverResult)
    serverManager.addServer(serverResult)
  })
})
```

## Key Improvements in Refactored Version

### Better Organization
- **Modular helpers**: Reusable components for common test operations
- **Centralized configuration**: All test configuration in one place
- **Consistent assertions**: Standardized validation methods

### Enhanced Server Management
- **Automated cleanup**: Automatic cleanup of all servers after tests
- **Server tracking**: Proper tracking of all created servers
- **Resource management**: Better management of test resources

### Improved Test Data
- **Predefined agent cards**: Reusable agent card configurations
- **Factory functions**: Easy creation of test components
- **Consistent data**: Standardized test data across all tests

### Better Error Handling
- **Graceful failures**: Tests handle expected failures gracefully
- **Clear assertions**: Specific assertions for different scenarios
- **Error validation**: Proper validation of error conditions

## Running Tests

```bash
# Run all E2E tests
npm test -- tests/e2e/

# Run specific tests
npm test -- tests/e2e/a2a.e2e.test.ts
npm test -- tests/e2e/payments.e2e.test.ts

# Run with coverage
npm test -- tests/e2e/ --coverage
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
      const testData = A2AE2EFactory.createSomething()
      
      // Act
      const result = await handler.process(testData)
      
      // Assert
      A2AE2EAssertions.assertSomething(result)
    })
  })
})
```

### Timeouts
- **Individual tests**: Use `E2E_TEST_CONFIG.TIMEOUT`
- **Setup/teardown**: Use appropriate timeouts for slow operations
- **Server startup**: Wait for servers to be ready before testing

## Troubleshooting

### Common Issues

1. **Port conflicts**: Change ports in test data if conflicts occur
2. **Timeouts**: Adjust `E2E_TEST_CONFIG.TIMEOUT` for slow environments
3. **API keys**: Configure environment variables or use fallbacks in `E2E_TEST_CONFIG`
4. **Server cleanup**: Ensure servers are properly cleaned up after tests

### Debugging
- Use `console.log` in helpers for debugging
- Check server logs for A2A server issues
- Monitor network requests for HTTP-related problems
- Review error messages for specific failure reasons 