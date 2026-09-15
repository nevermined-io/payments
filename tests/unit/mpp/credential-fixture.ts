/**
 * Builds MPP credentials for the middleware tests.
 *
 * The middleware keys single-use and the in-flight guard on the credential's
 * decoded `challenge.id`, and refuses a credential that carries none — so a
 * fixture has to be a real credential, not an arbitrary token68 string. These
 * tests used to use `Payment eyJjaGFsbGVuZ2UiOnt9fQ<n>`, which decoded to
 * `{"challenge":{}}` plus a garbage byte: no id, and now refused at the edge
 * before any of the behaviour under test could run.
 *
 * Same wire shape `buildCredentialHeader` emits — base64url of
 * `{ challenge: { id, … }, payload: { accessToken } }`.
 */
export function mppCredentialFixture(challengeId: string): string {
  const wire = {
    challenge: {
      id: challengeId,
      realm: 'api.nevermined.app',
      method: 'nevermined',
      intent: 'charge',
      request: 'eyJjcmVkaXRzIjoiMiIsInBsYW5JZCI6IjEyMyJ9',
    },
    payload: { accessToken: 'BASE64_MPP_TOKEN' },
  }
  return `Payment ${Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url')}`
}
