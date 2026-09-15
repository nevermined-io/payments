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
        // TS151002 ("hybrid module kind is only supported in isolatedModules: true")
        // fires once per compiled file because cli/tsconfig.json says module: Node16.
        // ts-jest's CJS path rewrites the effective options to CommonJS/node10 anyway
        // (fixupCompilerOptionsForModuleKind), so the warning describes nothing that
        // happens here.
        //
        // Do NOT follow its advice. With isolatedModules: true ts-jest never builds the
        // language service; it transpiles per file through tsTranspileModule with the
        // UN-rewritten options, so module: Node16 plus "type": "module" in
        // cli/package.json makes it emit ESM while this config runs CJS, and every suite
        // dies on "Cannot use import statement outside a module". Both siblings (root
        // SDK, openclaw) get away with isolatedModules because they run jest as ESM.
        //
        // Drop this line only when the CLI runs as ESM too AND sets isolatedModules —
        // and note what that trades away: the transpile path reports syntactic and
        // option diagnostics only, so this language-service path is currently the only
        // type gate over cli/test/**, which has no typecheck:tests of its own.
        diagnostics: { ignoreCodes: [151002] },
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
