/**
 * LangGraph ReAct agent helper that surfaces `PaymentRequiredError` intact.
 *
 * By default `createReactAgent` from `@langchain/langgraph/prebuilt` constructs a
 * `ToolNode` with `handleToolErrors: true` — tool exceptions are caught and
 * rendered into a `ToolMessage` for the LLM. That is convenient for
 * prompt-engineered recovery, but it stringifies the exception and loses the
 * `X402PaymentRequired` payload attached to {@link PaymentRequiredError}.
 * Without that payload the caller cannot run the x402 discovery flow (probe →
 * read scheme/network/plan id → acquire token → retry).
 *
 * {@link createPaidReactAgent} builds the same agent but with a `ToolNode`
 * configured to **re-raise** exceptions (`handleToolErrors: false`), so
 * `PaymentRequiredError` propagates all the way back to `agent.invoke()`'s
 * caller with `.paymentRequired` populated.
 *
 * `@langchain/langgraph` is imported **lazily** inside the function so the
 * existing `peerDependencies` story is unchanged — users who only use the
 * `requiresPayment` wrapper do not need LangGraph installed. Install it
 * yourself (`pnpm add @langchain/langgraph`) to use this helper.
 *
 * @example
 * ```typescript
 * import { tool } from '@langchain/core/tools'
 * import { ChatOpenAI } from '@langchain/openai'
 * import { z } from 'zod'
 * import {
 *   PaymentRequiredError,
 *   createPaidReactAgent,
 *   requiresPayment,
 *   lastSettlement,
 * } from '@nevermined-io/payments/langchain'
 *
 * const getMarketInsight = tool(
 *   requiresPayment(
 *     (args) => `Market insight for ${args.topic} ...`,
 *     { payments, planId: PLAN_ID, credits: 1 },
 *   ),
 *   { name: 'get_market_insight', description: 'Paid market insight', schema: z.object({ topic: z.string() }) },
 * )
 *
 * const agent = createPaidReactAgent(
 *   new ChatOpenAI({ model: 'gpt-4o-mini', temperature: 0 }),
 *   [getMarketInsight],
 *   { prompt: '...' },
 * )
 *
 * // Discovery: invoke without a token to learn what to pay for.
 * try {
 *   await agent.invoke({ messages: [...] }, { configurable: {} })
 * } catch (err) {
 *   if (err instanceof PaymentRequiredError) {
 *     const accept = err.paymentRequired?.accepts[0]
 *     // ... acquire token using accept.planId / accept.scheme / accept.network ...
 *   }
 * }
 *
 * const result = await agent.invoke(
 *   { messages: [...] },
 *   { configurable: { payment_token: token } },
 * )
 * const receipt = lastSettlement()
 * ```
 */

/**
 * Options forwarded to the underlying `createReactAgent` call.
 *
 * Everything except `tools` (which this helper builds from the `tools`
 * argument as a `ToolNode` with `handleToolErrors: false`) and `llm` (which
 * this helper maps from the `model` argument) is passed through verbatim —
 * `prompt`, `stateSchema`, `checkpointer`, `responseFormat`, etc.
 */
export type CreatePaidReactAgentOptions = Record<string, unknown>

/**
 * Build a LangGraph ReAct agent that lets `PaymentRequiredError` propagate.
 *
 * Wraps `createReactAgent` from `@langchain/langgraph/prebuilt` with a
 * `ToolNode(tools, { handleToolErrors: false })`. The signature mirrors the
 * Python `create_paid_react_agent(model, tools, **kwargs)` helper: `model` is
 * mapped to the JS `llm` parameter and any extra `options` are forwarded.
 *
 * @param model - The chat model (mapped to `createReactAgent`'s `llm` argument).
 * @param tools - The LangChain tools, typically functions wrapped with
 *   `requiresPayment` and registered via `tool(...)`.
 * @param options - Forwarded verbatim to `createReactAgent` (`prompt`,
 *   `stateSchema`, `checkpointer`, …).
 * @returns The compiled ReAct agent graph, ready to be invoked with
 *   `agent.invoke(...)`.
 * @throws If `@langchain/langgraph` is not installed.
 */
export async function createPaidReactAgent(
  model: unknown,
  tools: readonly unknown[],
  options: CreatePaidReactAgentOptions = {},
): Promise<unknown> {
  let prebuilt: typeof import('@langchain/langgraph/prebuilt')
  try {
    prebuilt = await import('@langchain/langgraph/prebuilt')
  } catch (err) {
    throw new Error(
      'createPaidReactAgent requires @langchain/langgraph. ' +
        `Install it with \`pnpm add @langchain/langgraph\`. (${
          err instanceof Error ? err.message : String(err)
        })`,
    )
  }
  const { ToolNode, createReactAgent } = prebuilt

  // handleToolErrors: false re-raises tool exceptions instead of stringifying
  // them into a ToolMessage, so PaymentRequiredError reaches agent.invoke()'s
  // caller with its X402PaymentRequired payload intact.
  const toolNode = new ToolNode(tools as never, { handleToolErrors: false })
  return createReactAgent({ llm: model as never, tools: toolNode, ...options } as never)
}
