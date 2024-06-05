export interface EnvironmentInfo {
  frontend: string
  backend: string
}

export type EnvironmentName =
  | 'local'
  | 'appStaging'
  | 'appTesting'
  | 'appArbitrum'

/**
 * Represents the different environments and their corresponding URLs.
 */
export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  /**
   * The local environment URLs.
   */
  local: {
    frontend: 'http://localhost:3000',
    backend: 'http://localhost:3200',
  },
  /**
   * The staging environment URLs.
   */
  appStaging: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://one-backend.staging.nevermined.app',
  },
  /**
   * The testing environment URLs.
   */
  appTesting: {
    frontend: 'https://testing.nevermined.app',
    backend: 'https://one-backend.testing.nevermined.app',
  },
  /**
   * The Arbitrum environment URLs.
   */
  appArbitrum: {
    frontend: 'https://nevermined.app',
    backend: 'https://one-backend.arbitrum.nevermined.app',
  }
}
