export enum OrganizationMemberRole {
  Admin = 'Admin',
  Member = 'Member',
  Client = 'Client',
}

/**
 * Tier of an organization. Mirrors the backend `OrganizationType` enum
 * (`@nevermined-io/commons`). Free orgs were retired (Epic #1339) but the
 * value is kept here for backwards compatibility with historical rows.
 */
export enum OrganizationType {
  Free = 'Free',
  Premium = 'Premium',
  Enterprise = 'Enterprise',
  Lapsed = 'Lapsed',
}

export type CreateUserResponse = {
  nvmApiKey: string
  userId: string
  userWallet: string
  alreadyMember: boolean
}

/**
 * A single organization the authenticated user is an active member of.
 * Returned by `OrganizationsAPI.getMyMemberships()` and used by clients to
 * power workspace pickers and "where will this publish?" UX.
 */
export type MyMembership = {
  /** Stable organization id (e.g. `org-…`). */
  orgId: string
  /** Display name of the organization. */
  organizationName: string
  /** Tier of the organization — see {@link OrganizationType}. */
  organizationType: OrganizationType
  /** Caller's role inside this organization. */
  role: OrganizationMemberRole
  /** Whether the membership row itself is active. */
  userIsActive: boolean
  /** Whether the organization is active (not deactivated by an admin). */
  organizationIsActive: boolean
}

/**
 * Event types emitted into the organization activity feed. Values mirror
 * the backend enum in `@nevermined-io/commons`; the SDK accepts unknown
 * strings for forward-compatibility when new event types are introduced
 * server-side.
 */
export enum OrganizationActivityEventType {
  MemberInvited = 'MEMBER_INVITED',
  MemberAccepted = 'MEMBER_ACCEPTED',
  MemberRoleChanged = 'MEMBER_ROLE_CHANGED',
  MemberDeactivated = 'MEMBER_DEACTIVATED',
  MemberReactivated = 'MEMBER_REACTIVATED',
  MemberRemoved = 'MEMBER_REMOVED',
  CustomerAdded = 'CUSTOMER_ADDED',
  CustomerBlocked = 'CUSTOMER_BLOCKED',
  SubscriptionCreated = 'SUBSCRIPTION_CREATED',
  SubscriptionCanceled = 'SUBSCRIPTION_CANCELED',
  WebhookDelivered = 'WEBHOOK_DELIVERED',
}

/** A single event emitted into the organization activity feed. */
export type OrganizationActivityEvent = {
  id: string
  /** Backend-emitted event type. Use {@link OrganizationActivityEventType} for known values. */
  eventType: OrganizationActivityEventType | string
  orgId: string
  /** User who triggered the event (may be empty for system-emitted events). */
  actorUserId?: string
  /** User the event is about (e.g. member-removed target). */
  targetUserId?: string
  /** Free-form event payload (e.g. webhook delivery status, role transitions). */
  metadata?: Record<string, unknown>
  /** ISO-8601 timestamp. */
  createdAt: string
}

/** Paginated page of activity events. */
export type OrganizationActivityPage = {
  items: OrganizationActivityEvent[]
  total: number
  page: number
  offset: number
}

/** Filters accepted by `OrganizationsAPI.getOrganizationActivity`. */
export type OrganizationActivityFilters = {
  /** Restrict to a specific event type. */
  eventType?: OrganizationActivityEventType | string
  /** Restrict to events triggered by a specific user. */
  actorUserId?: string
  /** ISO-8601 lower-bound (inclusive) on `createdAt`. */
  from?: string
  /** ISO-8601 upper-bound (inclusive) on `createdAt`. */
  to?: string
  /** Page number — 1-based. */
  page?: number
  /** Page size. */
  offset?: number
}

export type OrganizationMember = {
  createdAt: string
  updatedAt: string
  id: string
  userId: string
  orgId: string
  userAddress: string
  role: OrganizationMemberRole
  isActive: boolean
}

export type OrganizationMembersResponse = {
  members: OrganizationMember[]
  total: number
}

export type StripeCheckoutResult = {
  stripeAccountId: string
  stripeAccountLink: string
  userId: string
  userCountryCode: string
  linkCreatedAt: number
  linkExpiresAt: number
}