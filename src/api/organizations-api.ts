import { BasePaymentsAPI } from './base-payments.js'
import { OrganizationMemberRole, PaymentOptions } from '../common/types.js'
import { PaymentsError } from '../common/payments.error.js'
import { API_URL_CREATE_USER } from './nvm-api.js'

export class OrganizationsAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): OrganizationsAPI {
    return new OrganizationsAPI(options)
  }

  async createUser(userId: string, userEmail?: string, userRole?: OrganizationMemberRole) {
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
    return data
  }
}
