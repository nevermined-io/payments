import type { PaymentOptions } from '../common/types.js'
import { BasePaymentsAPI } from './base-payments.js'
import { PaymentsError } from '../common/payments.error.js'

export interface DeploymentInfo {
  version?: string
  chainId?: number
  contracts: Record<string, string>
}

/**
 * Contracts API for accessing contract addresses from the Nevermined API info endpoint.
 */
export class ContractsAPI extends BasePaymentsAPI {
  private deploymentInfo?: DeploymentInfo

  constructor(options: PaymentOptions) {
    super(options)
  }

  /**
   * Fetch deployment info (including contract addresses) from the API root.
   * The result is cached after the first call.
   */
  async getDeploymentInfo(): Promise<DeploymentInfo> {
    if (this.deploymentInfo) return this.deploymentInfo

    const infoUrl = new URL('/', this.environment.backend)

    try {
      const response = await fetch(infoUrl, { method: 'GET' })
      if (!response.ok) {
        throw new PaymentsError(
          `Failed to fetch deployment info: ${response.status} ${response.statusText}`,
        )
      }

      const info = (await response.json()) as { deployment?: DeploymentInfo }
      if (!info.deployment || !info.deployment.contracts) {
        throw new PaymentsError('Deployment info not found in API response')
      }

      this.deploymentInfo = info.deployment
      return this.deploymentInfo
    } catch (error: any) {
      throw new PaymentsError(error?.message || 'Failed to fetch deployment info')
    }
  }

  /**
   * Get a contract address by name (e.g., "PayAsYouGoTemplate").
   */
  async getContractAddress(contractName: string): Promise<string> {
    const deployment = await this.getDeploymentInfo()
    const address = deployment.contracts?.[contractName]
    if (!address) {
      throw new PaymentsError(`Contract address not found for ${contractName}`)
    }
    return address
  }

  /**
   * Get the PayAsYouGoTemplate contract address (convenience accessor).
   */
  async getPayAsYouGoTemplateAddress(): Promise<string> {
    return this.getContractAddress('PayAsYouGoTemplate')
  }
}

