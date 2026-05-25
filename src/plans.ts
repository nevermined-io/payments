import {
  Address,
  Currency,
  EURC_TOKEN_ADDRESS,
  PlanCreditsConfig,
  PlanPriceConfig,
  PlanRedemptionType,
} from './common/types.js'
import { ZeroAddress } from './environments.js'
import { isEthereumAddress } from './utils.js'

export const ONE_DAY_DURATION = 86_400n // 24 * 60 * 60 seconds
export const ONE_WEEK_DURATION = 604_800n // 7 * 24 * 60 * 60 seconds
export const ONE_MONTH_DURATION = 2_629_746n // (365.25 days/year ÷ 12 months/year) × 24 × 60 × 60 ≈ 2,629,746 seconds
export const ONE_YEAR_DURATION = 31_557_600n // 365.25 * 24 * 60 * 60 seconds

/**
 * Builds a price configuration for fiat-denominated plans (Stripe / Braintree).
 *
 * `amount` is in **6-decimal units** (the USDC convention used across the
 * Nevermined protocol — NOT cents). To charge $2.00, pass `2_000_000n`;
 * `200n` would be read as $0.0002 and rejected by the backend.
 *
 * Minimum charge enforced server-side is **$1.00** (`1_000_000n`) — fiat
 * processor fixed fees make smaller amounts uneconomic. Passing below the
 * minimum surfaces as `BCK.PROTOCOL.0047`.
 *
 * @param amount - Amount in 6-decimal units (e.g. `2_000_000n` for $2.00)
 * @param receiver - Wallet address that will receive the settled funds
 * @param currency - ISO currency code (defaults to `USD`)
 *
 * @example
 * ```ts
 * // Charge $9.99 in USD
 * getFiatPriceConfig(9_990_000n, sellerWallet)
 *
 * // Charge €29.00 in EUR
 * getFiatPriceConfig(29_000_000n, sellerWallet, Currency.EUR)
 * ```
 */
export const getFiatPriceConfig = (
  amount: bigint,
  receiver: Address,
  currency: Currency | string = Currency.USD,
): PlanPriceConfig => {
  if (!isEthereumAddress(receiver))
    throw new Error(`Receiver address ${receiver} is not a valid Ethereum address`)
  return {
    tokenAddress: ZeroAddress,
    amounts: [amount],
    receivers: [receiver],
    contractAddress: ZeroAddress,
    feeController: ZeroAddress,
    externalPriceAddress: ZeroAddress,
    templateAddress: ZeroAddress,
    isCrypto: false,
    currency,
  }
}

export const getCryptoPriceConfig = (
  amount: bigint,
  receiver: Address,
  tokenAddress: Address = ZeroAddress,
): PlanPriceConfig => {
  if (!isEthereumAddress(receiver))
    throw new Error(`Receiver address ${receiver} is not a valid Ethereum address`)
  return {
    tokenAddress,
    amounts: [amount],
    receivers: [receiver],
    contractAddress: ZeroAddress,
    feeController: ZeroAddress,
    externalPriceAddress: ZeroAddress,
    templateAddress: ZeroAddress,
    isCrypto: true,
  }
}

export const getERC20PriceConfig = (
  amount: bigint,
  tokenAddress: Address,
  receiver: Address,
): PlanPriceConfig => {
  return getCryptoPriceConfig(amount, receiver, tokenAddress)
}

/**
 * Builds a price configuration for EURC (Euro stablecoin) payments.
 *
 * EURC uses 6 decimal places. To charge €29.00, pass `29_000_000n`.
 *
 * @param amount - Amount in the token's smallest unit (6 decimals for EURC).
 * @param receiver - Wallet address that will receive the payment.
 * @param eurcAddress - Optional EURC token address. Defaults to Base Mainnet EURC.
 * @returns The PlanPriceConfig representing an EURC price.
 */
