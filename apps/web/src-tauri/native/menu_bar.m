#import <AppKit/AppKit.h>
#import <ServiceManagement/ServiceManagement.h>
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
  icon.size = NSMakeSize(14, 18); icon.template = YES;
  statusItem.button.image = icon;
  statusItem.button.toolTip = @"Index";
  [statusItem.button setAccessibilityLabel:@"Index menu bar"];
  menuTarget = [IndexMenuTarget new];
  statusItem.button.target = menuTarget; statusItem.button.action = @selector(toggle:);
  return 1;
}
void index_menu_present(void *pointer) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  NSStatusBarButton *button = statusItem.button;
  NSScreen *screen = button.window.screen ?: NSScreen.mainScreen;
  NSRect usable = screen.visibleFrame;
  NSRect anchor = [button.window convertRectToScreen:[button convertRect:button.bounds toView:nil]];
  NSRect frame = window.frame;
  frame.size.height = MIN(560, NSHeight(usable) - 12);
  frame.size.width = MIN(420, NSWidth(usable) - 12);
  frame.origin.x = MAX(NSMinX(usable) + 6, MIN(NSMidX(anchor) - frame.size.width / 2, NSMaxX(usable) - frame.size.width - 6));
  frame.origin.y = MAX(NSMinY(usable) + 6, MIN(NSMinY(anchor) - frame.size.height - 6, NSMaxY(usable) - frame.size.height - 6));
  [window setFrame:frame display:YES];
  window.level = NSPopUpMenuWindowLevel;
  window.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace | NSWindowCollectionBehaviorFullScreenAuxiliary;
  [NSApp activateIgnoringOtherApps:YES];
  [window makeKeyAndOrderFront:nil];
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
