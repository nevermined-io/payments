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
   * That triple plus the requested `tokenVersion` is the cache key.
   * It derives the Agent Card path when needed.
   *
   * `tokenVersion` is part of the key rather than ignored on a hit: it decides
   * whether the client mints a single-use, seller-bound token per paid call or
   * caches one reusable token for its lifetime. Keying without it would hand a
   * caller who asked for v3 a client that mints v2 — the security control
   * dropped silently, with nothing on the returned client to detect it — and,
   * in the other direction, would put a caller who wanted the cached v2 path on
   * per-call v3 mints because someone else asked first.
   *
   * @param options - ClientRegistryOptions with agentBaseUrl, agentId, planId (all required).
   * @returns The PaymentsClient instance
   */
  public async getClient(options: ClientRegistryOptions): Promise<PaymentsClient> {
    const { agentBaseUrl, agentId, planId, agentCardPath, delegationConfig, tokenVersion } =
      options
    if (!agentBaseUrl || !agentId || !planId) {
      throw PaymentsError.validation('Missing required fields')
    }

    const key = `${agentBaseUrl}::${agentId}::${planId}::v${tokenVersion ?? 'default'}`
    let client = this.clients.get(key)
    if (!client) {
      client = await PaymentsClient.create(
        agentBaseUrl,
        this.payments,
        agentId,
        planId,
        agentCardPath,
        delegationConfig,
        tokenVersion,
      )
      this.clients.set(key, client)
    }
    return client
  }
}
