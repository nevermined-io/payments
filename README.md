[![banner](https://raw.githubusercontent.com/nevermined-io/assets/main/images/logo/banner_logo.png)](https://nevermined.io)

# Typescript SDK to interact with the Nevermined Payments Protocol

> Typescript SDK to interact with the Nevermined Payments Protocol
> [nevermined.io](https://nevermined.io)

## Quickstart

```
# yarn
yarn add @nevermined-io/payments

# npm

npm install @nevermined-io/payments
```

### Initialize the payments library

This is a browser only method. Here we have an example using react.
For a full example please refer to [payments-nextjs-example](https://github.com/nevermined-io/tutorials/tree/main/payments-nextjs-example)

```typescript
import { useEffect } from "react";
import { Payments } from "@nevermined-io/payments";

export default function Home() {
  const payments = new Payments({
    returnUrl: "http://localhost:8080",
    environment: "staging",
  });

  const onLogin = () => {
    payments.connect();
  };

  useEffect(() => {
    payments.init();
  }, []);

  return (
    <main>
      <div>
        <button onClick={onLogin}>Login</button>
      </div>
    </main>
  );
}
```

The `init()` method should be called immediately after the app returns the user to `returnUrl`.

### Create a Payments Plan

Once the app is initialized we can create a payment plan:

```typescript
const planDID = await payments.createCreditsPlan({
    name: "My AI Payments Plan",
    description: "AI stuff",
    price: 10000000n,
    tokenAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    amountOfCredits: 30,
    tags: ["test"]
  })
```

### Create an AI Agent/Service

```typescript
const agentEndpoints: Endpoint[] = [
  { 'POST': `https://example.com/api/v1/agents/(.*)/tasks` },
  { 'GET': `https://example.com/api/v1/agents/(.*)/tasks/(.*)` }
]
   
const agentDID = await paymentsBuilder.createService({
  planDID,
  name: 'E2E Payments Agent',
  description: 'description', 
  serviceType: 'agent',
  serviceChargeType: 'fixed',
  authType: 'bearer',
  token: 'changeme',
  amountOfCredits: 1,
  endpoints: agentEndpoints,
  openEndpoints: ['https://example.com/api/v1/rest/docs-json']
})
```

