import { Payments } from '../../src/payments.js'
import type { EnvironmentName } from '../../src/environments.js'

export const TEST_ENVIRONMENT: EnvironmentName =
  (process.env.TEST_ENVIRONMENT as EnvironmentName) || 'staging_sandbox'
export const ERC20_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

/**
 * Enterprise org on staging-sandbox where both fixture accounts are members
 * (`Testing Merchant` as Admin, `Testing Buyer` as Member). Plans / agents
 * registered against this org bypass the personal-account caps (cap=10) and
 * use the Enterprise-tier unlimited cap instead.
 *
 * Override via `TEST_BUILDER_ORG_ID` if a different org should own the
 * resources for a CI run.
 */
export const TEST_BUILDER_ORG_ID =
  process.env.TEST_BUILDER_ORG_ID || 'org-031a0329-ebe2-444e-ac2a-1637f694ad0b'

// Subscriber identity: `testing-buyer@nevermined.io`
// (`0x4d4C9FaAF66fb56294640fC32968317Dad8ed8ed`)
export const SUBSCRIBER_API_KEY =
  process.env.TEST_SUBSCRIBER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDRkNEM5RmFBRjY2ZmI1NjI5NDY0MGZDMzI5NjgzMTdEYWQ4ZWQ4ZWQiLCJqdGkiOiIweGZjNzU1N2Q0NGNmNjEzYjI0OWRjNjZkYjk1ZGMyZmNiMmM5MTUxM2M1YmYxMWZkNjEzYmE2YTM3ZjA1ZWJmN2MiLCJleHAiOjQ5MzUxMzE2OTcsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.kwvQxOC0XLMXQlVOSQiGgr7iggma1X5QIu46odHXzp5zwNav1PQfR3j6xW1KgkVFt0tHHRjVuzVBPHG2Dahbnhw'

// Builder identity: `testing-merchant@nevermined.io`
// (`0x34D7F20f9630244adFb4cd4840cd510F7FFA73C8`), Admin of the Enterprise org.
export const BUILDER_API_KEY =
  process.env.TEST_BUILDER_API_KEY ||
  'sandbox-staging:eyJhbGciOiJFUzI1NksifQ.eyJpc3MiOiIweDU4MzhCNTUxMmNGOWYxMkZFOWYyYmVjY0IyMGViNDcyMTFGOUIwYmMiLCJzdWIiOiIweDM0RDdGMjBmOTYzMDI0NGFkRmI0Y2Q0ODQwY2Q1MTBGN0ZGQTczQzgiLCJqdGkiOiIweGNiZGVhMzE2OTgzYTJjOWYyNDVlYzQyZWI3MjJiNmM4ZDkxNTM2ZmYwOGNmM2QyNTg5ZjBkN2VmMGZlNjA0NTMiLCJleHAiOjQ5MzUxMzE2MjQsIm8xMXkiOiJzay1oZWxpY29uZS13amUzYXdpLW5ud2V5M2EtdzdndnY3YS1oYmh3bm1pIn0.gmI-i6GlwA0t__X1Ql5kBAjxViDas-cVY3WuNW5oTAh5I-CuALkIxznF468bfNvnwImAfgc2GrJ_PSnLJg3F7xw'

// Factory functions
export function createPaymentsSubscriber() {
  return Payments.getInstance({
    nvmApiKey: SUBSCRIBER_API_KEY,
    environment: TEST_ENVIRONMENT,
    organizationId: TEST_BUILDER_ORG_ID,
  })
}

export function createPaymentsBuilder() {
  return Payments.getInstance({
    nvmApiKey: BUILDER_API_KEY,
    environment: TEST_ENVIRONMENT,
    organizationId: TEST_BUILDER_ORG_ID,
  })
}
