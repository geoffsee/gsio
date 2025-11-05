#!/usr/bin/env sh

# Get version from package.json
VERSION=$(cat package.json | jq -r .version)

# Calculate deterministic hash of build context
CONTEXT_HASH=$(find . -type f -not -path "./node_modules/*" -not -path "./dist/*" -not -path "./.git/*" -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1 | head -c 8)

# Build tag using version and hash
TAG="${VERSION}-${CONTEXT_HASH}"

# Multiarch build
docker buildx build --platform linux/amd64,linux/arm64 -f Containerfile -t ghcr.io/geoffsee/gsio:${TAG}-alpine -t ghcr.io/geoffsee/gsio:latest-alpine .
