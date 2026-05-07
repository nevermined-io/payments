/**
 * @file Jest globalSetup for the E2E suite + the consent-bootstrap helper.
 *
 * Pre-records legal-document consent for the SDK's pre-baked test API keys
 * (issue #334) so the backend `ConsentRequiredGuard` introduced by
 * nvm-monorepo#1409 doesn't HTTP 412 every gated request. Mirrors the
 * pattern in `apps/api/src/common/testing/testing-helper.ts:106`
 * (`recordTestUserLegalConsent`).
 *
 * No-op-safe: a manifest fetch or a per-key POST failure logs a warning and
 * lets the suite proceed — the underlying problem will surface on the first
 * gated call, mirroring today's behavior.
 *
 * --- Why everything lives in a single file ---
 *
 * Jest resolves `globalSetup` outside the worker transform pipeline, and
 * ts-jest's `moduleNameMapper` (which strips the ESM `.js` extensions used
 * throughout this repo) does NOT apply at that layer. As a result, any
 * relative import like `./helpers/legal-consent.js` fails with
 * `Cannot find module` because the on-disk file is `.ts`. Inlining the
 * bootstrap keeps the setup self-contained and immune to the resolver quirk.
 *
 * `bootstrapLegalConsent` is re-exported so the unit suite (which IS subject
 * to `moduleNameMapper`) can import it for testing.
 */

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

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

const fetchManifestAcceptances = async (backendUrl: string): Promise<ConsentAcceptance[]> => {
  const url = `${trimTrailingSlash(backendUrl)}/api/v1/legal-documents/manifest`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })

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
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Consent POST failed: HTTP ${res.status} ${res.statusText} ${detail}`.trim())
  }
}

/**
 * Fetch the live legal-documents manifest and POST the current versions for
 * every supplied API key. Empty / undefined entries are skipped so callers
 * can pass `process.env.X` without guarding.
 *
 * Per the issue's acceptance criteria this never throws — manifest or POST
 * failures log a warning and return.
 */
export const bootstrapLegalConsent = async (
  backendUrl: string,
  apiKeys: ReadonlyArray<string | undefined>,
): Promise<void> => {
  const keys = apiKeys.filter((key): key is string => typeof key === 'string' && key.length > 0)
  if (keys.length === 0) {
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
    keys.map(async (key, index) => {
      try {
        await postConsents(backendUrl, key, acceptances)
      } catch (error) {
        console.warn(
          `[legal-consent] consent POST for key #${index} failed: ${(error as Error).message}. ` +
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

/**
 * Internal exports for unit testing. Not part of the helper's stable surface.
 */
export const __testing = {
  fetchManifestAcceptances,
  postConsents,
  trimTrailingSlash,
  BACKEND_URLS,
}

export default async function globalSetup(): Promise<void> {
  const envName = process.env.TEST_ENVIRONMENT || 'staging_sandbox'
  const backendUrl = BACKEND_URLS[envName]

  if (!backendUrl) {
    console.warn(
      `[legal-consent] TEST_ENVIRONMENT="${envName}" is not a remote environment, ` +
        `skipping consent bootstrap.`,
    )
    return
  }

  await bootstrapLegalConsent(backendUrl, [
    process.env.TEST_SUBSCRIBER_API_KEY,
    process.env.TEST_BUILDER_API_KEY,
  ])
}
