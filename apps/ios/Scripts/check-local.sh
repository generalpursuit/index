#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if xcodebuild -version >/dev/null 2>&1; then
  swift test "$@"
else
  # This machine's CLT omits the SwiftUI 27 macro plugin and Testing runtime search paths.
  tools=/Library/Developer/CommandLineTools
  swift test --sdk "$tools/SDKs/MacOSX26.5.sdk" \
    -Xswiftc -load-plugin-library \
    -Xswiftc "$tools/usr/lib/swift/host/plugins/testing/libTestingMacros.dylib" \
    -Xlinker -rpath -Xlinker "$tools/Library/Developer/Frameworks" \
    -Xlinker -rpath -Xlinker "$tools/Library/Developer/usr/lib" "$@"
fi
