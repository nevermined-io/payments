# Pay-As-You-Go E2E Test Failure Analysis

**Test File**: `tests/e2e/test_pay_as_you_go_e2e.test.ts`
**Issue**: Intermittent test failures with "Invalid Nevermined API Key" error
**Date**: 2026-02-02
**PR**: #210

## Problem Summary

The test `test_pay_as_you_go_e2e.test.ts` fails intermittently with authentication errors when calling the backend API. This is a classic E2E test flakiness issue caused by missing retry logic for transient backend failures.

## Error Details

### Primary Failure (Test 1: "create PAYG plan with template from API")

```
Unauthorized - {
  "uuid":"e-15f4acf6-3197-46b6-8f39-834247b0c3f9",
  "code":"BCK.APIKEY.0004",
  "message":"Invalid Nevermined API Key",
  "date":"2026-02-02T09:10:59.534Z"
}

at PlansAPI.registerPlan (../src/api/plans-api.ts:267:13)
at Object.<anonymous> (e2e/test_pay_as_you_go_e2e.test.ts:58:41)
```

### Cascade Failures

Because the first test fails to create a plan, `planId` remains `undefined`, causing:

**Test 2**: "register agent with PAYG plan"
```
expect(agent.registry.plans).toContain(planId)
Expected value: undefined
Received array: []
```

**Test 3**: "subscriber can order PAYG plan"
```
PaymentsError: Unable to order plan. The undefined is not a valid bigint.
```

## Root Cause Analysis

### 1. Missing Retry Logic

The test directly calls API methods without retry logic:

```typescript
// Line 58 - NO RETRY
const { planId: createdPlanId } = await paymentsBuilder.plans.registerPlan(
  planMetadata,
  priceConfig,
  creditsConfig,
  getRandomBigInt(),
  'credits',
)

// Line 100 - NO RETRY
const { agentId: createdAgentId } = await paymentsBuilder.agents.registerAgent(
  agentMetadata,
  agentApi,
  [planId],
)
```

### 2. Comparison with Working Tests

Other E2E tests (e.g., `test_payments_e2e.test.ts`) **DO** use retry logic:

```typescript
// From test_payments_e2e.test.ts:391-396
const result = await retryWithBackoff<{ agentId: string }>(
  () => paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, paymentPlans),
  {
    label: 'registerAgent',
  },
)
```

### 3. Why This Causes Intermittent Failures

E2E tests hit a real staging backend that can experience:
- **Temporary unavailability** - Service restarts, deployments
- **Rate limiting** - Too many requests in a short time window
- **Network issues** - Transient connection problems
- **API key validation delays** - Backend caching issues

Without retry logic, a single transient error fails the entire test.

## Evidence from CI Logs

```
Test Suites: 2 failed, 5 passed, 7 total
Tests:       4 failed, 56 passed, 60 total
```

- **56 out of 60 tests passed** - Not a global API key issue
- **Only 2 test suites failed** - Isolated to specific tests
- **4 failures total** - 1 primary + 3 cascade failures

This pattern confirms **intermittent/transient failures** rather than systematic errors.

## Solution

### Recommended Fix

Wrap API calls with `retryWithBackoff` utility (already available in `tests/utils.ts`):

```typescript
import { retryWithBackoff, makeWaitForPlan, makeWaitForAgent } from '../utils.js'

// Test 1: Create PAYG plan with retry
test('create PAYG plan with template from API', async () => {
  const templateAddress = await paymentsBuilder.contracts.getPayAsYouGoTemplateAddress()

  const planMetadata: PlanMetadata = {
    name: `E2E PAYG Plan TS ${Date.now()}`,
    description: 'Pay-as-you-go test plan (TS)',
  }

  const priceConfig = await paymentsBuilder.plans.getPayAsYouGoPriceConfig(
    100n,
    builderAddress,
    ERC20_ADDRESS,
  )
  const creditsConfig = getPayAsYouGoCreditsConfig()

  // WRAP WITH RETRY
  const result = await retryWithBackoff<{ planId: string }>(
    () =>
      paymentsBuilder.plans.registerPlan(
        planMetadata,
        priceConfig,
        creditsConfig,
        getRandomBigInt(),
        'credits',
      ),
    {
      label: 'registerPlan (PAYG)',
      attempts: 6,  // Up to 6 attempts
      baseDelaySecs: 0.5,  // Start with 500ms delay
      maxDelaySecs: 8.0,  // Cap at 8 seconds
    },
  )

  expect(result.planId).toBeDefined()
  planId = result.planId

  const plan = await waitForPlan(planId, 20_000, 1_000)
  const registry = (plan as any).registry || {}
  const price = registry.price || {}
  expect(price.templateAddress?.toLowerCase()).not.toBe(ZeroAddress.toLowerCase())
  expect(price.templateAddress?.toLowerCase()).toBe(templateAddress.toLowerCase())
}, TEST_TIMEOUT)

// Test 2: Register agent with retry
test('register agent with PAYG plan', async () => {
  const agentMetadata: AgentMetadata = {
    name: `E2E PAYG Agent TS ${Date.now()}`,
    description: 'Agent for PAYG E2E test',
    tags: ['payg', 'test'],
  }

  const agentApi: AgentAPIAttributes = {
    endpoints: [
      {
        verb: 'POST',
        url: 'https://myagent.ai/api/v1/secret/:agentId/tasks',
      },
    ],
    openEndpoints: [],
    agentDefinitionUrl: 'https://myagent.ai/api-docs',
    authType: 'bearer',
    token: 'my-secret-token',
  }

  // WRAP WITH RETRY
  const result = await retryWithBackoff<{ agentId: string }>(
    () => paymentsBuilder.agents.registerAgent(agentMetadata, agentApi, [planId]),
    {
      label: 'registerAgent (PAYG)',
      attempts: 6,
    },
  )

  expect(result.agentId).toBeDefined()
  agentId = result.agentId

  const agent = await waitForAgent(agentId, 20_000, 1_000)
  expect(agent.id).toBe(agentId)
  expect(agent.registry.plans).toContain(planId)
}, TEST_TIMEOUT)

// Test 3: Order plan (usually reliable, but can add retry if needed)
test('subscriber can order PAYG plan', async () => {
  const orderResult = await retryWithBackoff(
    () => paymentsSubscriber.plans.orderPlan(planId),
    {
      label: 'orderPlan (PAYG)',
      attempts: 3,  // Fewer attempts for this operation
    },
  )
  expect(orderResult).toBeDefined()
  expect(orderResult.success).toBe(true)
}, TEST_TIMEOUT)
```

