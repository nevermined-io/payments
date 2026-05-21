import { decodeJwt } from 'jose'
import { jsonReplacer } from '../common/helper.js'
import { PaymentsError } from '../common/payments.error.js'
import { PaymentOptions, PaymentScheme } from '../common/types.js'
import { EnvironmentInfo, EnvironmentName, Environments } from '../environments.js'

/**
 * Header used by the Nevermined backend to resolve the active organization
 * context for an authenticated request. Resolution priority is:
 * path `:orgId` &gt; this header &gt; API-key tag &gt; fallback membership &gt; personal.
 * See `apps/api/src/common/guards/current-org-context.guard.ts` in nvm-monorepo.
 */
export const CURRENT_ORG_ID_HEADER = 'X-Current-Org-Id'

/**
 * Set of header names that callers can pass to `getBackendHTTPOptions` via
 * `extraHeaders`. Anything outside this set is dropped silently so a stray
 * `Authorization` or `Content-Type` override can't clobber the SDK's
 * transport security headers.
 */
const ALLOWED_EXTRA_HEADERS = new Set<string>([CURRENT_ORG_ID_HEADER])

/**
 * Options accepted by publication methods (`registerAgent`,
 * `registerAgentAndPlan`, `registerPlan`, …) that want to override the
 * active organization workspace for a single call.
 */
export type PublicationOptions = {
  /**
   * Organization id (e.g. `org-…`) to publish into. When set, the SDK
   * sends an `X-Current-Org-Id` header for this call only — the caller's
   * instance-level pin (set via `Payments.setOrganizationId`) is not
   * affected.
   */
  organizationId?: string
}

/**
 * Builds the `extraHeaders` argument for `getBackendHTTPOptions` from
 * publication options. Returns `undefined` when no override is requested
 * so existing callers receive identical request shapes.
 */
export function resolvePublicationHeaders(
  options?: PublicationOptions,
): Record<string, string> | undefined {
  if (options?.organizationId) {
    return { [CURRENT_ORG_ID_HEADER]: options.organizationId }
  }
  return undefined
}

/**
 * Base class extended by all Payments API classes.
 * It provides common functionality such as parsing the NVM API Key and getting the account address.
 */
export abstract class BasePaymentsAPI {
  protected nvmApiKey: string
  protected scheme: PaymentScheme
  protected environment: EnvironmentInfo
  protected environmentName: EnvironmentName
  protected returnUrl: string
  protected appId?: string
  protected version?: string
  protected accountAddress: string
  protected heliconeApiKey: string
  protected currentOrganizationId: string | null
  public isBrowserInstance = true

  constructor(options: PaymentOptions) {
    // Type-level narrowing of PaymentScheme to 'nvm' won't protect callers
    // pinned to an older .d.ts that still has 'visa' in the union — they
    // would silently fall through to the standard pipeline and hit a
    // misleading 'Invalid NVM API Key' from parseNvmApiKey when the
    // legacy Visa path tolerated a non-JWT key. Reject up front with a
    // clear migration message.
    if (options.scheme && options.scheme !== 'nvm') {
      throw new PaymentsError(
        `scheme '${options.scheme}' is no longer supported. Visa is now exposed as provider:'visa' on createDelegation; construct Payments without a scheme override.`,
      )
    }
    this.nvmApiKey = options.nvmApiKey
    this.scheme = options.scheme || 'nvm'
    this.returnUrl = options.returnUrl || ''
    this.environment = Environments[options.environment as EnvironmentName]
    this.environmentName = options.environment
    this.appId = options.appId
    this.version = options.version
    this.currentOrganizationId = options.organizationId ?? null

    const { accountAddress, heliconeApiKey } = this.parseNvmApiKey()
    this.accountAddress = accountAddress
    this.heliconeApiKey = heliconeApiKey
  }

  /**
   * Parses the NVM API Key to extract the account address.
   * @throws PaymentsError if the API key is invalid.
   */
  protected parseNvmApiKey(): { accountAddress: string; heliconeApiKey: string } {
    try {
      if (!this.nvmApiKey) {
        throw new PaymentsError('NVM API Key is required')
      }
      const jwt = decodeJwt(this.nvmApiKey)
      const accountAddress = jwt.sub as string
      const heliconeApiKey = jwt.o11y as string
      return { accountAddress, heliconeApiKey }
    } catch (error) {
      throw new PaymentsError('Invalid NVM API Key')
    }
  }

  /**
   * Returns the environment name used to initialize the Payments instance.
   * @returns The environment name (e.g. 'sandbox', 'live')
   */
  public getEnvironmentName(): EnvironmentName {
    return this.environmentName
  }

  /**
   * It returns the account address associated with the NVM API Key used to initialize the Payments Library instance.
   * @returns The account address extracted from the NVM API Key
   */
  public getAccountAddress(): string | undefined {
    return this.accountAddress
  }

  /**
   * Returns the current organization context applied to every authenticated
   * backend request via the `X-Current-Org-Id` header.
   *
   * `null` means "no pinned workspace" — the backend falls back to the
   * caller's API-key tag or most-recent active membership.
   */
  public getOrganizationId(): string | null {
    return this.currentOrganizationId
  }

  /**
   * Sets the organization context applied to every subsequent authenticated
   * backend request via the `X-Current-Org-Id` header.
   *
   * Pass `null` to clear the pin and fall back to the backend default.
   *
   * @param organizationId - Org ID (e.g. `org-…`) or `null` to clear.
   */
  public setOrganizationId(organizationId: string | null): void {
    this.currentOrganizationId = organizationId
  }

  /**
   * Returns the HTTP options required to query the backend.
   * @param method - HTTP method.
   * @param body - Optional request body.
   * @param extraHeaders - Optional per-call header overrides. Use
   *   `{ 'X-Current-Org-Id': orgId }` to target a specific workspace for
   *   one call without mutating the instance-level pin.
   * @returns HTTP options object.
   * @internal
   */
  protected getBackendHTTPOptions(
    method: string,
    body?: any,
    extraHeaders?: Record<string, string>,
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.nvmApiKey}`,
    }
    if (this.currentOrganizationId) {
      headers[CURRENT_ORG_ID_HEADER] = this.currentOrganizationId
    }
    if (extraHeaders) {
      // Allowlist callers' header overrides so a passed-in `Authorization`
      // or `Content-Type` can't clobber the SDK's transport security
      // headers. Today only `X-Current-Org-Id` is allowed through.
      for (const [name, value] of Object.entries(extraHeaders)) {
        if (ALLOWED_EXTRA_HEADERS.has(name)) {
          headers[name] = value
        }
      }
    }
    return {
      method,
      headers,
      ...(body && { body: JSON.stringify(body, jsonReplacer) }),
    }
  }

  /**
   * Get HTTP options for public backend requests (no authorization header).
   * Converts body keys from snake_case to camelCase for consistency.
   *
   * @param method - HTTP method
   * @param body - Optional request body (keys will be converted to camelCase)
   * @returns HTTP options object
   * @internal
   */
  protected getPublicHTTPOptions(method: string, body?: any) {
    const options: {
      method: string
      headers: {
        Accept: string
        'Content-Type': string
      }
      body?: string
    } = {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    }

    if (body) {
      options.body = JSON.stringify(body, jsonReplacer)
    }

    return options
  }
}
