import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { resolveOrgIdInteractive } from '../../src/utils/orgs.js'

type FakeMembership = {
  orgId: string
  orgName: string
  role: string
  orgType: string
  isAdmin: boolean
  hasSubscriptionHistory: boolean
}

const makeMembership = (overrides: Partial<FakeMembership>): FakeMembership => ({
  orgId: 'org-1',
  orgName: 'Acme',
  role: 'Admin',
  orgType: 'Company',
  isAdmin: true,
  hasSubscriptionHistory: false,
  ...overrides,
})

const makePayments = (memberships: FakeMembership[]) =>
  ({
    organizations: {
      getMyMemberships: jest.fn<() => Promise<FakeMembership[]>>().mockResolvedValue(memberships),
    },
  }) as unknown as Parameters<typeof resolveOrgIdInteractive>[0]['payments']

describe('resolveOrgIdInteractive', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('honours --org and skips the membership lookup entirely', async () => {
    const payments = makePayments([])
    const result = await resolveOrgIdInteractive({
      payments,
      flagOrgId: 'org-flag-wins',
      log: () => undefined,
      isTTY: true,
    })
    expect(result).toEqual({ orgId: 'org-flag-wins', orgName: '' })
    expect(
      (
        payments as unknown as {
          organizations: { getMyMemberships: jest.Mock }
        }
      ).organizations.getMyMemberships,
    ).not.toHaveBeenCalled()
  })

  test('throws a member-only message when the user has no memberships', async () => {
    const payments = makePayments([])
    await expect(
      resolveOrgIdInteractive({ payments, log: () => undefined, isTTY: true }),
    ).rejects.toThrow(/only available to members of an organization/i)
  })

  test('silently uses the single membership when exactly one exists', async () => {
    const payments = makePayments([makeMembership({ orgId: 'org-only', orgName: 'Only' })])
    const logged: string[] = []
    const result = await resolveOrgIdInteractive({
      payments,
      log: (m) => logged.push(m),
      isTTY: true,
    })
    expect(result).toEqual({ orgId: 'org-only', orgName: 'Only' })
    // Should not have printed the interactive picker when only one is
    // available — surprises the user in CI.
    expect(logged.join('\n')).not.toMatch(/Select an organization/)
  })

  test('requires --org in non-TTY mode when the user has multiple memberships', async () => {
    const payments = makePayments([
      makeMembership({ orgId: 'org-a', orgName: 'A' }),
      makeMembership({ orgId: 'org-b', orgName: 'B' }),
    ])
    await expect(
      resolveOrgIdInteractive({ payments, log: () => undefined, isTTY: false }),
    ).rejects.toThrow(/Pass --org/)
  })

  test('promotes flagOrgId over interactive picker even when multiple memberships exist', async () => {
    const payments = makePayments([
      makeMembership({ orgId: 'org-a', orgName: 'A' }),
      makeMembership({ orgId: 'org-b', orgName: 'B' }),
    ])
    const result = await resolveOrgIdInteractive({
      payments,
      flagOrgId: 'org-b',
      log: () => undefined,
      isTTY: false,
    })
    // Note: by design we do NOT cross-check the flagged orgId against
    // memberships locally — the backend's `isOrganizationMember` is the
    // ground truth. The 403 from the backend is the right place to fail.
    expect(result).toEqual({ orgId: 'org-b', orgName: '' })
  })
})
