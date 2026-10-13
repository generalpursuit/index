#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <ServiceManagement/ServiceManagement.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdbool.h>

// Main-thread AppKit bridge. No credentials, account data or notification runtime here.
extern void index_menu_toggle(void);
extern void index_show_main(void);
static NSStatusItem *statusItem;
static int instanceLock = -1;
static id reopenObserver;
@interface IndexMenuTarget : NSObject
- (void)toggle:(id)sender;
@end
@implementation IndexMenuTarget
- (void)toggle:(id)sender { index_menu_toggle(); }
@end
static IndexMenuTarget *menuTarget;
// Only a nonactivating panel opens over another app's full-screen Space; activating Index
// would switch to the Space of its main window instead.
@interface IndexMenuPanel : NSPanel
@end
@implementation IndexMenuPanel
- (BOOL)canBecomeKeyWindow { return YES; }
- (BOOL)canBecomeMainWindow { return NO; }
@end
// Tauri creates an NSWindow, so the panel class replaces it in place. Returns NO, keeping
// app activation, when AppKit no longer offers the activation tag or the panel does not fit.
static BOOL index_menu_nonactivating(NSWindow *window) {
  if ([window isKindOfClass:IndexMenuPanel.class]) return YES;
  SEL preventsActivation = NSSelectorFromString(@"_setPreventsActivation:");
  if (class_getInstanceSize(IndexMenuPanel.class) > class_getInstanceSize(object_getClass(window)) ||
      ![IndexMenuPanel instancesRespondToSelector:preventsActivation]) return NO;
  object_setClass(window, IndexMenuPanel.class);
  window.styleMask |= NSWindowStyleMaskNonactivatingPanel;
  // Replacing the class skips NSPanel initialization, which tags the window for the WindowServer.
  ((void (*)(id, SEL, BOOL))objc_msgSend)(window, preventsActivation, YES);
  return YES;
}

