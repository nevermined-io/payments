export interface EnvironmentInfo {
  frontend: string
  backend: string
}

export type EnvironmentName =
  | 'local'
  | 'appStaging'
  | 'appTesting'
  | 'appArbitrum'
  | 'appGnosis'
  | 'appMatic'

export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  local: {
    frontend: 'http://localhost:3000',
    backend: 'http://localhost:3200',
  },
  appStaging: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://one-backend.staging.nevermined.app',
  },
  appTesting: {
    frontend: 'https://testing.nevermined.app',
    backend: 'https://one-backend.testing.nevermined.app',
  },
  appArbitrum: {
    frontend: 'https://nevermined.app',
    backend: 'https://one-backend.arbitrum.nevermined.app',
  },
  appGnosis: {
    frontend: 'https://gnosis.nevermined.app',
    backend: 'https://one-backend.gnosis.nevermined.app',
  },
  appMatic: {
    frontend: 'https://matic.nevermined.app',
    backend: 'https://one-backend.matic.nevermined.app',
  },
}
