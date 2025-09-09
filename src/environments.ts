export interface EnvironmentInfo {
  frontend: string
  backend: string
  proxy: string
  heliconeUrl: string
}

export const ZeroAddress = '0x0000000000000000000000000000000000000000'

export type EnvironmentName = 'staging_sandbox' | 'staging_live' | 'sandbox' | 'live' | 'custom'

/**
 * Represents the different environments and their corresponding URLs.
 */
export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  /**
   * The staging environment URLs.
   */
  staging_sandbox: {
    frontend: 'https://nevermined.dev',
    backend: 'https://api.sandbox.nevermined.dev/',
    proxy: 'https://proxy.sandbox.nevermined.dev',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  staging_live: {
    frontend: 'https://nevermined.dev',
    backend: 'https://api.live.nevermined.dev/',
    proxy: 'https://proxy.live.nevermined.dev',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  /**
   * The Production environment URLs.
   */
  sandbox: {
    frontend: 'https://nevermined.app',
    backend: 'https://api.sandbox.nevermined.app/',
    proxy: 'https://proxy.sandbox.nevermined.app',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  live: {
    frontend: 'https://nevermined.app',
    backend: 'https://api.live.nevermined.app/',
    proxy: 'https://proxy.live.nevermined.app',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  /**
   * A custom environment URLs.
   */
  custom: {
    frontend: process.env.NVM_FRONTEND_URL || 'http://localhost:3000',
    backend: process.env.NVM_BACKEND_URL || 'http://localhost:3001',
    proxy: process.env.NVM_PROXY_URL || 'https://localhost:443',
    heliconeUrl: process.env.HELICONE_URL || 'http://localhost:8585',
  },
}
