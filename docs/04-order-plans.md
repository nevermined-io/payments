---
sidebar_position: 4
description: How can subscribers order Payment Plans?
---

# How Can Subscribers Order Payment Plans?

With the Payments Library, subscribers can easily order Payment Plans by paying with crypto. The process is straightforward and secure. The subscriber must have sufficient funds in their wallet to pay for the plan using the token specified by the plan creator. In Nevermined, plan creators can accept payments in any valid ERC20 or native token, depending on the network where the plan is created.

## Ordering a Plan

```typescript
// Here we are ordering the plan created in the previous steps
const orderResult = await payments.plans.orderPlan(planId)
// OUTPUT: orderResult: 
// {
//   txHash: '0x5b95ebaec594b6d87e688faddf85eec3d708e6a06e61864699e5a366af1343f6',
//   success: true
// }
```

## Checking the Balance of a Payment Plan

After a user orders a plan, they can check their balance for that plan. The balance represents the number of credits the user has available to use within the plan.

:::note
Time-based plans provide a balance of 1 credit for subscribers. When the plan expires, this balance will be zero.
:::

```typescript
const balanceResult = await payments.plans.getPlanBalance(planId)
// OUTPUT: balanceResult:
// {
//   planId: '84262690312400469275420649384078993542777341811308941725027729655403981619104',
//   planType: 'credits',
//   holderAddress: '0x8924803472bb453b7c27a3C982A08f7515D7aA72',
//   creditsContract: '0x17FaFabF74312EdaBEB1DB9f0CaAccd44aAFDE39',
//   balance: '100',
//   isSubscriber: true
// }
```
