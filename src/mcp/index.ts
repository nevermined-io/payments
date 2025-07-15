import { z } from "zod";

/**
 * Options to initialize the MCP server integration with Nevermined Payments.
 * @typedef {Object} PaymentsMCPServerOptions
 * @property {any} mcpServer - Instance of FastMCP server
 * @property {any} paymentsService - Instance of Payments
 * @property {Record<string, any>=} tools - Optional: additional or custom tools to register
 */
export interface PaymentsMCPServerOptions {
  mcpServer: any; // FastMCP server instance
  paymentsService: any; // Payments instance
  tools?: Record<string, any>; // Optional: additional or custom tools
}

/**
 * Result of initializing the MCP server integration with Nevermined Payments.
 * @typedef {Object} PaymentsMCPServerResult
 * @property {string[]} registeredTools - List of registered tool names
 */
export interface PaymentsMCPServerResult {
  registeredTools: string[];
}

/**
 * Class to integrate Nevermined Payments with MCP (FastMCP) servers.
 * Automatically registers all the necessary tools for payment management, access tokens, plan purchase, etc.
 *
 * @class PaymentsMCPServer
 */
export class PaymentsMCPServer {
  /**
   * Registers Nevermined tools in the MCP server.
   *
   * @param {PaymentsMCPServerOptions} options - Configuration options
   * @returns {PaymentsMCPServerResult} - Result with registered tool names
   *
   * @example
   * ```typescript
   * PaymentsMCPServer.start({
   *   mcpServer,
   *   paymentsService,
   *   tools: { /* custom tools *\/ }
   * })
   * ```
   */
  static start({
    mcpServer,
    paymentsService,
    tools = {},
  }: PaymentsMCPServerOptions): PaymentsMCPServerResult {
    const registeredTools: string[] = [];

    // Tool: Obtain agent access token (secure proxy)
    mcpServer.addTool({
      name: "getAgentAccessTokenProxy",
      description: "Obtain a Nevermined agent access token using your API Key (never stored).",
      parameters: z.object({
        nvmApiKey: z.string().min(10, "API Key required"),
        planId: z.string().min(1, "Plan ID required"),
        agentId: z.string().min(1, "Agent ID required"),
      }),
      /**
       * @param args - Arguments containing the user's API Key, planId, and agentId
       * @returns {Promise<object>} - Agent access credentials
       */
      execute: async (args: any) => {
        const userPayments = paymentsService.constructor.getInstance({
          ...paymentsService.config,
          nvmApiKey: args.nvmApiKey,
        });
        return await userPayments.agents.getAgentAccessToken(args.planId, args.agentId);
      },
      ...tools.getAgentAccessTokenProxy,
    });
    registeredTools.push("getAgentAccessTokenProxy");

    // Tool: List all payment plans associated with an agent
    mcpServer.addTool({
      name: "listAgentPlans",
      description: "List all payment plans associated with an agent.",
      parameters: z.object({
        agentId: z.string().min(1, "Agent ID required"),
      }),
      /**
       * @param args - Arguments containing the agentId
       * @returns {Promise<object>} - List of plans for the agent
       */
      execute: async (args: any) => {
        return await paymentsService.agents.getAgentPlans(args.agentId);
      },
      ...tools.listAgentPlans,
    });
    registeredTools.push("listAgentPlans");

    // Tool: Purchase a payment plan for an agent
    mcpServer.addTool({
      name: "purchasePlan",
      description: "Purchase a payment plan for an agent.",
      parameters: z.object({
        nvmApiKey: z.string().min(10, "API Key required"),
        planId: z.string().min(1, "Plan ID required"),
      }),
      /**
       * @param args - Arguments containing the user's API Key and planId
       * @returns {Promise<object>} - Result of the purchase operation
       */
      execute: async (args: any) => {
        const userPayments = paymentsService.constructor.getInstance({
          ...paymentsService.config,
          nvmApiKey: args.nvmApiKey,
        });
        return await userPayments.plans.orderPlan(args.planId);
      },
      ...tools.purchasePlan,
    });
    registeredTools.push("purchasePlan");

    return { registeredTools };
  }
} 