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
 *
 * Shape mirrors `MyMembershipDto` in the Nevermined backend
 * (`apps/api/src/organizations/dto/my-membership.dto.ts`).
 */
export type MyMembership = {
  /** Stable organization id (e.g. `org-…`). */
  orgId: string
  /** Display name of the organization. */
  orgName: string
  /** Caller's role inside this organization. */
  role: OrganizationMemberRole
  /** Tier of the organization — see {@link OrganizationType}. */
  orgType: OrganizationType
  /** Whether the caller is an Admin of this organization. */
  isAdmin: boolean
  /**
   * `true` when the org has at least one `organizationSubscription` row —
   * the org has previously been associated with a paid tier (active,
   * past_due, trialing, lapsed, or canceled). Combined with
   * `orgType === Lapsed` it distinguishes "subscription expired" from
   * "free org that never subscribed".
   */
  hasSubscriptionHistory: boolean
}

/**
 * Event types emitted into the organization activity feed. Values mirror
 * the backend enum in `@nevermined-io/commons`. Stored on the wire as
 * dot-namespaced lowercase strings — the SDK accepts any string for
 * forward-compatibility when new event types are introduced server-side.
 */
export enum OrganizationActivityEventType {
  // Membership lifecycle
  MemberInvited = 'member.invited',
  MemberJoined = 'member.joined',
  MemberRoleChanged = 'member.role_changed',
  MemberDeactivated = 'member.deactivated',
  MemberReactivated = 'member.reactivated',
  MemberRemoved = 'member.removed',
  InvitationRevoked = 'invitation.revoked',
  InvitationExpired = 'invitation.expired',
  // Resource lifecycle
  AgentCreated = 'agent.created',
  PlanCreated = 'plan.created',
  PlanPurchased = 'plan.purchased',
  // Customer lifecycle
  CustomerAdded = 'customer.added',
  CustomerBlocked = 'customer.blocked',
  CustomerUnblocked = 'customer.unblocked',
  // Subscription lifecycle
  SubscriptionUpgraded = 'subscription.upgraded',
  SubscriptionDowngraded = 'subscription.downgraded',
  SubscriptionCanceled = 'subscription.canceled',
  SubscriptionLapsed = 'subscription.lapsed',
  // Webhook delivery
  WebhookDelivered = 'webhook.delivered',
  WebhookFailed = 'webhook.failed',
}

/**
 * The resource an activity event is about. `kind` describes the resource
 * type (`plan`, `agent`, `member`, `subscription`, `invitation`, `customer`,
 * `webhook`) and `id` is the resource's identifier. Extras vary by kind —
 * e.g. invitations include `role` + `email`, members include `role` +
 * `userId`, subscriptions include `tier`.
 */
export type OrganizationActivityEventSubject = {
  kind: string
  id: string
  [key: string]: unknown
}

/**
 * A single event emitted into the organization activity feed. Shape mirrors
 * `OrganizationActivityEventResponseDto` in the Nevermined backend.
 */
export type OrganizationActivityEvent = {
  /** Activity event ID (e.g. `ae-{uuid}`). */
  id: string
  /**
   * Backend-emitted event type. Use {@link OrganizationActivityEventType}
   * for known values; the field stays a plain string so a new server-side
   * event type doesn't break consumers.
   */
  eventType: OrganizationActivityEventType | string
  /** User who triggered the event, or `null` for system-emitted events. */
  actorUserId: string | null
  /** Resource the event is about — see {@link OrganizationActivityEventSubject}. */
  subject: OrganizationActivityEventSubject
  /** Optional payload (e.g. previous/current values on role/status changes). */
  metadata: Record<string, unknown> | null
  /** ISO-8601 timestamp of when the event occurred. */
  occurredAt: string
}

/**
 * Paginated page of activity events. The backend only echoes `items` and
 * `total`; `page` / `limit` are not in the response — they're the values
 * the caller asked for in {@link OrganizationActivityFilters}.
 */
export type OrganizationActivityPage = {
  items: OrganizationActivityEvent[]
  total: number
}

/** Filters accepted by `OrganizationsAPI.getOrganizationActivity`. */
export type OrganizationActivityFilters = {
  /**
   * Restrict to one or more event types. Accepts a single string, an enum
   * value, or an array (sent to the backend as a comma-separated list).
   */
  eventType?: OrganizationActivityEventType | string | Array<OrganizationActivityEventType | string>
  /** Restrict to events triggered by a specific user. */
  actorUserId?: string
  /** ISO-8601 lower bound (inclusive) on `occurredAt`. */
  from?: string
  /** ISO-8601 upper bound (exclusive) on `occurredAt`. */
  to?: string
  /** Page number — 1-based. */
  page?: number
  /** Page size — backend cap is 200. */
  limit?: number
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
