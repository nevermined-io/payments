#!/bin/bash
set -e

# Script to regenerate markdown documentation
# This script should be run when source code changes to keep docs in sync

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MARKDOWN_DIR="$PROJECT_ROOT/markdown"

echo "=========================================="
echo "Nevermined Payments Documentation Generator"
echo "=========================================="
echo ""

# Check if markdown directory exists
if [ ! -d "$MARKDOWN_DIR" ]; then
  echo "Creating markdown directory..."
  mkdir -p "$MARKDOWN_DIR"
fi

echo "Documentation directory: $MARKDOWN_DIR"
echo ""

# Check for required files
echo "Checking for required source files..."
REQUIRED_FILES=(
  "src/payments.ts"
  "src/plans.ts"
  "src/api/plans-api.ts"
  "src/api/agents-api.ts"
  "src/x402/token.ts"
  "src/x402/facilitator-api.ts"
  "src/mcp/index.ts"
  "src/a2a/index.ts"
  "tests/e2e/test_payments_e2e.test.ts"
  "tests/e2e/test_x402_e2e.test.ts"
)

ALL_EXIST=true
for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$PROJECT_ROOT/$file" ]; then
    echo "  ✗ Missing: $file"
    ALL_EXIST=false
  else
    echo "  ✓ Found: $file"
  fi
done

if [ "$ALL_EXIST" = false ]; then
  echo ""
  echo "Error: Some required source files are missing."
  exit 1
fi

echo ""
echo "All required files found."
echo ""

# Get SDK version from package.json
SDK_VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
echo "SDK Version: $SDK_VERSION"
echo ""

# Note: Actual doc generation would require Claude Code or a custom generator
# For CI/CD, we'll use a placeholder that maintains existing docs
echo "=========================================="
echo "Documentation Regeneration"
echo "=========================================="
echo ""
echo "Note: Full documentation regeneration requires Claude Code."
echo "For CI/CD automation, we validate existing documentation."
echo ""

# Validate existing docs
EXPECTED_FILES=(
  "installation.md"
  "initializing-the-library.md"
  "payment-plans.md"
  "agents.md"
  "publishing-static-resources.md"
  "payments-and-balance.md"
  "querying-an-agent.md"
  "validation-of-requests.md"
  "mcp-integration.md"
  "a2a-integration.md"
  "x402.md"
)

echo "Validating existing documentation files..."
MISSING_DOCS=false
for file in "${EXPECTED_FILES[@]}"; do
  if [ ! -f "$MARKDOWN_DIR/$file" ]; then
    echo "  ✗ Missing: $file"
    MISSING_DOCS=true
  else
    echo "  ✓ Found: $file"
  fi
done

if [ "$MISSING_DOCS" = true ]; then
  echo ""
  echo "Warning: Some documentation files are missing."
  echo "Please regenerate documentation using Claude Code."
  echo ""
  echo "To regenerate docs:"
  echo "  1. Open the project in Claude Code"
  echo "  2. Ask: 'Regenerate the markdown documentation following MINTLIFY_API_REFERENCE.md'"
  exit 1
fi

echo ""
echo "✓ All documentation files present"
echo ""
echo "Note: Version tracking is managed through Mintlify metadata headers."
echo ""
echo "=========================================="
echo "Documentation validation complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - SDK Version: $SDK_VERSION"
echo "  - Documentation files: ${#EXPECTED_FILES[@]}"
echo "  - Location: $MARKDOWN_DIR"
echo ""
echo "Next steps:"
echo "  - Review changes: git diff markdown/"
echo "  - Commit changes: git add markdown/ && git commit -m 'docs: update documentation'"
echo ""
