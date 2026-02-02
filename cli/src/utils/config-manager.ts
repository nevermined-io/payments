import { cosmiconfig } from 'cosmiconfig'
import { writeFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { homedir } from 'os'
import { join } from 'path'

export interface ProfileConfig {
  nvmApiKey?: string
  environment?: string
}

export interface Config {
  profiles: {
    [profileName: string]: ProfileConfig
  }
  activeProfile: string
}

const MODULE_NAME = 'nvm'
const DEFAULT_CONFIG_PATH = join(homedir(), '.config', 'nvm', 'config.json')

export class ConfigManager {
  private static instance: ConfigManager
  private explorer = cosmiconfig(MODULE_NAME)
  private configCache?: Config

  private constructor() {}

  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager()
    }
    return ConfigManager.instance
  }

  async load(): Promise<Config | null> {
    try {
      // Try to load from specific config path first
      const configPath = process.env.NVM_CONFIG || DEFAULT_CONFIG_PATH
      try {
        const { readFile } = await import('fs/promises')
        const content = await readFile(configPath, 'utf-8')
        this.configCache = JSON.parse(content) as Config
        return this.configCache
      } catch (fileError) {
        // Fall back to cosmiconfig search
        const result = await this.explorer.search()
        if (result && !result.isEmpty) {
          this.configCache = result.config as Config
          return this.configCache
        }
      }
      return null
    } catch (error) {
      return null
    }
  }

  async save(config: Config, path?: string): Promise<void> {
    const targetPath = path || process.env.NVM_CONFIG || DEFAULT_CONFIG_PATH
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, JSON.stringify(config, null, 2), 'utf-8')
    this.configCache = config
  }

  async get(key?: string, profile?: string): Promise<any> {
    const config = this.configCache || (await this.load())
    if (!config) {
      return null
    }

    const profileName = profile || config.activeProfile
    const profileConfig = config.profiles[profileName]

    if (!key) {
      return profileConfig
    }

    return profileConfig?.[key as keyof ProfileConfig]
  }

  async set(key: string, value: string, profile?: string): Promise<void> {
    let config = this.configCache || (await this.load())

    if (!config) {
      // Create default config
      config = {
        profiles: {
          default: {},
        },
        activeProfile: 'default',
      }
    }

    const profileName = profile || config.activeProfile
    if (!config.profiles[profileName]) {
      config.profiles[profileName] = {}
    }

    config.profiles[profileName][key as keyof ProfileConfig] = value
    await this.save(config)
  }

  async getActiveProfile(): Promise<string> {
    const config = this.configCache || (await this.load())
    return config?.activeProfile || 'default'
  }

  async setActiveProfile(profileName: string): Promise<void> {
    let config = this.configCache || (await this.load())

    if (!config) {
      config = {
        profiles: {
          [profileName]: {},
        },
        activeProfile: profileName,
      }
    } else {
      config.activeProfile = profileName
      if (!config.profiles[profileName]) {
        config.profiles[profileName] = {}
      }
    }

    await this.save(config)
  }

  async listProfiles(): Promise<string[]> {
    const config = this.configCache || (await this.load())
    return config ? Object.keys(config.profiles) : []
  }

  async deleteProfile(profileName: string): Promise<void> {
    const config = this.configCache || (await this.load())
    if (!config) {
      throw new Error('No configuration found')
    }

    if (profileName === config.activeProfile) {
      throw new Error('Cannot delete active profile')
    }

    delete config.profiles[profileName]
    await this.save(config)
  }

  getDefaultConfigPath(): string {
    return DEFAULT_CONFIG_PATH
  }
}
