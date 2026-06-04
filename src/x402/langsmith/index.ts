/**
 * LangSmith observability bridge for Nevermined payments (TypeScript).
 *
 * Surfaces the cross-SDK `nvm:verify` / `nvm:settlement` spans defined by the
 * observability-spans-v1 contract, matching the Python SDK attribute-for-
 * attribute so a single LangSmith trace can be correlated across both SDKs.
 *
 * These helpers are wired into the `requiresPayment` decorator automatically;
 * they are also exported here for manual use in non-LangChain code paths.
 *
 * Requires the optional `langsmith` peer dependency and `LANGSMITH_TRACING=true`;
 * every helper no-ops when tracing is inactive or `langsmith` is not installed.
 */

export {
  abbreviateToken,
  activeRunTree,
  addMetadata,
  buildSettleMetadata,
  buildVerifyMetadata,
  redactMetadataKeys,
  settlementSpan,
  verifySpan,
  NVM_VERIFY_SPAN,
  NVM_SETTLEMENT_SPAN,
  type NvmSpan,
  type SpanMetadata,
  type VerifyMetadataInput,
  type SettleMetadataInput,
  type VerifySpanInput,
  type SettlementSpanInput,
} from './spans.js'
