import { createInterface } from 'readline'
import type { Payments } from '@nevermined-io/payments'

export interface ResolvedOrgIdResult {
  orgId: string
  /** Human-readable org name (for logging). May be empty if the API returned none. */
  orgName: string
}

interface ResolveOrgIdOptions {
  payments: Payments
  /** Value of `--org <id>` if the user passed one. */
  flagOrgId?: string
  /** Print routine — typically the oclif command's `this.log` bound. */
  log: (msg: string) => void
  /** Whether the calling terminal is interactive. Defaults to `process.stdin.isTTY`. */
  isTTY?: boolean
}

/**
 * Resolve which organisation a top-level CLI widget flow should be
 * scoped to.
 *
 * Rules (mirror the acceptance criteria in issue #1671):
 *  - `--org <id>` wins outright (we don't double-check membership — the
 *    backend's `POST /widgets/session/self` will reject if the user
 *    isn't a member).
 *  - Otherwise call `payments.organizations.getMyMemberships()`:
 *      - 0 → exit with the "card setup is only available to org members"
 *        message.
 *      - 1 → use it silently.
 *      - 2+ → if the terminal is interactive, prompt the user to pick;
 *        otherwise exit non-zero with "Pass --org <id>".
 *
 * Errors thrown by this helper are formatted to be safe to print
 * directly with `BaseCommand.handleError`.
 */
export async function resolveOrgIdInteractive(
  opts: ResolveOrgIdOptions,
): Promise<ResolvedOrgIdResult> {
  if (opts.flagOrgId) {
    return { orgId: opts.flagOrgId, orgName: '' }
  }

  const memberships = await opts.payments.organizations.getMyMemberships()
  if (!memberships || memberships.length === 0) {
    throw new Error(
      'Card setup is only available to members of an organization. Create or join one in the dashboard, then re-run this command.',
    )
  }

  if (memberships.length === 1) {
    const m = memberships[0]
    return { orgId: m.orgId, orgName: m.orgName ?? '' }
  }

  const isTTY = opts.isTTY ?? process.stdin.isTTY
  if (!isTTY) {
    throw new Error(
      `Multiple organizations found (${memberships.length}). Pass --org <id> to specify which organization to use.`,
    )
  }

  opts.log('You are a member of multiple organizations:')
  memberships.forEach((m, idx) => {
    const role = m.role ? ` — ${m.role}` : ''
    opts.log(`  ${idx + 1}. ${m.orgName ?? m.orgId}${role}  (${m.orgId})`)
  })

  const pick = await promptIndex(memberships.length, '> Select an organization [1]: ')
  const chosen = memberships[pick - 1]
  return { orgId: chosen.orgId, orgName: chosen.orgName ?? '' }
}

async function promptIndex(max: number, prompt: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(prompt, (answer) => {
      rl.close()
      const trimmed = answer.trim()
      // Default to 1 when the user just hits Enter — matches the "[1]" in
      // the prompt and gives interactive users a single-keystroke happy
      // path when the first org is the one they want.
      if (trimmed === '') return resolve(1)
      const n = Number(trimmed)
      if (!Number.isInteger(n) || n < 1 || n > max) {
        reject(new Error(`Please enter a number between 1 and ${max}.`))
        return
      }
      resolve(n)
    })
  })
}
