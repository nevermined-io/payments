export interface EnvironmentInfo {
  frontend: string
  backend: string
}

export type EnvironmentName = 'staging'

export const Environments: Record<EnvironmentName, EnvironmentInfo> = {
  staging: {
    frontend: 'https://staging.nevermined.app',
    backend: 'https://one-backend.staging.nevermined.app',
  },
}
