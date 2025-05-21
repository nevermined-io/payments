import {
  Address,
  PlanCreditsConfig,
  PlanCreditsType,
  PlanPriceConfig,
  PlanPriceType,
  PlanRedemptionType,
} from './common/types'
import { ZeroAddress } from './environments'
import { isEthereumAddress } from './utils'

export const getFiatPriceConfig = (amount: bigint, receiver: Address): PlanPriceConfig => {
  if (!isEthereumAddress(receiver))
    throw new Error(`Receiver address ${receiver} is not a valid Ethereum address`)
  return {
    priceType: PlanPriceType.FIXED_FIAT_PRICE,
    tokenAddress: ZeroAddress,
    amounts: [amount],
    receivers: [receiver],
    contractAddress: ZeroAddress,
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
    priceType: PlanPriceType.FIXED_PRICE,
    tokenAddress,
    amounts: [amount],
    receivers: [receiver],
    contractAddress: ZeroAddress,
  }
}

export const getERC20PriceConfig = (
  amount: bigint,
  receiver: Address,
  tokenAddress: Address,
): PlanPriceConfig => {
  return getCryptoPriceConfig(amount, receiver, tokenAddress)
}

export const getNativeTokenPriceConfig = (amount: bigint, receiver: Address): PlanPriceConfig => {
  return getCryptoPriceConfig(amount, receiver, ZeroAddress)
}

export const getExpirableCreditsConfig = (durationOfPlan: bigint): PlanCreditsConfig => {
  return {
    creditsType: PlanCreditsType.EXPIRABLE,
    redemptionType: PlanRedemptionType.ONLY_OWNER,
    proofRequired: false,
    durationSecs: durationOfPlan,
    amount: 1n,
    minAmount: 1n,
    maxAmount: 1n,
  }
}

export const getNonExpirableCreditsConfig = (): PlanCreditsConfig => {
  return getExpirableCreditsConfig(0n)
}

export const getFixedCreditsConfig = (
  creditsGranted: bigint,
  creditsPerRequest = 1n,
): PlanCreditsConfig => {
  return {
    creditsType: PlanCreditsType.FIXED,
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
    creditsType: PlanCreditsType.DYNAMIC,
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
