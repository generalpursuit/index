#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
python3 Scripts/check-sharing-source.py
if ! xcodebuild -version; then
  echo "Full Xcode is required. Select it in Xcode > Settings > Locations > Command Line Tools." >&2
  exit 1
fi
xcrun swift --version

# The Index scheme builds and embeds IndexShare. No physical device or signing is needed.
xcodebuild -project Index.xcodeproj -scheme Index -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath DerivedData/Checks \
  CODE_SIGNING_ALLOWED=NO build

# Use a concrete simulator: generic destinations can hide architecture mismatches
# between Swift packages and the app/extension. Do not override ONLY_ACTIVE_ARCH here.
simulator_id=$(xcrun simctl list devices available --json | python3 -c '
import json, sys
for runtime, devices in json.load(sys.stdin)["devices"].items():
    if ".iOS-" in runtime:
        for device in devices:
            if device["name"].startswith("iPhone") and device.get("isAvailable"):
                print(device["udid"])
                sys.exit(0)
sys.exit("An available iPhone simulator is required. Install an iOS Simulator runtime in Xcode Settings, then create an iPhone simulator if needed.")
')
xcodebuild -project Index.xcodeproj -scheme Index -configuration Debug \
  -destination "platform=iOS Simulator,id=$simulator_id" -derivedDataPath DerivedData/Checks \
  CODE_SIGNING_ALLOWED=NO build

# Compiles the macOS preview and runs the Swift package's unit tests.
xcrun swift test "$@"
