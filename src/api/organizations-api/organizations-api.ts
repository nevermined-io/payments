import { BasePaymentsAPI } from '../base-payments.js'
import { PaymentOptions } from '../../common/types.js'
import { CreateUserResponse, OrganizationMemberRole } from './types.js'
import { PaymentsError } from '../../common/payments.error.js'
import { API_URL_CREATE_USER, API_URL_GET_MEMBERS } from '../nvm-api.js'

export class OrganizationsAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): OrganizationsAPI {
    return new OrganizationsAPI(options)
  }

  /**
   * Create a new user in the organization
   * @param userId - The unique external ID of the user
   * @param userEmail - The email of the user
   * @param userRole - The role of the user
   * @returns The created user
   */
  async createUser(
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

  async getMembers(
    role?: OrganizationMemberRole,
    isActive?: boolean,
    page = 1,
    offset = 100,
    sortBy = 'created',
    sortOrder = 'desc',
  ) {
    const options = this.getBackendHTTPOptions('GET')
    const url = new URL(API_URL_GET_MEMBERS, this.environment.backend)
    role && url.searchParams.set('role', role.toString())
    isActive && url.searchParams.set('isActive', isActive.toString())
    url.searchParams.set('page', page.toString())
    url.searchParams.set('offset', offset.toString())
    url.searchParams.set('sortBy', sortBy)
    url.searchParams.set('sortOrder', sortOrder)

    const response = await fetch(url, options)
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw PaymentsError.fromBackend('Unable to get members', error)
    }

    const data = await response.json()
    return data
  }
}
