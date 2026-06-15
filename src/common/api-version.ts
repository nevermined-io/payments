/**
 * The Nevermined **backend API** version (nvm-monorepo MAJOR.MINOR) this SDK
 * release is built and tested against — NOT the version of the SDK package
 * itself. Every HTTP request the SDK sends to the Nevermined backend carries
 * this value in the {@link API_VERSION_HEADER} header so the backend keeps
 * serving the matching API contract even after newer backend deployments.
 *
 * Bump this constant deliberately, and only when the SDK targets a newer
 * backend contract: update the value, run the e2e suite against a staging
 * backend running that version, then cut a minor SDK release.
 *
 * Callers can override the pin per `Payments` instance via
 * `options.version`.
 *
 * @see https://docs.nevermined.app/api-reference/versioning
 */
export const LOCKED_API_VERSION = '1.1'

/**
 * Name of the HTTP request header carrying the backend API version the SDK
 * is pinned to. Sent on every backend call with the resolved instance
 * version (defaults to {@link LOCKED_API_VERSION}).
 */
export const API_VERSION_HEADER = 'Nevermined-Version'
