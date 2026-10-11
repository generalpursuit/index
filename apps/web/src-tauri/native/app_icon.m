#import <AppKit/AppKit.h>
#include <stdbool.h>

// This is a device preference, independent of the signed-in account and theme.
#ifdef INDEX_NATIVE_SMOKE
static NSString *const iconKey = @"index.app-icon.native-smoke";
#else
static NSString *const iconKey = @"index.app-icon";
#endif

int index_app_icon_read(void) {
  return [NSUserDefaults.standardUserDefaults integerForKey:iconKey] == 1 ? 1 : 0;
}

bool index_app_icon_apply(const unsigned char *bytes, size_t length, int choice, bool persist) {
  __block bool applied = false;
  void (^apply)(void) = ^{
    NSImage *image = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    if (!image || !NSApp) return;
    // Never edit the signed .app bundle. AppKit updates the running application's Dock tile.
    NSApp.applicationIconImage = image;
    if (persist) [NSUserDefaults.standardUserDefaults setInteger:choice forKey:iconKey];
    applied = true;
  };
  if (NSThread.isMainThread) apply();
  else dispatch_sync(dispatch_get_main_queue(), apply);
  return applied;
}

#ifdef INDEX_NATIVE_SMOKE
static void renderIcon(NSImage *image, unsigned char *pixels) {
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef bitmap = CGBitmapContextCreate(pixels, 64, 64, 8, 64 * 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithCGContext:bitmap flipped:NO];
  [image drawInRect:NSMakeRect(0, 0, 64, 64) fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1];
  [NSGraphicsContext restoreGraphicsState];
  CGContextRelease(bitmap);
  CGColorSpaceRelease(space);
}

bool index_app_icon_matches(const unsigned char *bytes, size_t length) {
  __block bool matches = false;
  void (^check)(void) = ^{
    NSImage *expected = [[NSImage alloc] initWithData:[NSData dataWithBytes:bytes length:length]];
    if (!expected || !NSApp.applicationIconImage) return;
    // AppKit returns a display-color-space snapshot, not the original PNG representation.
    // Compare normalized pixels with a small allowance for color conversion/resampling.
    unsigned char actualPixels[64 * 64 * 4] = {0}, expectedPixels[64 * 64 * 4] = {0};
    renderIcon(expected, expectedPixels);
    renderIcon(NSApp.applicationIconImage, actualPixels);
    unsigned int difference = 0;
    for (size_t i = 0; i < sizeof(actualPixels); i++) difference += abs(actualPixels[i] - expectedPixels[i]);
    matches = (double)difference / sizeof(actualPixels) < 3;
  };
  if (NSThread.isMainThread) check();
  else dispatch_sync(dispatch_get_main_queue(), check);
  return matches;
}
#endif
