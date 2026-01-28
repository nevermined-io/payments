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
  "01-installation.mdx"
  "02-initializing-the-library.mdx"
  "03-payment-plans.mdx"
  "04-agents.mdx"
  "05-publishing-static-resources.mdx"
  "06-payments-and-balance.mdx"
  "07-querying-an-agent.mdx"
  "08-validation-of-requests.mdx"
  "09-mcp-integration.mdx"
  "10-a2a-integration.mdx"
  "11-x402.mdx"
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

# Add SDK version comment to each file
echo "Adding version metadata to documentation files..."
for file in "${EXPECTED_FILES[@]}"; do
  DOC_FILE="$MARKDOWN_DIR/$file"

  # Check if version comment already exists
  if ! grep -q "<!-- SDK Version:" "$DOC_FILE"; then
    # Add version comment at the top
    TEMP_FILE=$(mktemp)
    echo "<!-- SDK Version: $SDK_VERSION -->" > "$TEMP_FILE"
    echo "<!-- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC") -->" >> "$TEMP_FILE"
    echo "" >> "$TEMP_FILE"
    cat "$DOC_FILE" >> "$TEMP_FILE"
    mv "$TEMP_FILE" "$DOC_FILE"
    echo "  ✓ Updated: $file"
  else
    # Update existing version comment
    sed -i.bak "s/<!-- SDK Version: .* -->/<!-- SDK Version: $SDK_VERSION -->/" "$DOC_FILE"
    sed -i.bak "s/<!-- Generated: .* -->/<!-- Generated: $(date -u +"%Y-%m-%d %H:%M:%S UTC") -->/" "$DOC_FILE"
    rm -f "$DOC_FILE.bak"
    echo "  ✓ Updated: $file"
  fi
done

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
