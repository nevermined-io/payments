import { Flags } from '@oclif/core'
import { createServer, IncomingMessage, ServerResponse } from 'http'
import { exec } from 'child_process'
import { BaseCommand } from '../base-command.js'
import { Environments, EnvironmentName } from '@nevermined-io/payments'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export default class Login extends BaseCommand {
  static description = 'Authenticate with Nevermined via browser login'

  static examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --environment live',
    '<%= config.bin %> <%= command.id %> --profile production --environment live',
    '<%= config.bin %> <%= command.id %> --no-browser',
  ]

  static flags = {
    ...BaseCommand.baseFlags,
    environment: Flags.string({
      char: 'e',
      description: 'Target environment',
      options: ['sandbox', 'live', 'staging_sandbox', 'staging_live', 'custom'],
      required: false,
    }),
    'no-browser': Flags.boolean({
      description: 'Print the login URL instead of opening the browser',
      default: false,
    }),
  }

  async run(): Promise<void> {
    try {
      const { flags } = await this.parse(Login)
      const activeProfile = await this.configManager.getActiveProfile()
      const profileName = flags.profile || activeProfile || 'default'

      // Resolve environment: flag > existing config > default
      let environment = flags.environment as EnvironmentName | undefined
      if (!environment) {
        const config = await this.configManager.get(undefined, profileName)
        environment = config?.environment as EnvironmentName | undefined
      }
      if (!environment) {
        environment = 'sandbox'
      }

      const frontendUrl = Environments[environment]?.frontend
      if (!frontendUrl) {
        this.error(`Unknown environment: ${environment}`, { exit: 1 })
      }

      // Start one-shot HTTP server on a random port
      const apiKey = await new Promise<string>((resolve, reject) => {
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url || '/', `http://localhost`)
          if (url.pathname !== '/callback') {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          const key = url.searchParams.get('nvm_api_key')
          if (!key) {
            res.writeHead(400)
            res.end('Missing nvm_api_key parameter')
            return
          }

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html><body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8f9fa;">
              <div style="text-align: center;">
                <h2>Authentication successful!</h2>
                <p>You can close this tab and return to your terminal.</p>
              </div>
            </body></html>
          `)

          clearTimeout(timeout)
          server.close()
          resolve(key)
        })

        const timeout = setTimeout(() => {
          server.close()
          reject(new Error('Login timed out after 5 minutes. Please try again.'))
        }, LOGIN_TIMEOUT_MS)

        server.listen(0, '127.0.0.1', () => {
          const addr = server.address()
          if (!addr || typeof addr === 'string') {
            clearTimeout(timeout)
            server.close()
            reject(new Error('Failed to start local server'))
            return
          }

          const port = addr.port
          const callbackUrl = encodeURIComponent(`http://localhost:${port}/callback`)
          const loginUrl = `${frontendUrl}/auth/cli?callback_url=${callbackUrl}`

          if (flags['no-browser']) {
            this.formatter.info('Open this URL in your browser to authenticate:\n')
            this.log(loginUrl)
            this.log('')
            this.formatter.info('Waiting for authentication...')
          } else {
            this.formatter.info(`Opening browser to authenticate with ${environment} environment...`)
            openBrowser(loginUrl).catch(() => {
              this.formatter.warning('Could not open browser automatically.')
              this.formatter.info('Open this URL manually:\n')
              this.log(loginUrl)
            })
            this.formatter.info('Waiting for authentication...')
          }
        })

        server.on('error', (err) => {
          clearTimeout(timeout)
          reject(new Error(`Failed to start local server: ${err.message}`))
        })
      })

      // Save to config
      await this.configManager.set('nvmApiKey', apiKey, profileName)
      await this.configManager.set('environment', environment, profileName)
      await this.configManager.setActiveProfile(profileName)

      this.formatter.success(
        `Authenticated successfully!\n` +
          `  Profile:     ${profileName}\n` +
          `  Environment: ${environment}\n` +
          `  Config file: ${this.configManager.getDefaultConfigPath()}`
      )
      this.formatter.info('\nYou can now use the CLI. Try: nvm plans get-plans')
    } catch (error) {
      this.handleError(error)
    }
  }
}

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    let cmd: string
    if (platform === 'darwin') {
      cmd = `open "${url}"`
    } else if (platform === 'win32') {
      cmd = `start "" "${url}"`
    } else {
      cmd = `xdg-open "${url}"`
    }
    exec(cmd, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
