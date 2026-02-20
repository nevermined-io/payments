import { createServer } from 'http'
import type { IncomingMessage, ServerResponse } from 'http'
import { execFile } from 'child_process'
import { Environments } from '@nevermined-io/payments'
import type { EnvironmentName } from '@nevermined-io/payments'

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

const SUCCESS_HTML = `
<html><body style="font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center;">
    <h2>Authentication successful!</h2>
    <p>You can close this tab and return to your application.</p>
  </div>
</body></html>
`

export interface LoginResult {
  nvmApiKey: string
  environment: string
  loginUrl: string
}

/**
 * Starts a one-shot HTTP server, opens the Nevermined login page in the browser,
 * and resolves with the API key once the callback is received.
 */
export async function startLoginFlow(
  environment: EnvironmentName,
  openBrowserFn: (url: string) => Promise<void> = openBrowser,
): Promise<LoginResult> {
  const envInfo = Environments[environment]
  if (!envInfo?.frontend) {
    throw new Error(`Unknown environment: ${environment}`)
  }
  const frontendUrl = envInfo.frontend

  const nvmApiKey = await new Promise<string>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost')
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
      res.end(SUCCESS_HTML)

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

      openBrowserFn(loginUrl).catch(() => {
        // Browser open failed — the caller should provide the URL to the user
      })
    })

    server.on('error', (err) => {
      clearTimeout(timeout)
      reject(new Error(`Failed to start local server: ${err.message}`))
    })
  })

  return {
    nvmApiKey,
    environment,
    loginUrl: `${frontendUrl}/auth/cli`,
  }
}

export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    let cmd: string
    let args: string[]
    if (platform === 'darwin') {
      cmd = 'open'
      args = [url]
    } else if (platform === 'win32') {
      cmd = 'cmd'
      args = ['/c', 'start', '""', url]
    } else {
      cmd = 'xdg-open'
      args = [url]
    }
    execFile(cmd, args, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}
