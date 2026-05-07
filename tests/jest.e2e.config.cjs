/**
 * @file Jest config for the E2E suite.
 *
 * Identical to `jest.config.json` aside from the `globalSetup` hook that
 * pre-records legal-document consent for the SDK test users (issue #334).
 * Kept separate so unit/integration runs never touch the staging API.
 */

const baseConfig = require('./jest.config.json')

module.exports = {
  ...baseConfig,
  globalSetup: '<rootDir>/e2e/global-setup.ts',
}
