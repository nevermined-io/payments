import { Payments } from '../index.js'
import { PaymentsClient } from './paymentsClient.js'
import type { ClientRegistryOptions } from './types.js'
import { PaymentsError } from '../common/payments.error.js'

/**
 * Registry for managing multiple PaymentsClient instances by agentId+planId+baseUrl.
 * If a client does not exist for a given combination, it is created and cached.
 */
export class ClientRegistry {
  private clients: Map<string, PaymentsClient> = new Map()
  private payments: Payments

  /**
   * Constructs a ClientRegistry.
   * @param payments - The Payments instance to use for all clients.
   */
  constructor(payments: Payments) {
    this.payments = payments
  }

  /**
   * Gets (or creates) a PaymentsClient for the given agentBaseUrl, agentId, and planId.
   * The combination of these three is used as a unique key.
   * It derives the Agent Card path when needed.
   * @param options - ClientRegistryOptions with agentBaseUrl, agentId, planId (all required).
   * @returns The PaymentsClient instance
   */
  public async getClient(options: ClientRegistryOptions): Promise<PaymentsClient> {
    const { agentBaseUrl, agentId, planId, agentCardPath } = options
    if (!agentBaseUrl || !agentId || !planId) {
      throw PaymentsError.validation('Missing required fields')
    }

    const key = `${agentBaseUrl}::${agentId}::${planId}`
    let client = this.clients.get(key)
    if (!client) {
      client = await PaymentsClient.create(
        agentBaseUrl,
        this.payments,
        agentId,
        planId,
        agentCardPath,
      )
      this.clients.set(key, client)
    }
    return client
  }
}
