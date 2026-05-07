/**
 * @file Jest globalSetup for the E2E suite.
 *
 * Runs once, before any e2e suite, against the same staging environment the
 * tests use. We resolve the backend URL from the same `EnvironmentName` the
 * fixtures rely on so a future swap to e.g. `staging_live` keeps working
 * without touching this file.
 *
 * Anything that fails inside the bootstrap is logged and swallowed — the test
 * suite then runs as before. See `helpers/legal-consent.ts` for the rationale.
 */

import { Environments, type EnvironmentName } from '../../src/environments.js'
import { BUILDER_API_KEY, SUBSCRIBER_API_KEY, TEST_ENVIRONMENT } from './fixtures.js'
import { bootstrapLegalConsent } from './helpers/legal-consent.js'

/**
 * Resolve the backend URL for the e2e environment. We re-read TEST_ENVIRONMENT
 * here instead of reusing the resolved constant from fixtures.ts so that an
 * unknown value (typo, future name) degrades to a no-op with a clear warning
 * instead of crashing the whole suite.
 */
export default async function globalSetup(): Promise<void> {
  const envName = (process.env.TEST_ENVIRONMENT as EnvironmentName) || TEST_ENVIRONMENT
  const backendUrl = Environments[envName]?.backend

  if (!backendUrl) {
    console.warn(
      `[legal-consent] unknown TEST_ENVIRONMENT="${envName}", skipping consent bootstrap.`,
    )
    return
  }

  await bootstrapLegalConsent(backendUrl, [SUBSCRIBER_API_KEY, BUILDER_API_KEY])
}
