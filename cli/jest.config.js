export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/test/unit/config.test.ts',
    '/test/unit/plans.test.ts',
    '/test/unit/agents.test.ts',
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
