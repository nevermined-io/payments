# CLI Documentation ID Format Update

## Issue
PR feedback indicates that `planId` and `agentId` examples in documentation use incorrect format.

## Current Format (Incorrect)
```
did:nvm:abc123
did:nvm:plan1
did:nvm:agent123
```

## Correct Format (BigInt)
Plan IDs and Agent IDs are returned as large numeric strings (BigInt format):
```
"123456789012345678"
"987654321098765432"
```

## Files to Update
1. cli/docs/getting-started.md
2. cli/docs/plans.md
3. cli/docs/agents.md
4. cli/docs/purchases.md
5. cli/docs/querying.md
6. cli/docs/other-commands.md
7. cli/docs/README.md
8. cli/docs/TESTING_NPM.md

## Example Replacements

### Plans Documentation
**Before**:
```bash
nvm plans get-plan did:nvm:abc123
```

**After**:
```bash
nvm plans get-plan "123456789012345678"
```

### Agents Documentation
**Before**:
```bash
nvm agents get-agent did:nvm:agent123
```

**After**:
```bash
nvm agents get-agent "987654321098765432"
```

### Variable Assignments
**Before**:
```bash
PLAN_ID="did:nvm:abc123"
```

**After**:
```bash
PLAN_ID="123456789012345678"
```

## Implementation Strategy
1. Replace all `did:nvm:abc123` and similar patterns with numeric BigInt strings
2. Use distinct numbers for different entities to avoid confusion
3. Keep examples consistent across documentation
4. Maintain quotes around numeric strings in shell examples

## Standard Example IDs
- Basic plan: `"123456789012345678"`
- Pro plan: `"234567890123456789"`
- Enterprise plan: `"345678901234567890"`
- Trial plan: `"456789012345678901"`
- Agent 1: `"987654321098765432"`
- Agent 2: `"876543210987654321"`
- Agent 3: `"765432109876543210"`
