# Mintlify API Reference

This document provides a comprehensive reference of how the Payments Library needs to generate valid Markdown documentation that after generated will be copied into the Nevermined Docs Website (Mintlify).

All the documentation must be generated in valid Markdown format and stored in the `markdown` directory.

All the code generated must be in TypeScript and include code examples where applicable. IMPORTANT: The code generated must be tested and verified to work correctly.

IMPORTANT: Use as code reference all the code generated in the `tests` directory of the Payments Library. This code is already tested and verified to work correctly.

IMPORTANT: The documentation must be LLM friendly.It must be clear and concise, avoiding unnecessary complexity. Use simple language and provide examples to illustrate concepts where applicable.

## Table of Contents

The documentation to generate must have the following pages:

1. Installation. Page that describes how to install the library.
2. Initializing the Library. Page that describes how to initialize the library.
3. Payment Plans. Page that describes how to register different types of payment plans.
4. Agents. Page that describes how to register and manage agents.
5. Publishing Static Resources. Page that describes how to publish static resources agents that encapsulate static contents (files, etc). Include examples and how to use wildcards for multiple files urls.
6. Payments and Balance. Understand how to make payments and get the balance of a payment plan.
7. Querying an agent. How to get the x402 access token and make requests to an agent.
8. Validation of Requests. Understand how an agent can receive requests and validate them.
9. MCP. Specific documentation about how to integrate the Payments Library in a MCP server.
10. A2A. Specific documentation about how to integrate the Payments Library in an A2A server.
11. x402. How to generate payment permissions and summary or previous x402 methods

## Section details

### 1. Installation (01-installation.mdx)

This page should include the following sections:

- Overview
- Prerequisites
- Installation Steps

### 2. Initializing the Library (02-initializing-the-library.mdx)

This page should include the following sections:

- Get the NVM API Key from the Nevermined App
- How to import and initialize the library
- Configuration options
- Sandbox and Production environments

### 3. Payment Plans (03-payment-plans.mdx)

Focused on the Plans API class. This page should include the following sections:

- Overview of Payment Plans API
- Types of Payment Plans
- How to configure different types of payment plans
- Registration of Payment Plans
- Get individual plans, plans publised and agents associated to a plan.

### 4. Agents (04-agents.mdx)

Focused on the Agents API class. This page should include the following sections:

- Overview of Agents API
- Register Agents
- Register Agents and Plans at the same time
- Get individual agents, all agents, and agents associated to a plan.
- Update Agents metadata
- Add plans to agents and Remove plans from agents

### 5. Publishing Static Resources (05-publishing-static-resources.mdx)

This page extends the previous one but focused on publishing static resources instead of AI Agents. This page should include the following sections:

- Overview of Publishing Static Resources
- Register Static Resource Agents with multiple files using wildcards
- Examples of Static Resource Agents

### 6. Payments and Balance (06-payments-and-balance.mdx)

This page extends the Plans API page and should include the following sections:

- How to get the balance of a payment plan
- How to make payments to a payment plan
- Code examples for getting balance and making payments

### 7. Querying an agent (07-querying-an-agent.mdx)

This page should include the following sections:

- Explain how is possible to get the x402 access token for an agent
- Code examples of how to make requests to an agent using the x402 access token

### 8. Validation of Requests (08-validation-of-requests.mdx)

This page is focused on how an agent can validate incoming requests. This page should include the following sections:

- Receiving requests in an agent
- Validating requests using the Payments Library integrating the Nevermined Facilitator
- Code examples of validating requests

### 9. MCP (09-mcp-integration.mdx)

This page is focused on how to integrate the Payments Library in a MCP server. This page should include the following sections:

- Overview of MCP integration
- Steps to integrate the Payments Library in a MCP server
- Code examples for MCP integration

### 10. A2A (10-a2a-integration.mdx)

This page is focused on how to integrate the Payments Library in an A2A server. This page should include the following sections:

- Overview of A2A integration
- Steps to integrate the Payments Library in an A2A server
- Code examples for A2A integration

### 11. x402 (11-x402.mdx)

This page is focused in all the x402 and Facilitator related methods. This page should include the following sections:

- Overview of x402
- Generate x402 payment permissions. Reference to the [Nevermined App Permissions page](https://nevermined.app/permissions/agent-permissions) and how the permissions can be generated from there.
- Verify x402 payment permissions
- Settle x402 payments

## Formatting Guidelines

Add in each Markdown page a header that has the Mintlify metadata format. For example:

```text
---                                                                                                                                                                     
title: "Installation"                                                                                                                                                       
description: "Install and configure the @nevermined-io/payments TypeScript SDK"                                                                                             
icon: "download"                                                                                                                                                            
---
```

This header Must be at the very beginning of the file. Follow the rules:

- title - must represent a short and clear title of the page
- description - must be a one or two lines summarizing the page content
- icon - must be a mintlify icon that is displayed properly in the Mintlify left menu
