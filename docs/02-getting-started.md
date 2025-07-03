---
sidebar_position: 2
description: Getting Started and Requirements
---

# Getting Started

## Install the Library

```bash
npm install @nevermined-io/payments
```

## Requirements

### Obtain a Nevermined API Key

To use the Payments libraries, you need to [create a Nevermined API Key](https://docs.nevermined.app/docs/tutorials/integration/nvm-api-keys). This key allows you to interact with the Nevermined platform and create Payment Plans and Agents.

The API Key must be created in the environment where your application will run. For example, if you are running a Python application connected to **"testing"**, create the API Key in the [Nevermined Testing App](https://testing.nevermined.app/). If you want to use the live environment, use the [Nevermined App](https://nevermined.app/).

:::warning
Keep your API Key secure and never share it with anyone.
:::

## Initialize the Payments Instance

```typescript
// To get your own Nevermined API Key, follow the instructions here:
// https://docs.nevermined.app/docs/tutorials/integration/nvm-api-keys  
const nvmApiKey = 'eyJhbGciOiJFUzI1NksifQ.ey .....'

const payments = Payments.getInstance({
  nvmApiKey,
  environment: 'testing', 
})
```
