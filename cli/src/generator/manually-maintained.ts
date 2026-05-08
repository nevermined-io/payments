/**
 * Commands that are manually maintained and should not be overwritten by the
 * generator or flagged as "extra" by the sync check.
 *
 * Key format: "topic/command-name" (matches the file path under commands/).
 */
export const MANUALLY_MAINTAINED_COMMANDS = new Set([
  'x402token/get-x402-access-token',
  'x402token/build-payment-required',
])
