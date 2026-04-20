#!/bin/bash
# Bumps the build number across all platforms (iOS, Android, version.ts)
# Usage: ./mobile/scripts/bump-build.sh [number]
#   If [number] is provided, sets the build number to that value.
#   Otherwise, increments the current build number by 1.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOBILE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

BUILD_GRADLE="$MOBILE_DIR/android/app/build.gradle"
PBXPROJ="$MOBILE_DIR/ios/Cashflow.xcodeproj/project.pbxproj"

# Read current build number from build.gradle (source of truth)
CURRENT=$(grep 'versionCode' "$BUILD_GRADLE" | head -1 | sed 's/[^0-9]//g')

if [ -z "$CURRENT" ]; then
  echo "Error: Could not read versionCode from build.gradle"
  exit 1
fi

if [ -n "$1" ]; then
  NEW="$1"
else
  NEW=$((CURRENT + 1))
fi

echo "Bumping build number: $CURRENT → $NEW"

# 1. Android build.gradle (versionCode in defaultConfig)
sed -i '' "s/^\([[:space:]]*\)versionCode [0-9]* *$/\1versionCode $NEW/" "$BUILD_GRADLE"
echo "  ✓ build.gradle"

# 2. iOS project.pbxproj (CURRENT_PROJECT_VERSION)
sed -i '' "s/CURRENT_PROJECT_VERSION = [0-9]*/CURRENT_PROJECT_VERSION = $NEW/g" "$PBXPROJ"
echo "  ✓ project.pbxproj"

echo ""
echo "Build number is now $NEW across all platforms."
