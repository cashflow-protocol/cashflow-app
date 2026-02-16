#!/bin/bash

# Script to check for Android emulator and run the app

echo "🤖 Checking for running Android emulator..."

# Check if any emulator/device is running
RUNNING_DEVICES=$(adb devices | grep -E "emulator|device" | grep -v "List of devices" | wc -l)

if [ "$RUNNING_DEVICES" -gt 0 ]; then
  echo "✅ Android device/emulator detected!"
  adb devices
else
  echo ""
  echo "❌ No Android emulator or device detected!"
  echo ""
  echo "📱 Please start an emulator manually:"
  echo "   1. Open Android Studio"
  echo "   2. Click 'Device Manager' (phone icon)"
  echo "   3. Start 'Medium_Phone_API_36.1' or 'Pixel_9'"
  echo ""
  echo "Or connect a physical device via USB"
  echo ""
  exit 1
fi

# Run the React Native app
echo ""
echo "🚀 Building and running Cashflow app..."
npx react-native run-android
