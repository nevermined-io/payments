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

## Using the Payments Library

The library provides methods to manage AI Agents, Plans & process AI Agent Requests.
Additionally to it, the library provides an integration with Google Agent2Agent (A2A) framework, allowing AI Agents to communicate with each other and using Nevermined as payment and access control.

Each of these functionalities is encapsulated in its own API class:

* `plans`: Manages AI Plans, including registration and ordering and retrieving plan details.
* `agents`: Handles AI Agents, including registration of AI Agents and access token generation.
* `requests`: Manages requests received by AI Agents, including validation and tracking.
* `a2a`: Exposes A2A agent/server functionality for this Payments instance.

