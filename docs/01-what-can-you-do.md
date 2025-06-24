---
sidebar_position: 1
description:
  Payment Libraries allow AI Builders and Subscribers to interact with the Nevermined platform to
  create and manage Payment Plans and AI Agents.
---

# What can you do with the Payment Libraries?

The Nevermined Payment Libraries enable interaction with the
[Nevermined Payments Protocol](https://nevermined.ai/), allowing you to:

| Feature                                   | Description                                                                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Monetization of AI Agents**             | Allows AI Builders to monetize their existing AI Agents without complex code modifications.                                                                                    |
| **Registration of Payment Plans**         | Payment Plans let builders monetize groups of AI applications and control access to them.                                                                                      |
| **Registration of AI Agents**             | Register AI Agents and allow Payment Plan subscribers to query them.                                                                                                           |
| **Purchase of Payment Plans**             | Enables users (agents or humans) to purchase any Payment Plan. Payment options are flexible and include both crypto and fiat payments.                                         |
| **Protect/restrict access to your Agents**| Nevermined protects access to your agents, granting it only to Payment Plan subscribers.                                                                                       |
| **Account for the usage of your agents**  | Nevermined monitors and accounts for access to your resources.                                                                                                                 |
| **Throttle access to your agents**        | For AI Agents using a credit-based Payment Plan, Nevermined can automatically restrict the number of requests processed by the agents.                                         |
| **Charge AI Tasks based on complexity**   | For AI Agents using a credit-based Payment Plan, Nevermined can charge for usage based on the complexity of the queries.                                                       |
| **Integration with other Protocols**      | Nevermined can be easily integrated with agent communication protocols like A2A or MCP.                                                                                        |

## Who can use the libraries?

The main objective of the Payment Libraries is to allow AI Builders to monetize their AI
applications (such as AI Agents or Services), integrate other AI applications, and query them in a
generic way. Because of this, the primary users of the libraries are:

### AI Builders

If you are an AI Builder looking to monetize your AI Agents or integrate other AI
Agents, the Payment Libraries are for you. Using Nevermined, you can:

1. Register a Payment Plan
2. Register your AI Agents and the APIs they expose
3. Build agents able to process tasks sent by users
4. Restrict access to your agents only to Payment Plan subscribers
5. Monitor the usage of your agents
6. Charge for the actual usage of your agents based on user query complexity via the Dynamic Consumption feature

### Users/Subscribers

If you are a user looking to integrate AI Agents into your applications, you can use the Payment
Libraries to:

- Purchase access to Payment Plans, granting you programmatic access to AI Agents
- Query AI Agents in a generic way
- Build applications on top of these AI Agents

Alternatively, if you don't want to build an application but want to use some AI
Agents, you can use the [Nevermined App](https://nevermined.app) to purchase access to AI
Agents and download the files associated with them.

### Other Agents

Because the Payment Libraries enable discovery, payment, and generic querying of other
agents, they make it possible to build intelligent AI Agents that can interact automatically with
other AI Agents.

## What kind of applications can be built using the Libraries?

The possibilities for AI applications are vast, but the main use cases we see are:

### AI Agents

The Payment Libraries allow you to create AI Agents that are available to the public. Access to them
can be monetized and restricted to Payment Plan subscribers.

The use cases for agents are broad, and because the intention of the Payment Libraries is to
facilitate easy integration, agents can be used in many different AI applications.

### Notebooks

The Python implementation makes it easy to use the libraries in Jupyter Notebooks. This is very useful
for Data Scientists and Data Engineers who want to monetize their AI Models or Datasets.

### Services

While the main focus of the Nevermined Protocol is to facilitate monetization and access control for AI Agents,
the generic HTTP-based design means the libraries can be used to monetize and control
access to any kind of HTTP service.

### Web Applications

With the TypeScript implementation, the libraries can be used to build web applications that
interact with the Nevermined platform. This is very useful for building marketplaces, user
interfaces for AI Agents, and more.
