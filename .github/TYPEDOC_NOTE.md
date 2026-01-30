# TypeDoc HTML Documentation Note

## Current Status

The TypeDoc HTML documentation in `docs/` cannot be regenerated at the moment due to TypeScript compilation errors.

## Build Errors

When running `yarn doc` or `yarn build`, the following errors occur:

```
src/a2a/paymentsClient.ts(36,11): error TS2345: Argument of type 'AgentCard' is not assignable to parameter of type 'string'.
src/a2a/paymentsClient.ts(55,33): error TS2339: Property 'fromCardUrl' does not exist on type 'typeof A2AClient'.
src/api/observability-api/observability-api.ts(11,28): error TS2307: Cannot find module '@traceloop/node-server-sdk'
src/api/observability-api/observability-api.ts(12,49): error TS2307: Cannot find module '@opentelemetry/api'
...and more
```

## Root Causes

1. **A2A SDK API Changes**: The `@a2a-js/sdk` dependency appears to have breaking changes in the A2AClient API
2. **Missing Optional Dependencies**: Several observability-related dependencies are not installed (OpenTelemetry, traceloop, LangChain, etc.)
3. **Type Imports**: Optional peer dependencies are imported without checking if they're available

## Impact

- `yarn build` fails
- `yarn doc` (TypeDoc generation) fails
- Existing `docs/` HTML documentation is outdated (last updated Jan 28)
- Tests may be affected if they depend on compilation

## Workarounds

### For Documentation

The new **markdown documentation system** (introduced in this PR) is not affected:
- Located in `markdown/` directory
- 11 LLM-friendly MDX files
- Automatically maintained via GitHub Actions
- Does not depend on TypeScript compilation

### For Development

If you need to work on code:
1. Fix the A2A SDK compatibility issues in `src/a2a/paymentsClient.ts`
2. Make observability dependencies truly optional by using dynamic imports
3. Or install all optional dependencies temporarily

## Recommended Fixes

### Quick Fix (Temporary)

Install missing dependencies:
```bash
yarn add -D @traceloop/node-server-sdk @opentelemetry/api @opentelemetry/exporter-trace-otlp-http
yarn add -D openai together-ai langchain @anthropic-ai/sdk cohere-ai
yarn add -D @aws-sdk/client-bedrock-runtime @google-cloud/aiplatform
```

### Proper Fix (Long-term)

1. **Fix A2A Client Usage** (`src/a2a/paymentsClient.ts`):
   ```typescript
   // Check @a2a-js/sdk documentation for correct API
   // Update constructor and static method calls
   ```

2. **Make Optional Imports Truly Optional** (`src/api/observability-api/`):
   ```typescript
   // Use dynamic imports with try-catch
   // Or use type-only imports: import type { ... }
   ```

3. **Update tsconfig.json**:
   ```json
   {
     "compilerOptions": {
       "skipLibCheck": true  // Skip type checking for node_modules
     }
   }
   ```

## Impact on This PR

This PR introduces the markdown documentation system which:
- ✅ Works independently of TypeDoc
- ✅ Does not require compilation
- ✅ Can be validated and published regardless of build status
- ❌ Does not update the HTML docs in `docs/` (separate issue)

## Next Steps

1. **Merge this PR** - The markdown documentation system is ready and working
2. **Create separate issue** - Track the TypeDoc build errors
3. **Fix build issues** - Address A2A SDK and optional dependencies
4. **Regenerate HTML docs** - Run `yarn doc` after build is fixed

## Related Files

- TypeDoc config: `package.json` (doc script)
- Source code: `src/` directory
- HTML output: `docs/` directory
- Markdown docs: `markdown/` directory (new, works correctly)

## References

- [TypeDoc Documentation](https://typedoc.org/)
- [@a2a-js/sdk Repository](https://github.com/AgentProtocol/agent-protocol-sdk-js)
- [OpenTelemetry Documentation](https://opentelemetry.io/)
