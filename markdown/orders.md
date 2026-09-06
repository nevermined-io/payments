---
title: "Orders"
description: "Charge an arbitrary amount by card without a payment plan: create a browser-fiat Order and read its status"
icon: "cart-shopping"
---

# Orders

This guide covers browser-fiat **Orders**: a merchant-initiated, off-plan charge for an arbitrary amount (the Stripe PaymentIntent analog) that the buyer's browser confirms client-side. No payment plan, no buyer Nevermined account, no delegation.

## Overview

1. `payments.orders.createOrder(...)` — the merchant creates the Order server-side and receives a Stripe `clientSecret`.
2. The merchant hands the `clientSecret` to its checkout page, which confirms the payment with Stripe.js.
3. `payments.orders.getOrder(orderId)` — anyone holding the unguessable `orderId` reads the buyer-safe status. No API key is sent on the wire.

## Requirements

`createOrder` needs an **organization-scoped** NVM API key: the API resolves the merchant organization from the key's own org tag. A personal key is refused with `BCK.ORDER.0003`, and `payments.setOrganizationId(...)` does not substitute for an org-scoped key. The organization must be active and have a Stripe Connect account able to receive card payments.

## Create an Order

```typescript
import { Payments, EnvironmentName } from '@nevermined-io/payments'

// Initialize with the merchant's organization-scoped API key
const payments = Payments.getInstance({
  nvmApiKey: process.env.NVM_API_KEY!,
  environment: 'sandbox' as EnvironmentName,
})

const { orderId, status, clientSecret } = await payments.orders.createOrder({
  amountMinor: 3437, // USD cents: $34.37
  description: 'Cart checkout - 3 items',
  buyerRef: 'merchant-order-4821',
  idempotencyKey: 'merchant-order-4821',
  lineItems: [{ sku: 'PRO-PLAN', quantity: 1, unit_price: 3437 }],
  metadata: { channel: 'web' },
})

console.log(orderId) // ord_... - the buyer-facing access control
console.log(status) // 'requires_payment'
console.log(clientSecret) // hand this to the browser (Stripe.js confirm)
```

| Option | Type | Description |
|---|---|---|
| `amountMinor` | `number` | Charge amount in USD cents (at least `100`, i.e. $1.00). The API validates the upper bound (`BCK.ORDER.0001`); a deployment may enforce a lower per-order cap (`BCK.ORDER.0003`). |
| `currency` | `'usd'` | ISO currency, lower-cased. Default and only value in Phase 1. |
| `description` | `string` | Optional. Human-readable description (max 1024 chars). |
| `buyerRef` | `string` | Optional. Your own reference for the buyer or cart (max 255 chars). |
| `idempotencyKey` | `string` | Optional. A retry with the same key returns the original Order unchanged (and its `clientSecret` while the Order is still payable); the other fields of the retry are ignored, not merged. A retry with a different `amountMinor` or `currency` is refused with `BCK.ORDER.0007`. |
| `lineItems` | `Record<string, unknown>[]` | Optional. Merchant-defined structure, recorded verbatim (keys are not transformed), opaque to the API. |
| `metadata` | `Record<string, unknown>` | Optional. Merchant-defined structure, recorded verbatim (keys are not transformed), opaque to the API. |
| `captureMode` | `'automatic'` | Optional. The only value in Phase 1. |
| `paymentProvider` | `'stripe'` | Optional. The only value in Phase 1. |

## Read an Order

```typescript
const order = await payments.orders.getOrder(orderId)

console.log(order.status) // 'requires_payment' | 'paid' | 'refunded' | 'partially_refunded' | 'disputed' | 'failed'
console.log(order.amountMinor) // 3437
console.log(order.amountRefundedMinor) // 0
console.log(order.clientSecret) // present only while the Order is payable

if (order.status === 'paid') {
  // fulfil the order
}
```

The read is anonymous on the wire (the unguessable id is the access control) and returns a buyer-safe projection: it never includes the merchant identity, the Connect account or the fee.

The read endpoint is rate-limited: all anonymous callers behind one IP share a bucket of 60 requests per minute. A throttled call throws `PaymentsError` with code `http_429` and no catalogue code (this is not the create-side `BCK.ORDER.0010`). Poll sparingly and back off on `http_429`.

## Order lifecycle

| Status | Meaning |
|---|---|
| `requires_payment` | Created; the browser has not confirmed yet. `clientSecret` is available. |
| `paid` | Payment succeeded. Also the state after a **won** dispute. |
| `failed` | Payment failed, or the PaymentIntent could not be created. No money moved. |
| `refunded` / `partially_refunded` | Refunded in full / in part (see `amountRefundedMinor`). |
| `disputed` | A chargeback is open, or was lost. A won dispute returns the Order to `paid`. |

## Error codes

Errors throw `PaymentsError` with `code` set to the backend catalogue code:

| Code | HTTP | Meaning |
|---|---|---|
| `BCK.ORDER.0001` | 400 | Invalid request (amount out of range, unsupported currency / capture mode / provider). |
| `BCK.ORDER.0002` | 404 | No Order with this id. |
| `BCK.ORDER.0003` | 403 | The key is not an active organization, or the amount exceeds the per-order cap. |
| `BCK.ORDER.0004` | 500 | The merchant has no Connect account able to receive card payments. |
| `BCK.ORDER.0005` | 500 | The PaymentIntent could not be created; the Order is `failed`, no money moved. |
| `BCK.ORDER.0007` | 409 | Idempotency key reused with a different `amountMinor` or `currency`. |
| `BCK.ORDER.0010` | 429 | Velocity cap exceeded on `createOrder`. Retry after backoff. |
| `http_429` | 429 | The `getOrder` read throttle (no catalogue code). Back off and retry. |

A refusal that carries no catalogue code (a throttle or gateway response) surfaces with code `http_<status>`.

```typescript
import { PaymentsError } from '@nevermined-io/payments'

try {
  await payments.orders.createOrder({ amountMinor: 3437 })
} catch (error) {
  if (error instanceof PaymentsError && error.code === 'BCK.ORDER.0010') {
    // back off and retry
  }
  throw error
}
```
