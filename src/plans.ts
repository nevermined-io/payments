import { Address, PlanCreditsConfig, PlanPriceConfig, PlanRedemptionType } from './common/types.js'
import { ZeroAddress } from './environments.js'
import { isEthereumAddress } from './utils.js'

export const ONE_DAY_DURATION = 86_400n // 24 * 60 * 60 seconds
export const ONE_WEEK_DURATION = 604_800n // 7 * 24 * 60 * 60 seconds
export const ONE_MONTH_DURATION = 2_629_746n // (365.25 days/year ÷ 12 months/year) × 24 × 60 × 60 ≈ 2,629,746 seconds
export const ONE_YEAR_DURATION = 31_557_600n // 365.25 * 24 * 60 * 60 seconds

export const getFiatPriceConfig = (amount: bigint, receiver: Address): PlanPriceConfig => {
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
    redemptionType: PlanRedemptionType.ONLY_OWNER,
    proofRequired: false,
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
    redemptionType: PlanRedemptionType.ONLY_OWNER,
    proofRequired: false,
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
    redemptionType: PlanRedemptionType.ONLY_OWNER,
    proofRequired: false,
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

export const setProofRequired = (
  creditsConfig: PlanCreditsConfig,
  proofRequired = true,
): PlanCreditsConfig => {
  return {
    ...creditsConfig,
    proofRequired,
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
    proofRequired: false,
    durationSecs: 0n,
    amount: 1n,
    minAmount: 1n,
    maxAmount: 1n,
  }
}