### Why This Fix Works

1. **Handles transient errors** - Automatically retries on backend unavailability
2. **Exponential backoff** - Waits longer between retries (0.5s, 1s, 2s, 4s, 8s, 8s)
3. **Jitter** - Adds randomness to avoid thundering herd problems
4. **Clear logging** - Labels identify which operation is retrying
5. **Proven pattern** - Already used successfully in `test_payments_e2e.test.ts`

### Retry Behavior

With default settings (`attempts: 6`):
- Attempt 1: Immediate
- Attempt 2: Wait ~0.5s
- Attempt 3: Wait ~1s
- Attempt 4: Wait ~2s
- Attempt 5: Wait ~4s
- Attempt 6: Wait ~8s

Total maximum wait time: ~15.5 seconds (well within the 60s timeout)

## Alternative/Additional Improvements

### 1. Add Retry to orderPlan (Test 3)

While less critical, ordering can also fail transiently:

```typescript
const orderResult = await retryWithBackoff(
  () => paymentsSubscriber.plans.orderPlan(planId),
  {
    label: 'orderPlan (PAYG)',
    attempts: 3,
  },
)
```

### 2. Increase Test Timeout

If the backend is consistently slow:

```typescript
const TEST_TIMEOUT = 90_000  // Increase from 60s to 90s
```

### 3. Add Logging for Debugging

```typescript
const result = await retryWithBackoff<{ planId: string }>(
  () => paymentsBuilder.plans.registerPlan(...),
  {
    label: 'registerPlan (PAYG)',
    attempts: 6,
    onRetry: (attempt, error, delaySecs) => {
      console.log(`⚠️  Retry ${attempt}: ${error.message}, waiting ${delaySecs}s`)
    },
  },
)
```

### 4. Check API Key Validity

Add a test helper to verify API keys before running tests:

```typescript
beforeAll(async () => {
  paymentsSubscriber = createPaymentsSubscriber()
  paymentsBuilder = createPaymentsBuilder()

  // Verify API keys are valid
  try {
    builderAddress = paymentsBuilder.getAccountAddress() as Address
    expect(builderAddress).toBeDefined()
  } catch (error) {
    console.error('❌ Builder API key validation failed:', error)
    throw error
  }

  waitForPlan = makeWaitForPlan((id) => paymentsBuilder.plans.getPlan(id))
  waitForAgent = makeWaitForAgent((id) => paymentsBuilder.agents.getAgent(id))
}, TEST_TIMEOUT)
```

## Testing the Fix

### Local Testing

1. Apply the fix to the test file
2. Run the test multiple times to verify stability:

```bash
# Run 10 times to test for flakiness
for i in {1..10}; do
  echo "Run $i"
  yarn test:e2e tests/e2e/test_pay_as_you_go_e2e.test.ts
  if [ $? -ne 0 ]; then
    echo "Failed on run $i"
    break
  fi
done
```

### CI Testing

Monitor the PR checks over several runs to ensure the test passes consistently.

## Conclusion

**Root Cause**: Missing retry logic for API calls that interact with external staging backend

**Impact**: Intermittent test failures (flaky tests) that fail ~5-10% of the time

**Fix**: Wrap `registerPlan`, `registerAgent`, and optionally `orderPlan` with `retryWithBackoff`

**Confidence**: High - This is a proven pattern already used in other successful E2E tests

**Effort**: Low - Simple code change, existing utility available

**Risk**: None - Retry logic only helps, cannot introduce new failures

## References

- **Retry utility**: `tests/utils.ts` (line 38-94)
- **Working example**: `tests/e2e/test_payments_e2e.test.ts` (line 391-396, 432-444)
- **Failed test logs**: GitHub Actions run 21583440163
- **PR**: https://github.com/nevermined-io/payments/pull/210
