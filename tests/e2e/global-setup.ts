/**
 * @file Jest globalSetup for the E2E suite + the consent-bootstrap helper.
 *
 * Pre-records legal-document consent for the SDK's pre-baked test API keys
 * (issue #334) so the backend `ConsentRequiredGuard` introduced by
 * nvm-monorepo#1409 doesn't HTTP 412 every gated request. Mirrors the
 * `recordTestUserLegalConsent` pattern in
 * `apps/api/src/common/testing/testing-helper.ts`.
 *
 * No-op-safe for *runtime* failures only: a manifest fetch or a per-key
 * POST failure logs a warning and lets the suite proceed — the underlying
 * problem will surface on the first gated call. Configuration errors
 * (unknown `TEST_ENVIRONMENT`) throw, because there is no benign next step.
 *
 * Inlined in this single file because Jest's `globalSetup` resolver runs
 * outside ts-jest's `moduleNameMapper`, so any sibling `.js`-suffixed
 * import (the project's ESM convention) fails with `Cannot find module`.
 * `bootstrapLegalConsent` is re-exported so the unit suite — which IS
 * subject to `moduleNameMapper` — can import it normally.
 */

const FETCH_TIMEOUT_MS = 10_000

interface LegalDocumentEntry {
  current: string
  requiresReConsent?: boolean
}

interface LegalDocumentsManifest {
  documents?: Record<string, LegalDocumentEntry>
}

interface ConsentAcceptance {
  slug: string
  version: string
}

interface LabelledKey {
  label: string
  key: string | undefined
}

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

const fetchManifestAcceptances = async (backendUrl: string): Promise<ConsentAcceptance[]> => {
  const url = `${trimTrailingSlash(backendUrl)}/api/v1/legal-documents/manifest`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    throw new Error(`Manifest fetch failed: HTTP ${res.status} ${res.statusText}`)
  }

  const body = (await res.json()) as LegalDocumentsManifest
  const documents = body.documents ?? {}
  return Object.entries(documents)
    .filter(([, doc]) => typeof doc?.current === 'string' && doc.current.length > 0)
    .map(([slug, doc]) => ({ slug, version: doc.current }))
}

const postConsents = async (
  backendUrl: string,
  apiKey: string,
  acceptances: ConsentAcceptance[],
): Promise<void> => {
  const url = `${trimTrailingSlash(backendUrl)}/api/v1/legal-documents/me/consents`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ acceptances, action: 'signup' }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Consent POST failed: HTTP ${res.status} ${res.statusText} ${detail}`.trim())
  }
}

/**
 * Fetch the live legal-documents manifest and POST the current versions for
 * every supplied API key. Entries with empty / missing `key` are skipped so
 * callers can pass `process.env.X` without guarding. Each entry carries a
 * human-readable `label` so per-key failures are diagnosable from CI logs
 * without cross-referencing the call site.
 *
 * Never throws — manifest or POST failures log a warning and return. Uses
 * `Promise.allSettled`-equivalent semantics by catching inside each task,
 * so one bad key never aborts the rest.
 */
export const bootstrapLegalConsent = async (
  backendUrl: string,
  entries: ReadonlyArray<LabelledKey>,
): Promise<void> => {
  const usable = entries.filter(
    (entry): entry is { label: string; key: string } =>
      typeof entry.key === 'string' && entry.key.length > 0,
  )
  if (usable.length === 0) {
    return
  }

  let acceptances: ConsentAcceptance[]
  try {
    acceptances = await fetchManifestAcceptances(backendUrl)
  } catch (error) {
    console.warn(
      `[legal-consent] manifest fetch from ${backendUrl} failed: ${(error as Error).message}. ` +
        `Subsequent gated requests may hit 412.`,
    )
    return
  }

  if (acceptances.length === 0) {
    return
  }

  await Promise.all(
    usable.map(async ({ label, key }) => {
      try {
        await postConsents(backendUrl, key, acceptances)
      } catch (error) {
        console.warn(
          `[legal-consent] consent POST for "${label}" failed: ${(error as Error).message}. ` +
            `Subsequent gated requests may hit 412.`,
        )
      }
    }),
  )
}

const BACKEND_URLS: Record<string, string> = {
  staging_sandbox: 'https://api.sandbox.nevermined.dev/',
  staging_live: 'https://api.live.nevermined.dev/',
  sandbox: 'https://api.sandbox.nevermined.app/',
  live: 'https://api.live.nevermined.app/',
}

export default async function globalSetup(): Promise<void> {
  const envName = process.env.TEST_ENVIRONMENT || 'staging_sandbox'
  const backendUrl = BACKEND_URLS[envName]

  if (!backendUrl) {
    const valid = Object.keys(BACKEND_URLS).join(', ')
    throw new Error(
      `[legal-consent] TEST_ENVIRONMENT="${envName}" is not a remote environment. ` +
        `Valid values: ${valid}.`,
    )
  }

  await bootstrapLegalConsent(backendUrl, [
    { label: 'subscriber', key: process.env.TEST_SUBSCRIBER_API_KEY },
    { label: 'builder', key: process.env.TEST_BUILDER_API_KEY },
  ])
}
