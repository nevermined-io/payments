export interface EnvironmentInfo {
  frontend?: string
  backend: string
  proxy: string
}

export const ZeroAddress = '0x0000000000000000000000000000000000000000'

export type EnvironmentName =


  | 'staging_sandbox'
  | 'staging_live'
  | 'sandbox'
  | 'live'
  | 'custom'

/**
 * Represents the different environments and their corresponding URLs.
 */
export const Environments: Record<EnvironmentName, EnvironmentInfo> = {

  /**
   * The staging environment URLs.
   */
  staging_sandbox: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://api-base-sepolia.staging.nevermined.app/',
    proxy: 'https://proxy.staging.nevermined.app',
  },
  staging_live: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://api-base-mainnet.staging.nevermined.app/',
    proxy: 'https://proxy.staging.nevermined.app',
  },
  /**
   * The Production environment URLs.
   */
  sandbox: {
    frontend: 'https://nevermined.app',
    backend: 'https://api-base-sepolia.nevermined.app/',
    proxy: 'https://proxy.nevermined.app',
  },
  live: {
    frontend: 'https://nevermined.app',
    backend: 'https://api-base-mainnet.nevermined.app/',
    proxy: 'https://proxy.nevermined.app',
  },
  /**
   * A custom environment URLs.
   */
  custom: {
    frontend: process.env.NVM_FRONTEND_URL || 'http://localhost:3000',
    backend: process.env.NVM_BACKEND_URL || 'http://localhost:3001',
    proxy: process.env.NVM_PROXY_URL || 'https://localhost:443',
  },
}
