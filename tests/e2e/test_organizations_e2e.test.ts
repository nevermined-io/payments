/**
 * End-to-end coverage for the multi-org workspace surface added in PR #342.
 *
 * Runs against staging-sandbox using the `Testing Merchant` fixture identity,
 * which is an Admin of the Enterprise org `Nevermined Testing`. The tests
 * verify the three building blocks the SDK now exposes:
 *
 *   1. `getMyMemberships()` returns the org the caller belongs to with the
 *       backend-defined shape (orgId / orgName / role / orgType / isAdmin).
 *   2. Pinning the workspace via `setOrganizationId(orgId)` routes a publish
 *       into that org — the resulting plan carries the org id.
 *   3. The per-call `{ organizationId }` override on a publish method does the
 *       same thing for a single call, without mutating the instance pin.
 *
 * `getOrganizationActivity` is exercised as a smoke read; the assertion is
 * only that the call returns a paginated shape (the activity stream of the
 * shared test org is non-deterministic).
 */

import {
  OrganizationActivityEventType,
  OrganizationMemberRole,
  OrganizationType,
  Payments,
} from '../../src/index.js'
import { getCryptoPriceConfig, getFixedCreditsConfig } from '../../src/plans.js'
import { BUILDER_API_KEY, TEST_BUILDER_ORG_ID, TEST_ENVIRONMENT } from './fixtures.js'

jest.setTimeout(60_000)

describe('Organizations E2E — workspace surface', () => {
  // Build a fresh client with no pinned workspace so we can drive
  // `setOrganizationId` ourselves.
  const unpinned = Payments.getInstance({
    nvmApiKey: BUILDER_API_KEY,
    environment: TEST_ENVIRONMENT,
  })

  test('getMyMemberships() returns the Enterprise test org with the backend DTO shape', async () => {
    const memberships = await unpinned.organizations.getMyMemberships()

    expect(Array.isArray(memberships)).toBe(true)
    expect(memberships.length).toBeGreaterThan(0)

    const m = memberships.find((x) => x.orgId === TEST_BUILDER_ORG_ID)
    expect(m).toBeDefined()
    expect(m!.orgName).toBeTruthy()
    expect(m!.orgType).toBe(OrganizationType.Enterprise)
    expect([OrganizationMemberRole.Admin, OrganizationMemberRole.Member]).toContain(m!.role)
    expect(typeof m!.isAdmin).toBe('boolean')
    expect(typeof m!.hasSubscriptionHistory).toBe('boolean')
  })

  test('setOrganizationId() routes a published plan into the target org', async () => {
    unpinned.setOrganizationId(TEST_BUILDER_ORG_ID)
    expect(unpinned.getOrganizationId()).toBe(TEST_BUILDER_ORG_ID)

    const builderAddress = unpinned.getAccountAddress() as `0x${string}`
    const priceConfig = getCryptoPriceConfig(0n, builderAddress)
    const creditsConfig = getFixedCreditsConfig(100n, 1n)

    const { planId } = await unpinned.plans.registerPlan(
      { name: `E2E orgs setOrganizationId ${new Date().toISOString()}` },
      priceConfig,
      creditsConfig,
    )
    expect(planId).toBeTruthy()

    // Confirm via the back-end's plan read endpoint that the plan landed
    // in the pinned org.
    const plan = await unpinned.plans.getPlan(planId)
    expect(plan?.orgId).toBe(TEST_BUILDER_ORG_ID)

    // Clear the pin so the next test starts from a known state.
    unpinned.setOrganizationId(null)
    expect(unpinned.getOrganizationId()).toBeNull()
  })

  test('per-call `{ organizationId }` override targets the org without mutating the instance pin', async () => {
    expect(unpinned.getOrganizationId()).toBeNull()

    const builderAddress = unpinned.getAccountAddress() as `0x${string}`
    const priceConfig = getCryptoPriceConfig(0n, builderAddress)
    const creditsConfig = getFixedCreditsConfig(100n, 1n)

    const { planId } = await unpinned.plans.registerPlan(
      { name: `E2E orgs per-call override ${new Date().toISOString()}` },
      priceConfig,
      creditsConfig,
      undefined,
      undefined,
      { organizationId: TEST_BUILDER_ORG_ID },
    )
    expect(planId).toBeTruthy()

    const plan = await unpinned.plans.getPlan(planId)
    expect(plan?.orgId).toBe(TEST_BUILDER_ORG_ID)
    expect(unpinned.getOrganizationId()).toBeNull()
  })

  test('getOrganizationActivity() returns a paginated page (smoke read)', async () => {
    const page = await unpinned.organizations.getOrganizationActivity(TEST_BUILDER_ORG_ID, {
      page: 1,
      limit: 5,
    })

    expect(page).toBeDefined()
    expect(Array.isArray(page.items)).toBe(true)
    expect(typeof page.total).toBe('number')
    expect(page.items.length).toBeGreaterThan(0)

    const event = page.items[0]
    expect(typeof event.id).toBe('string')
    expect(typeof event.eventType).toBe('string')
    expect(event.subject).toBeDefined()
    expect(typeof event.subject.id).toBe('string')
    expect(typeof event.subject.kind).toBe('string')
    expect(typeof event.occurredAt).toBe('string')
  })

  test('getOrganizationActivity() narrows by eventType', async () => {
    const page = await unpinned.organizations.getOrganizationActivity(TEST_BUILDER_ORG_ID, {
      eventType: OrganizationActivityEventType.PlanCreated,
      page: 1,
      limit: 10,
    })
    expect(page.items.every((e) => e.eventType === OrganizationActivityEventType.PlanCreated)).toBe(
      true,
    )
  })
})
