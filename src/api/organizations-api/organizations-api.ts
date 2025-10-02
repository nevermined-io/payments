import { PaymentsError } from '../../common/payments.error.js'
import { PaymentOptions } from '../../common/types.js'
import { BasePaymentsAPI } from '../base-payments.js'
import { API_URL_CONNECT_STRIPE_ACCOUNT, API_URL_CREATE_USER, API_URL_GET_MEMBERS } from '../nvm-api.js'
import { CreateUserResponse, OrganizationMemberRole, OrganizationMembersResponse, StripeCheckoutResult } from './types.js'

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
   * Connect user with Stripe
   * @param userEmail - The email of the user
   * @param userCountryCode - The country code of the user
   * @param returnUrl - The return URL after the Stripe connection is completed
   * @returns The Stripe checkout result
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
