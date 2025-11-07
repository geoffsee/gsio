#!/usr/bin/env bash

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}Release Workflow Trigger${NC}"
echo ""
echo "Select release type:"
echo "1) patch"
echo "2) minor"
echo "3) major"
echo "4) alpha"
echo "5) beta"
echo "6) prerelease"
echo ""
read -p "Enter choice [1-6]: " choice

case $choice in
  1) RELEASE_TYPE="patch" ;;
  2) RELEASE_TYPE="minor" ;;
  3) RELEASE_TYPE="major" ;;
  4) RELEASE_TYPE="alpha" ;;
  5) RELEASE_TYPE="beta" ;;
  6) RELEASE_TYPE="prerelease" ;;
  *) echo "Invalid choice"; exit 1 ;;
esac

echo ""
echo -e "${YELLOW}Triggering release workflow with type: ${GREEN}$RELEASE_TYPE${NC}"
echo ""

gh workflow run release.yml -f release-type="$RELEASE_TYPE"

echo ""
echo -e "${GREEN}✓ Workflow triggered!${NC}"
echo ""
echo "View progress at:"
gh run list --workflow=release.yml --limit=1 --json url --jq='.[0].url'
