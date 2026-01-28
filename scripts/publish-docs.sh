#!/bin/bash
set -e

# Script to manually publish documentation to docs_mintlify repository
# This is a helper for the GitHub Actions workflow

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================="
echo "Manual Documentation Publication"
echo "=========================================="
echo ""

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: Not in a git repository"
  exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('$PROJECT_ROOT/package.json').version")
echo "Current SDK version: $CURRENT_VERSION"
echo ""

# Check if docs directory exists
if [ ! -d "$PROJECT_ROOT/markdown" ]; then
  echo "Error: markdown directory not found"
  echo "Please generate documentation first:"
  echo "  ./scripts/generate-docs.sh"
  exit 1
fi

# Count markdown files
FILE_COUNT=$(find "$PROJECT_ROOT/markdown" -name "*.mdx" | wc -l)
echo "Found $FILE_COUNT documentation files"

if [ "$FILE_COUNT" -lt 11 ]; then
  echo "Error: Expected at least 11 documentation files"
  exit 1
fi

echo ""
echo "Publishing Options:"
echo "1. Trigger GitHub Actions workflow (recommended)"
echo "2. Manual local publication"
echo ""
read -p "Select option (1 or 2): " OPTION

case $OPTION in
  1)
    echo ""
    echo "Triggering GitHub Actions workflow..."
    echo ""

    # Check if gh CLI is installed
    if ! command -v gh &> /dev/null; then
      echo "Error: GitHub CLI (gh) is not installed"
      echo ""
      echo "Install with:"
      echo "  macOS: brew install gh"
      echo "  Linux: https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
      echo ""
      echo "Or use option 2 for manual publication"
      exit 1
    fi

    # Check if user is logged in
    if ! gh auth status &> /dev/null; then
      echo "Please login to GitHub CLI:"
      gh auth login
    fi

    # Ask for version tag
    read -p "Enter version tag to publish (e.g., v$CURRENT_VERSION): " VERSION_TAG

    if [ -z "$VERSION_TAG" ]; then
      VERSION_TAG="v$CURRENT_VERSION"
    fi

    # Ask for target branch
    echo ""
    echo "Target branch in docs_mintlify repository:"
    echo "  main     - Production documentation (default)"
    echo "  preview  - Preview/testing branch"
    echo "  test     - Test branch"
    echo ""
    read -p "Enter target branch (default: main): " TARGET_BRANCH

    if [ -z "$TARGET_BRANCH" ]; then
      TARGET_BRANCH="main"
    fi

    echo ""
    echo "Publishing documentation:"
    echo "  Version: $VERSION_TAG"
    echo "  Target branch: $TARGET_BRANCH"
    echo ""

    # Trigger workflow
    gh workflow run publish-docs.yml -f version="$VERSION_TAG" -f target_branch="$TARGET_BRANCH"

    echo "✓ Workflow triggered successfully"
    echo ""
    echo "The workflow will create a PR in docs_mintlify targeting the '$TARGET_BRANCH' branch."
    echo ""
    echo "Monitor progress:"
    echo "  gh run list --workflow=publish-docs.yml"
    echo ""
    echo "View logs:"
    echo "  gh run view --workflow=publish-docs.yml"
    echo ""
    echo "After the PR is created:"
    echo "  1. Review the PR in docs_mintlify repository"
    echo "  2. Check Mintlify preview deployment"
    echo "  3. Merge the PR to publish to $TARGET_BRANCH branch"
    echo ""
    ;;

  2)
    echo ""
    echo "Manual Local Publication"
    echo "========================"
    echo ""

    # Check if docs_mintlify is cloned
    DOCS_REPO="$PROJECT_ROOT/../docs_mintlify"

    if [ ! -d "$DOCS_REPO" ]; then
      echo "Cloning docs_mintlify repository..."
      git clone git@github.com:nevermined-io/docs_mintlify.git "$DOCS_REPO"
    else
      echo "Found existing docs_mintlify repository"
      echo "Updating..."
      cd "$DOCS_REPO"
      git fetch origin
      git checkout main
      git pull origin main
      cd "$PROJECT_ROOT"
    fi

    # Create branch
    BRANCH_NAME="update-typescript-docs-v$CURRENT_VERSION"
    echo ""
    echo "Creating branch: $BRANCH_NAME"

    cd "$DOCS_REPO"
    git checkout -b "$BRANCH_NAME" || git checkout "$BRANCH_NAME"

    # Create target directory
    TARGET_DIR="$DOCS_REPO/docs/api-reference/typescript"
    mkdir -p "$TARGET_DIR"

    # Copy files
    echo "Copying documentation files..."
    cp "$PROJECT_ROOT/markdown"/*.mdx "$TARGET_DIR/"

    # Count copied files
    COPIED_COUNT=$(find "$TARGET_DIR" -name "*.mdx" | wc -l)
    echo "✓ Copied $COPIED_COUNT files to $TARGET_DIR"

    # Show status
    echo ""
    echo "Git status:"
    git status --short

    echo ""
    read -p "Create commit and push? (y/n): " CONFIRM

    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
      # Commit
      git add docs/api-reference/typescript/
      git commit -m "docs: update TypeScript SDK documentation for v$CURRENT_VERSION

- Updated from nevermined-io/payments
- SDK version: v$CURRENT_VERSION
- Generated documentation from local build"

      # Push
      git push origin "$BRANCH_NAME"

      echo ""
      echo "✓ Changes pushed to branch: $BRANCH_NAME"
      echo ""
      echo "Create pull request:"
      echo "  cd $DOCS_REPO"
      echo "  gh pr create --title 'docs: Update TypeScript SDK Documentation (v$CURRENT_VERSION)' --body 'Automated documentation update'"
      echo ""
    else
      echo "Changes not committed. Review in: $DOCS_REPO"
    fi

    cd "$PROJECT_ROOT"
    ;;

  *)
    echo "Invalid option"
    exit 1
    ;;
esac

echo ""
echo "=========================================="
echo "Publication process complete!"
echo "=========================================="
