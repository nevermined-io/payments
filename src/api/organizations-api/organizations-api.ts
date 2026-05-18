import { PaymentsError } from '../../common/payments.error.js'
import { PaymentOptions } from '../../common/types.js'
import { BasePaymentsAPI } from '../base-payments.js'
import {
  API_URL_CONNECT_STRIPE_ACCOUNT,
  API_URL_CREATE_USER,
  API_URL_GET_MEMBERS,
  API_URL_MY_MEMBERSHIPS,
  API_URL_ORG_ACTIVITY,
} from '../nvm-api.js'
import {
  CreateUserResponse,
  MyMembership,
  OrganizationActivityFilters,
  OrganizationActivityPage,
  OrganizationMemberRole,
  OrganizationMembersResponse,
  StripeCheckoutResult,
} from './types.js'

export class OrganizationsAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): OrganizationsAPI {
    return new OrganizationsAPI(options)
  }

  /**
   * Create a new member in the organization
   * @param userId - The unique external ID of the new member
   * @param userEmail - The email of the new member
   * @param userRole - The role of the new member
   * @returns The created member
   */
  async createMember(
    userId: string,
    userEmail?: string,
    userRole?: OrganizationMemberRole,
  ): Promise<CreateUserResponse> {
    const body = {
      uniqueExternalId: userId,
      email: userEmail,
      role: userRole,
    }
    const options = this.getBackendHTTPOptions('POST', body)
    const url = new URL(API_URL_CREATE_USER, this.environment.backend)
    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to create user', error)
    }

    const data = await response.json()
    return {
      ...data.walletResult,
      nvmApiKey: data.walletResult.hash,
    }
  }

  /**
   *
   * @param role - The role of the members to get
   * @param isActive - The active status of the members to get
   * @param page - The page of the members to get
   * @param offset - The number of members to get per page
   * @returns The list of members
   */
  async getMembers(
    role?: OrganizationMemberRole,
    isActive?: boolean,
    page = 1,
    offset = 100,
  ): Promise<OrganizationMembersResponse> {
    const body = {
      role,
      isActive,
      page,
      offset,
    }
    const url = new URL(API_URL_GET_MEMBERS, this.environment.backend)
    const options = this.getBackendHTTPOptions('POST', body)

    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to get members', error)
    }

    const data = await response.json()
    return {
      members: data.members,
      total: data.totalResults,
    }
  }

  /**
   * Lists every organization the authenticated user is an active member of,
   * with their role and the organization's tier.
   *
   * Powers workspace pickers in third-party tools built on the SDK, and the
   * "where will this publish?" UX when a user belongs to multiple orgs.
   *
   * @returns An array of {@link MyMembership} — empty when the user has no
   *   active memberships and operates as a personal account.
   *
   * @example
   * ```ts
   * const memberships = await payments.organizations.getMyMemberships()
   * for (const m of memberships) {
   *   console.log(`${m.organizationName} — ${m.role}`)
   * }
   * ```
   */
  async getMyMemberships(): Promise<MyMembership[]> {
    const url = new URL(API_URL_MY_MEMBERSHIPS, this.environment.backend)
    const options = this.getBackendHTTPOptions('GET')
    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to fetch memberships', error)
    }
    const data = (await response.json()) as MyMembership[]
    return Array.isArray(data) ? data : []
  }

  /**
   * Lists events emitted into the activity feed of an organization the
   * caller is an active member of (member invites, customer events,
   * subscription transitions, webhook deliveries, …).
   *
   * Requires the caller to be a Member or Admin of `orgId`; the backend
   * returns 403 otherwise. Premium+ entitlement is enforced server-side.
   *
   * @param orgId - The organization id (e.g. `org-…`) whose feed to read.
   * @param filters - Optional filter set — see {@link OrganizationActivityFilters}.
   * @returns A paginated {@link OrganizationActivityPage}.
   *
   * @example
   * ```ts
   * const page = await payments.organizations.getOrganizationActivity(orgId, {
   *   eventType: OrganizationActivityEventType.MemberInvited,
   *   page: 1,
   *   offset: 25,
   * })
   * ```
   */
  async getOrganizationActivity(
    orgId: string,
    filters: OrganizationActivityFilters = {},
  ): Promise<OrganizationActivityPage> {
    if (!orgId) {
      throw new PaymentsError('orgId is required')
    }
    const params = new URLSearchParams()
    if (filters.eventType) params.set('eventType', String(filters.eventType))
    if (filters.actorUserId) params.set('actorUserId', filters.actorUserId)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)
    if (filters.page !== undefined) params.set('page', String(filters.page))
    if (filters.offset !== undefined) params.set('offset', String(filters.offset))

    const path = API_URL_ORG_ACTIVITY.replace(':orgId', encodeURIComponent(orgId))
    const queryString = params.toString()
    const url = new URL(queryString ? `${path}?${queryString}` : path, this.environment.backend)
    const options = this.getBackendHTTPOptions('GET')
    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to fetch organization activity', error)
    }
    return (await response.json()) as OrganizationActivityPage
  }

  /**
   * Connect user with Stripe
   * @param userEmail - The email of the user
   * @param userCountryCode - The country code of the user
   * @param returnUrl - The return URL after the Stripe connection is completed
   * @returns The Stripe checkout result including the stripe account link, stripe account id, user id, user country code, link created at and link expires at.
   * The stripe account link is the link that the user needs to click to connect with Stripe.
   */
  async connectStripeAccount(userEmail: string, userCountryCode: string, returnUrl: string): Promise<StripeCheckoutResult> {
    const body = {
      userEmail,
      userCountryCode,
      returnUrl,
    }
    const url = new URL(API_URL_CONNECT_STRIPE_ACCOUNT, this.environment.backend)
    const options = this.getBackendHTTPOptions('POST', body)
    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to connect with Stripe', error)
    }
    const data = await response.json()
    return {
      stripeAccountLink: data.stripeAccountLink,
      stripeAccountId: data.stripeAccountId,
      userId: data.userId, userCountryCode:
      data.userCountryCode,
      linkCreatedAt: data.linkCreatedAt,
      linkExpiresAt: data.linkExpiresAt
    }
  }
}
