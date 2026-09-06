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
  /**
   * Charge amount in USD cents (at least `100`, i.e. $1.00). The API validates
   * the upper bound (`BCK.ORDER.0001`); a deployment may enforce a lower
   * per-order cap (`BCK.ORDER.0003`).
   */
  amountMinor: number
  /** ISO currency, lower-cased. Phase 1 is USD-only; defaults to `'usd'`. */
  currency?: 'usd'
  /** Human-readable description of the charge (max 1024 chars). */
  description?: string
  /** Opaque merchant-supplied buyer reference, e.g. the merchant's own order id (max 255 chars). */
  buyerRef?: string
  /**
   * Idempotency key (max 255 chars). A retry with the same key returns the
   * original Order unchanged (and its `clientSecret` while the Order is still
   * payable); the other fields of the retry are ignored, not merged. A retry
   * with a different `amountMinor` or `currency` is refused with `BCK.ORDER.0007`.
   */
  idempotencyKey?: string
  /** Cart line items — merchant-defined structure, recorded verbatim (keys are not transformed), opaque to the API. */
  lineItems?: Array<Record<string, unknown>>
  /** Merchant-defined metadata, recorded verbatim (keys are not transformed), opaque to the API. */
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
 * This client is the merchant's: a `Payments` instance is always constructed
 * with an NVM API key. The buyer never needs one — the buyer's browser confirms
 * the `clientSecret` with Stripe.js and can poll `GET /api/v1/orders/:id`
 * directly, which is why {@link OrdersAPI.getOrder} sends no key on that call.
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
   *   (Connect account / PaymentIntent failure, no money moved). A refusal
   *   without a catalogue code (e.g. a gateway or throttle response) carries
   *   `http_<status>` instead.
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
      throw PaymentsError.fromBackend('Unable to create order', await backendError(response))
    }
    return response.json()
  }

  /**
   * Reads the buyer-safe view of an Order by id (`GET /api/v1/orders/:id`).
   *
   * @remarks
   * The endpoint is anonymous — the unguessable id is the sole access control —
   * so this call sends no API key (the `Payments` instance still needs one to
   * be constructed). The response never includes the merchant identity or the
   * fee, and carries `clientSecret` only while the Order is payable.
   *
   * @param orderId - The unguessable Order id returned by {@link createOrder}.
   * @returns @see {@link Order}
   * @throws PaymentsError with code `BCK.ORDER.0002` when no Order has this id.
   *   The read endpoint is rate-limited — all anonymous callers behind one IP
   *   share a bucket of 60 requests per minute — and a throttled call carries
   *   no catalogue code, so it surfaces as code `http_429`. That is distinct
   *   from the create-side velocity cap `BCK.ORDER.0010`; poll sparingly and
   *   back off on `http_429`.
   * @example
   * ```
   *  const order = await payments.orders.getOrder(orderId)
   *  if (order.status === 'paid') fulfil(order)
   * ```
   */
  public async getOrder(orderId: string): Promise<Order> {
    const query = API_URL_GET_ORDER.replace(':orderId', encodeURIComponent(orderId))
    const url = new URL(query, this.environment.backend)
    const response = await fetch(url, this.getPublicHTTPOptions('GET'))
    if (!response.ok) {
      throw PaymentsError.fromBackend('Unable to get order', await backendError(response))
    }
    return response.json()
  }
}

/**
 * Backend error envelope with an `http_<status>` fallback `code`, so a refusal
 * that is not an `NVMException` (the read endpoint's throttle is a Nest
 * `ThrottlerException` with no `code`) is still branchable by callers instead
 * of collapsing to the generic `payments_error`. A catalogue `code` in the body
 * always wins. Same convention as the Python SDK's `PaymentsError.from_response`.
 */
async function backendError(response: Response): Promise<Record<string, unknown>> {
  const body = (await safeParseJson(response)) as Record<string, unknown>
  return { code: `http_${response.status}`, ...body }
}