export const getEURCPriceConfig = (
  amount: bigint,
  receiver: Address,
  eurcAddress: Address = EURC_TOKEN_ADDRESS,
): PlanPriceConfig => {
  return {
    ...getERC20PriceConfig(amount, eurcAddress, receiver),
    currency: Currency.EURC,
  }
}

export const getFreePriceConfig = (): PlanPriceConfig => {
  return {
    tokenAddress: ZeroAddress,
    amounts: [],
    receivers: [],
    contractAddress: ZeroAddress,
    feeController: ZeroAddress,
    externalPriceAddress: ZeroAddress,
    templateAddress: ZeroAddress,
    isCrypto: true,
  }
}

export const getNativeTokenPriceConfig = (amount: bigint, receiver: Address): PlanPriceConfig => {
  return getCryptoPriceConfig(amount, receiver, ZeroAddress)
}

export const getExpirableDurationConfig = (durationOfPlan: bigint): PlanCreditsConfig => {
  return {
    isRedemptionAmountFixed: false,
    redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
    onchainMirror: false,
    durationSecs: durationOfPlan,
    amount: 1n,
    minAmount: 1n,
    maxAmount: 1n,
  }
}

export const getNonExpirableDurationConfig = (): PlanCreditsConfig => {
  return getExpirableDurationConfig(0n)
}

export const getFixedCreditsConfig = (
  creditsGranted: bigint,
  creditsPerRequest = 1n,
): PlanCreditsConfig => {
  return {
    isRedemptionAmountFixed: true,
    redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
    onchainMirror: false,
    durationSecs: 0n,
    amount: creditsGranted,
    minAmount: creditsPerRequest,
    maxAmount: creditsPerRequest,
  }
}

export const getDynamicCreditsConfig = (
  creditsGranted: bigint,
  minCreditsPerRequest = 1n,
  maxCreditsPerRequest = 1n,
): PlanCreditsConfig => {
  return {
    isRedemptionAmountFixed: false,
    redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
    onchainMirror: false,
    durationSecs: 0n,
    amount: creditsGranted,
    minAmount: minCreditsPerRequest,
    maxAmount: maxCreditsPerRequest,
  }
}

export const setRedemptionType = (
  creditsConfig: PlanCreditsConfig,
  redemptionType: PlanRedemptionType,
): PlanCreditsConfig => {
  return {
    ...creditsConfig,
    redemptionType,
  }
}

export const setOnchainMirror = (
  creditsConfig: PlanCreditsConfig,
  onchainMirror = true,
): PlanCreditsConfig => {
  return {
    ...creditsConfig,
    onchainMirror,
  }
}

/**
 * Build a pay-as-you-go price configuration.
 *
 * For pay-as-you-go plans, the template address must come from the API deployment info.
 */
export const getPayAsYouGoPriceConfig = (
  amount: bigint,
  receiver: Address,
  tokenAddress: Address = ZeroAddress,
  templateAddress?: Address,
): PlanPriceConfig => {
  if (!isEthereumAddress(receiver))
    throw new Error(`Receiver address ${receiver} is not a valid Ethereum address`)

  if (!templateAddress) {
    throw new Error(
      'templateAddress is required. Use ContractsAPI.getPayAsYouGoTemplateAddress() or Payments.plans.getPayAsYouGoPriceConfig()',
    )
  }

  return {
    tokenAddress,
    amounts: [amount],
    receivers: [receiver],
    contractAddress: ZeroAddress,
    feeController: ZeroAddress,
    externalPriceAddress: ZeroAddress,
    templateAddress,
    isCrypto: true,
  }
}

/**
 * Build a pay-as-you-go credits configuration.
 *
 * Credits are not minted upfront; these values are required for validation only.
 */
export const getPayAsYouGoCreditsConfig = (): PlanCreditsConfig => {
  return {
    isRedemptionAmountFixed: false,
    redemptionType: PlanRedemptionType.ONLY_SUBSCRIBER,
    onchainMirror: false,
    durationSecs: 0n,
    amount: 1n,
    minAmount: 1n,
    maxAmount: 1n,
  }
}
