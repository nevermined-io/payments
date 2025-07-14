export interface EnvironmentInfo {
  frontend?: string
  backend: string
  proxy: string
}

export const ZeroAddress = '0x0000000000000000000000000000000000000000'

export type EnvironmentName =
  | 'local_testnet'
  | 'local_mainnet'
  | 'staging_testnet'
  | 'staging_mainnet'
  | 'production_testnet'
  | 'production_mainnet'
  | 'custom'

/**
 * Represents the different environments and their corresponding URLs.
 */
export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  /**
   * The local environment URLs.
   */
  local_testnet: {
    frontend: 'http://localhost:3000',
    backend: 'http://localhost:3001',
    proxy: 'https://localhost:443',
  },
  local_mainnet: {
    frontend: 'http://localhost:3000',
    backend: 'http://localhost:3002',
    proxy: 'https://localhost:443',
  },
  /**
   * The staging environment URLs.
   */
  staging_testnet: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://api-base-sepolia.staging.nevermined.app/',
    proxy: 'https://proxy.staging.nevermined.app',
  },
  staging_mainnet: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://api-base-mainnet.staging.nevermined.app/',
    proxy: 'https://proxy.staging.nevermined.app',
  },
  /**
   * The Production environment URLs.
   */
  production_testnet: {
    frontend: 'https://nevermined.app',
    backend: 'https://api-base-sepolia.nevermined.app/',
    proxy: 'https://proxy.nevermined.app',
  },
  production_mainnet: {
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
