import { execFile } from 'child_process'

/**
 * Open the user's default browser at `url`. Cross-platform wrapper used
 * by `nevermined login` and `nevermined cards setup/enroll/delegate`.
 *
 * On Windows we deliberately avoid `cmd /c start <url>`: cmd parses `&`
 * inside the URL as a command separator, which truncates any URL that
 * carries multiple query parameters (every redirect flow we use). Using
 * `rundll32 url.dll,FileProtocolHandler` hands the URL to the OS's
 * registered protocol handler verbatim — no shell parsing, no
 * truncation, no command-injection vector if the URL ever carries
 * caller-controlled state.
 */
export function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const platform = process.platform
    let cmd: string
    let args: string[]
    if (platform === 'darwin') {
      cmd = 'open'
      args = [url]
    } else if (platform === 'win32') {
      // No cmd.exe in the chain — rundll32 hands the URL straight to
      // the OS protocol handler, so `&` survives intact.
      cmd = 'rundll32'
      args = ['url.dll,FileProtocolHandler', url]
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
