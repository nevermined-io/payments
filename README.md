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

### Initialize the payments library (standalone)

```typescript
const payments = Payments.getInstance({ 
        nvmApiKey: myBuilderNvmApiKey,
        environment: "testing",        
      })
```

### Initialize the payments library (browser)

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

### Create a plan

Once the app is initialized we can create a credits plan:

```typescript
await paymentsBuilder.createCreditsPlan({
        name: 'E2E Payments Plan', 
        description: 'description', 
        price: 0n, 
        tokenAddress: ERC20_ADDRESS,
        amountOfCredits: 100
      })
```
