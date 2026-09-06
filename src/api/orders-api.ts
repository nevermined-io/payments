import { safeParseJson } from '../common/helper.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions } from '../common/types.js'
import { BasePaymentsAPI } from './base-payments.js'
import { API_URL_CREATE_ORDER, API_URL_GET_ORDER } from './nvm-api.js'

/**
 * Buyer-facing lifecycle status of an Order, as published on the wire by the
 * Nevermined API (`WireOrderStatus` in nvm-monorepo
 * `apps/api/src/orders/order-status.ts`).
 */
export type OrderStatus =
  | 'requires_payment'
  | 'paid'
  | 'refunded'
  | 'partially_refunded'
  | 'disputed'
  | 'failed'

/**
 * Body of `POST /api/v1/orders` (`RegisterOrderDto`). The authenticated
 * merchant key sets the price; the seller's Stripe Connect account is
 * resolved server-side and is deliberately NOT part of this contract.
 */
export interface CreateOrderOptions {
  /** Charge amount in USD cents: $1.00 – $999,999.99 (`100` – `99_999_999`). */
  amountMinor: number
  /** ISO currency, lower-cased. Phase 1 is USD-only; defaults to `'usd'`. */
  currency?: 'usd'
  /** Human-readable description of the charge (max 1024 chars). */
  description?: string
  /** Opaque merchant-supplied buyer reference, e.g. the merchant's own order id (max 255 chars). */
  buyerRef?: string
  /** A retried create with the same key returns the same Order + `clientSecret` (max 255 chars). */
  idempotencyKey?: string
  /** Cart line items, recorded verbatim and opaque to the API. */
  lineItems?: Array<Record<string, unknown>>
  /** Opaque merchant metadata, recorded verbatim. */
  metadata?: Record<string, unknown>
  /** Stripe capture mode. Phase 1 supports `'automatic'` only (the default). */
  captureMode?: 'automatic'
  /** Payment Service Provider that settles the Order. Phase 1 implements `'stripe'` only (the default). */
  paymentProvider?: 'stripe'
}

/** Response of `POST /api/v1/orders` (`CreateOrderResponseDto`). */
export interface CreateOrderResult {
  /** Unguessable Order id — the buyer-facing access control for {@link OrdersAPI.getOrder}. */
  orderId: string
  status: OrderStatus
  /** Stripe PaymentIntent client secret the browser confirms against. Present only while the Order is payable. */
  clientSecret?: string
}

/**
 * Buyer-safe view of an Order (`OrderResponseDto`). It never carries the
 * merchant identity, the Connect account or the fee breakdown.
 */
export interface Order {
  /** Unguessable Order id. */
  id: string
  /** Charge amount in USD cents. */
  amountMinor: number
  currency: string
  status: OrderStatus
  /** Total refunded so far, in cents. */
  amountRefundedMinor: number
  description: string | null
  buyerRef: string | null
  /** The Stripe PaymentIntent backing this Order; `null` until it is created. */
  paymentIntentId: string | null
  /** ISO-8601 instant when the Order stops being payable; `null` if it never expires. */
  expiresAt: string | null
  /** Present only while the Order is payable. */
  clientSecret?: string
}

/**
 * The OrdersAPI class wraps the browser-fiat Orders endpoints. An Order is a
 * merchant-initiated, off-plan charge for an arbitrary amount (the Stripe
 * PaymentIntent analog) that the buyer's browser confirms client-side — no
 * plan, no buyer Nevermined account, no delegation.
 *
 * @remarks
 * `createOrder` requires an **organization-scoped** NVM API key: the API reads
 * the merchant organization from the key's own org tag, so a personal key is
 * refused with `BCK.ORDER.0003`. `Payments.setOrganizationId` (the
 * `X-Current-Org-Id` header) does not substitute for an org-scoped key.
 *
 * @see nvm-monorepo `apps/api/src/orders/README.md` (epic #3238)
 */
export class OrdersAPI extends BasePaymentsAPI {
  static getInstance(options: PaymentOptions): OrdersAPI {
    return new OrdersAPI(options)
  }

  /**
   * Creates an Order and its PaymentIntent, returning the `clientSecret` a
   * browser confirms against (`POST /api/v1/orders`).
   *
   * @remarks
   * This method is oriented to merchants. The NVM API Key must be scoped to an
   * active organization whose Stripe Connect account can receive card payments.
   *
   * @param options - @see {@link CreateOrderOptions}. `currency` defaults to `'usd'`.
   * @returns The new Order id, its status and — while payable — the `clientSecret`.
   * @throws PaymentsError carrying the backend catalogue code: `BCK.ORDER.0001`
   *   (invalid request), `BCK.ORDER.0003` (not an active organization / over the
   *   per-order cap), `BCK.ORDER.0007` (idempotency-key conflict),
   *   `BCK.ORDER.0010` (velocity cap — retryable), `BCK.ORDER.0004`/`0005`
   *   (Connect account / PaymentIntent failure, no money moved).
   * @example
   * ```
   *  const { orderId, clientSecret } = await payments.orders.createOrder({
   *    amountMinor: 3437, // $34.37
   *    description: 'Cart checkout — 3 items',
   *    idempotencyKey: 'merchant-order-4821',
   *  })
   * ```
   */
  public async createOrder(options: CreateOrderOptions): Promise<CreateOrderResult> {
    const body = { ...options, currency: options.currency ?? 'usd' }
    const url = new URL(API_URL_CREATE_ORDER, this.environment.backend)
    const response = await fetch(url, this.getBackendHTTPOptions('POST', body))
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to create order', await safeParseJson(response))
    }
    return response.json()
  }

  /**
   * Reads the buyer-safe view of an Order by id (`GET /api/v1/orders/:id`).
   *
   * @remarks
   * The endpoint is anonymous — the unguessable id is the sole access control —
   * so no API key is sent. The response never includes the merchant identity
   * or the fee, and carries `clientSecret` only while the Order is payable.
   *
   * @param orderId - The unguessable Order id returned by {@link createOrder}.
   * @returns @see {@link Order}
   * @throws PaymentsError with code `BCK.ORDER.0002` when no Order has this id.
   * @example
   * ```
   *  const order = await payments.orders.getOrder(orderId)
   *  if (order.status === 'paid') fulfil(order)
   * ```
   */
  public async getOrder(orderId: string): Promise<Order> {
    const query = API_URL_GET_ORDER.replace(':orderId', orderId)
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url, this.getPublicHTTPOptions('GET'))
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to get order', await safeParseJson(response))
    }
    return response.json()
  }
}
