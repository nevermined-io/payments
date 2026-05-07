/**
 * @file Legal-consent bootstrap for the E2E suite.
 *
 * The backend (`nvm-monorepo`) added a `ConsentRequiredGuard` that returns
 * HTTP 412 (`BCK.LEGAL_DOCS.0004`) on every gated request from a user that
 * hasn't accepted the current versions of `terms` and `privacy`. The pre-baked
 * `TEST_SUBSCRIBER_API_KEY` / `TEST_BUILDER_API_KEY` users carry no consent
 * by default, and even if recorded once they get re-gated whenever the legal
 * manifest publishes a new `requiresReConsent: true` version.
 *
 * To stay self-healing across version bumps, this helper fetches the live
 * manifest and POSTs the current versions for each known SDK key against the
 * staging API before any test runs. The endpoint
 * (`POST /api/v1/legal-documents/me/consents`) is `@Public()` plus the
 * `NvmOrPrivyAuthGuard`, so the SDK Bearer token works without any new creds.
 *
 * No-op-safe by design: if the manifest fetch or any POST fails (backend down,
 * schema change, network blip), we log a warning and return — the underlying
 * problem will surface on the first gated call, mirroring today's behavior
 * and the equivalent helper in
 * `nvm-monorepo/apps/api/src/common/testing/testing-helper.ts:106`.
 *
 * @see https://github.com/nevermined-io/payments/issues/334
 * @see https://github.com/nevermined-io/nvm-monorepo/pull/1409
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

/**
 * Strip a trailing slash from `baseUrl` so callers can concatenate with paths
 * that begin with `/api/v1/...` regardless of which form they were given.
 */
const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '')

/**
 * Fetch the live legal-documents manifest and turn it into an array of
 * `{ slug, version }` acceptances pinned to each document's `current` version.
 */
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

/**
 * Record consent for a single API key. Resolves on success and rejects on
 * any non-2xx response; the caller decides whether a per-key failure should
 * abort the bootstrap or just be logged.
 */
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
 * Public entry point used by the Jest globalSetup. Fetches the manifest once,
 * then posts the current versions for every supplied API key. Per the issue's
 * acceptance criteria we never throw — a manifest or POST failure logs and
 * returns so the test still runs and surfaces the underlying problem on its
 * first gated call.
 *
 * @param backendUrl - Base backend URL (with or without trailing slash).
 * @param apiKeys - SDK Bearer tokens to record consent for. Empty / undefined
 *   entries are skipped silently so callers can pass `process.env.X` without
 *   guarding.
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

/**
 * Internal exports for unit testing. Not part of the helper's stable surface.
 */
export const __testing = {
  fetchManifestAcceptances,
  postConsents,
  trimTrailingSlash,
}