// A per-user lock prevents duplicate UI/pollers, including simultaneous launches.
// Keep the inode and descriptor: deleting the lock file would permit a second owner.
int index_menu_init(const unsigned char *image, size_t imageLength) {
  NSString *bundle = NSBundle.mainBundle.bundleIdentifier ?: @"com.generalpursuit.index";
  NSString *signal = [bundle stringByAppendingString:@".show-main"];
  NSURL *support = [NSFileManager.defaultManager URLForDirectory:NSApplicationSupportDirectory inDomain:NSUserDomainMask appropriateForURL:nil create:YES error:nil];
  NSURL *directory = [support URLByAppendingPathComponent:bundle isDirectory:YES];
  if (!directory || ![NSFileManager.defaultManager createDirectoryAtURL:directory withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:nil]) return -1;
  instanceLock = open([[directory URLByAppendingPathComponent:@"desktop.lock"] fileSystemRepresentation], O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
  if (instanceLock < 0) return -1;
  if (flock(instanceLock, LOCK_EX | LOCK_NB) != 0) {
    close(instanceLock); instanceLock = -1;
    [NSDistributedNotificationCenter.defaultCenter postNotificationName:signal object:nil userInfo:nil deliverImmediately:YES];
    for (NSRunningApplication *app in [NSRunningApplication runningApplicationsWithBundleIdentifier:bundle]) {
      if (app.processIdentifier != getpid()) [app activateWithOptions:NSApplicationActivateIgnoringOtherApps];
    }
    return 0;
  }
  reopenObserver = [NSDistributedNotificationCenter.defaultCenter addObserverForName:signal object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { index_show_main(); }];
  statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSSquareStatusItemLength];
  NSImage *icon = [[NSImage alloc] initWithData:[NSData dataWithBytes:image length:imageLength]];
  if (!icon || !statusItem.button) return -1;
  // Keep the vector's aspect ratio within a quieter 14-point menu-bar height.
  icon.size = NSMakeSize(14 * icon.size.width / icon.size.height, 14); icon.template = YES;
  statusItem.button.image = icon;
  NSString *name = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleDisplayName"] ?: [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleName"] ?: @"Index";
  statusItem.button.toolTip = name;
  [statusItem.button setAccessibilityLabel:[name stringByAppendingString:@" menu bar"]];
  menuTarget = [IndexMenuTarget new];
  statusItem.button.target = menuTarget; statusItem.button.action = @selector(toggle:);
  return 1;
}
void index_menu_present(void *pointer, double width, double height) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  NSStatusBarButton *button = statusItem.button;
  NSScreen *screen = button.window.screen ?: NSScreen.mainScreen;
  NSRect usable = screen.visibleFrame;
  NSRect anchor = [button.window convertRectToScreen:[button convertRect:button.bounds toView:nil]];
  NSRect frame = window.frame;
  frame.size.height = MIN(height, NSHeight(usable) - 12);
  frame.size.width = MIN(width, NSWidth(usable) - 12);
  frame.origin.x = MAX(NSMinX(usable) + 6, MIN(NSMidX(anchor) - frame.size.width / 2, NSMaxX(usable) - frame.size.width - 6));
  frame.origin.y = MAX(NSMinY(usable) + 6, MIN(NSMinY(anchor) - frame.size.height - 6, NSMaxY(usable) - frame.size.height - 6));
  [window setFrame:frame display:YES];
  // A transparent window's shadow follows its drawn shape, which changes with its size.
  [window invalidateShadow];
  window.level = NSPopUpMenuWindowLevel;
  window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
  if (!index_menu_nonactivating(window)) [NSApp activateIgnoringOtherApps:YES];
  [window orderFrontRegardless];
  [window makeKeyWindow];
}
// Content-fit height while open: the top edge stays under the status item while the height eases
// to its new value, at once for someone who reduces motion. A new height retargets from where the
// frame is.
void index_menu_resize(void *pointer, double height) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  NSRect usable = (window.screen ?: NSScreen.mainScreen).visibleFrame;
  NSRect frame = window.frame;
  CGFloat top = NSMaxY(frame);
  frame.size.height = MIN(height, NSHeight(usable) - 12);
  frame.origin.y = MAX(NSMinY(usable) + 6, top - frame.size.height);
  if (NSEqualRects(frame, window.frame)) return;
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion) {
    [window setFrame:frame display:YES];
    [window invalidateShadow];
    return;
  }
  [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
    // Matches the page's row motion.
    context.duration = 0.2;
    context.timingFunction = [CAMediaTimingFunction functionWithControlPoints:0.2 :0 :0 :1];
    [window.animator setFrame:frame display:YES];
  } completionHandler:^{
    // A transparent window's shadow follows its drawn shape, which changes with its size.
    [window invalidateShadow];
  }];
}
// No preference mirror and no registration during launch/status. The OS is authoritative.
int index_login_status(void) {
  if (@available(macOS 13.0, *)) {
    if (![NSBundle.mainBundle.bundlePath.pathExtension isEqualToString:@"app"]) return -1;
    switch (SMAppService.mainAppService.status) {
      case SMAppServiceStatusNotRegistered: return 0;
      case SMAppServiceStatusEnabled: return 1;
      case SMAppServiceStatusRequiresApproval: return 2;
      case SMAppServiceStatusNotFound: return 3;
    }
  }
  return -1;
}
int index_login_set(bool enabled) {
  if (@available(macOS 13.0, *)) {
    if (index_login_status() < 0) return -1;
    NSError *error = nil;
    BOOL success = enabled ? [SMAppService.mainAppService registerAndReturnError:&error] : [SMAppService.mainAppService unregisterAndReturnError:&error];
    return success ? index_login_status() : -2;
  }
  return -1;
}
void index_login_settings(void) {
  if (@available(macOS 13.0, *)) [SMAppService openSystemSettingsLoginItems];
}
