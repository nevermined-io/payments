import { Payments } from '../index.ts'
import { PaymentsClient } from './paymentsClient.ts'
import type { ClientRegistryOptions } from './types.ts'

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
   * @param options - ClientRegistryOptions with agentBaseUrl, agentId, planId (all required).
   * @returns The PaymentsClient instance
   */
  public getClient(options: ClientRegistryOptions): PaymentsClient {
    const { agentBaseUrl, agentId, planId } = options
    const key = `${agentBaseUrl}::${agentId}::${planId}`
    let client = this.clients.get(key)
    if (!client) {
      client = new PaymentsClient(agentBaseUrl, this.payments, agentId, planId)
      this.clients.set(key, client)
    }
    return client
  }
}
