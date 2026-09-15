/**
 * Real-SDK smoke test (NO jest.mock) guarding the langsmith import path that
 * `loadLangsmith()` (src/x402/langsmith/spans.ts) depends on.
 *
 * Why this exists: `getCurrentRunTree` is NOT exported from the `langsmith`
 * root — it lives exclusively at the `langsmith/singletons/traceable` sub-path.
 * The wiring tests in `langsmith-spans.test.ts` / `langsmith-decorator.test.ts`
 * MOCK that sub-path, so they would stay green even if the real package moved
 * or renamed the export. That is the exact regression that once shipped the
 * whole observability feature dead with a green CI (the import resolved, the
 * `typeof getCurrentRunTree === 'function'` check silently failed, every span
 * no-op'd). This test asserts the real contract so a future langsmith
 * re-arrangement fails HERE instead of at a customer.
 *
 * It imports the REAL module in a child `node` process rather than directly in
 * jest: the project's jest config does not transform `node_modules` (langsmith
 * pulls in ESM-only deps such as `uuid`), so a direct `import('langsmith/...')`
 * inside a jest test fails to load for reasons unrelated to the export shape.
 * Node imports the real ESM module natively, exactly as production does at
 * runtime, so this faithfully exercises the path `loadLangsmith()` takes.
 */
import { execFileSync } from 'node:child_process'

describe('langsmith real-SDK import path (no mock)', () => {
  it('exports getCurrentRunTree as a function from langsmith/singletons/traceable', () => {
    // Mirrors the runtime import in `loadLangsmith()`. On success prints
    // `function`; on a missing export prints `<typeof>`; on a failed import
    // prints `import-error:<code>` and exits non-zero (surfaced by execFileSync).
    const script =
      "import('langsmith/singletons/traceable')" +
      '.then((m) => process.stdout.write(typeof m.getCurrentRunTree))' +
      ".catch((e) => { process.stdout.write('import-error:' + (e && e.code)); process.exitCode = 1 })"

    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })

    expect(out).toBe('function')
  })
})
