export interface EnvironmentInfo {
  frontend?: string
  backend: string
  proxy: string
}

export const ZeroAddress = '0x0000000000000000000000000000000000000000'

export type EnvironmentName =
  | 'local'
  | 'staging'
  | 'testing'
  | 'production'
  | 'base'
  | 'base-sepolia'
  | 'custom'

/**
 * Represents the different environments and their corresponding URLs.
 */
export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  /**
   * The local environment URLs.
   */
  local: {
    frontend: 'http://localhost:3000',
    backend: 'http://localhost:3001',
    proxy: 'https://localhost:443',
  },
  /**
   * The staging environment URLs.
   */
  staging: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://one-backend.staging.nevermined.app',
    proxy: 'https://proxy.staging.nevermined.app',
  },
  /**
   * The testing environment URLs.
   */
  testing: {
    frontend: 'https://testing.nevermined.app',
    backend: 'https://one-backend.testing.nevermined.app',
    proxy: 'https://proxy.testing.nevermined.app',
  },
  /**
   * The Arbitrum environment URLs.
   */
  production: {
    frontend: 'https://nevermined.app',
    backend: 'https://one-backend.nevermined.app',
    proxy: 'https://proxy.nevermined.app',
  },
  /**
   * The Base environment URLs.
   */
  base: {
    frontend: 'https://base.nevermined.app',
    backend: 'https://one-backend.base.nevermined.app',
    proxy: 'https://proxy.base.nevermined.app',
  },
  /**
   * The Base Sepolia environment URLs.
   */
  'base-sepolia': {
    frontend: 'https://base-sepolia.nevermined.app',
    backend: 'https://one-backend.base-sepolia.nevermined.app',
    proxy: 'https://proxy.base-sepolia.nevermined.app',
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
