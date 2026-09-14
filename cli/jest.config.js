export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // #446 — all three previously-ignored files (plans, agents, config) now run.
  // plans/agents needed their imports repointed at the renamed generated
  // commands; config needed the ESM transform below.
  testPathIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^chalk$': '<rootDir>/test/__mocks__/chalk.js',
  },
  // inquirer@9 and its dependency chain ship ESM. Same shape as the SDK's
  // tests/jest.config.json (#451), including the `(\\.pnpm/)?` hop that pnpm's
  // store layout requires.
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm/)?(inquirer|ora|cli-cursor|restore-cursor|onetime|mimic-fn|log-symbols|is-unicode-supported|is-interactive|strip-ansi|ansi-regex|ansi-styles|wrap-ansi|string-width|emoji-regex|cli-spinners|bl|run-async|rxjs|mute-stream|external-editor|figures|@inquirer)[@/])',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: false,
      },
    ],
    '^.+\\.m?js$': [
      'ts-jest',
      {
        useESM: false,
        isolatedModules: true,
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
