export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // plans.test.ts and agents.test.ts were un-ignored in #446 — both only
    // needed their imports repointed at the renamed generated commands.
    //
    // config.test.ts stays ignored: it fails with a Jest TRANSFORM error via
    // src/commands/config/init.ts, not a stale assertion — an ESM dependency
    // the transform does not handle. That is a jest-config problem of its own
    // and is tracked on #446; do not un-ignore it without fixing the transform.
    '/test/unit/config.test.ts',
  ],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/test/__mocks__/chalk.js',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false,
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 30000,
}
