export interface EnvironmentInfo {
  frontend: string
  /**
   * Base URL of the standalone, Privy-free embed app (the `embed.<tier>`
   * origin that serves the chromeless `/cards/*` and `/checkout/*` pages).
   * Formed by prepending `embed.` to the webapp host. The CLI redirect-mode
   * card flows open `${embed}/cards/setup` here — the old webapp
   * `/embed/cards/*` routes were removed in the #1787 cutover.
   */
  embed: string
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
    embed: 'https://embed.nevermined.dev',
    backend: 'https://api.sandbox.nevermined.dev/',
    proxy: 'https://proxy.sandbox.nevermined.dev',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  staging_live: {
    frontend: 'https://nevermined.dev',
    embed: 'https://embed.nevermined.dev',
    backend: 'https://api.live.nevermined.dev/',
    proxy: 'https://proxy.live.nevermined.dev',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  /**
   * The Sandbox environment URLs.
   */
  sandbox: {
    frontend: 'https://nevermined.app',
    embed: 'https://embed.nevermined.app',
    backend: 'https://api.sandbox.nevermined.app/',
    proxy: 'https://proxy.sandbox.nevermined.app',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  /**
   * The Live environment URLs.
   */
  live: {
    frontend: 'https://nevermined.app',
    embed: 'https://embed.nevermined.app',
    backend: 'https://api.live.nevermined.app/',
    proxy: 'https://proxy.live.nevermined.app',
    heliconeUrl: 'https://helicone.nevermined.dev',
  },
  /**
   * A custom environment URLs.
   */
  custom: {
    frontend: process.env.NVM_FRONTEND_URL || 'http://localhost:4200',
    embed: process.env.NVM_EMBED_URL || process.env.NVM_FRONTEND_URL || 'http://localhost:4200',
    backend: process.env.NVM_BACKEND_URL || 'http://localhost:3001',
    proxy: process.env.NVM_PROXY_URL || 'https://localhost:443',
    heliconeUrl: process.env.HELICONE_URL || 'http://localhost:8585',
  },
}
