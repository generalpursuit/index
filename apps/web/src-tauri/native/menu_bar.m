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
extern void index_menu_dismiss(void);
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
// The panel's surface behind its transparent WebView: Liquid Glass where macOS has it (26 and
// later), the menu material otherwise, and opaque while Reduce transparency is on, as macOS draws
// menus then. Light glass reads grey over most wallpapers, so it is tinted toward white by this
// much (0 to 1); dark mode keeps the system's own glass.
static const CGFloat kPanelWhiteTint = 0.4;
static const CGFloat kPanelCornerRadius = 16;

static BOOL index_dark(NSAppearance *appearance) {
  return [[appearance bestMatchFromAppearancesWithNames:@[NSAppearanceNameAqua, NSAppearanceNameDarkAqua]] isEqualToString:NSAppearanceNameDarkAqua];
}
static NSColor *index_panel_color(NSColor *light, NSColor *dark) {
  return [NSColor colorWithName:nil dynamicProvider:^NSColor *(NSAppearance *appearance) { return index_dark(appearance) ? dark : light; }];
}
// A rounded fill with the hairline edge the panel draws where it has no glass rim.
@interface IndexPanelFill : NSView
@property(copy) NSColor *color;
@end
@implementation IndexPanelFill
- (void)drawRect:(__unused NSRect)dirty {
  NSBezierPath *shape = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 0.25, 0.25) xRadius:kPanelCornerRadius yRadius:kPanelCornerRadius];
  [self.color setFill];
  [shape fill];
  shape.lineWidth = 0.5;
  [index_panel_color([NSColor colorWithWhite:0 alpha:0.14], [NSColor colorWithWhite:1 alpha:0.14]) setStroke];
  [shape stroke];
}
@end
@interface IndexPanelSurface : NSView
@end
@implementation IndexPanelSurface
- (void)rebuild {
  for (NSView *view in [self.subviews copy]) [view removeFromSuperview];
  NSView *surface;
  Class glass = NSClassFromString(@"NSGlassEffectView");
  if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency) {
    IndexPanelFill *fill = [[IndexPanelFill alloc] initWithFrame:self.bounds];
    fill.color = NSColor.windowBackgroundColor;
    surface = fill;
  } else if (glass) {
    // Looked up at run time, so older macOS and SDKs build and run without it.
    surface = [[glass alloc] initWithFrame:self.bounds];
    [surface setValue:@(kPanelCornerRadius) forKey:@"cornerRadius"];
  } else {
    NSVisualEffectView *effect = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
    effect.material = NSVisualEffectMaterialMenu;
    effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
    effect.state = NSVisualEffectStateActive;
    NSImage *mask = [NSImage imageWithSize:NSMakeSize(2 * kPanelCornerRadius + 1, 2 * kPanelCornerRadius + 1) flipped:NO drawingHandler:^BOOL(NSRect rect) {
      [NSColor.blackColor setFill];
      [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:kPanelCornerRadius yRadius:kPanelCornerRadius] fill];
      return YES;
    }];
    mask.capInsets = NSEdgeInsetsMake(kPanelCornerRadius, kPanelCornerRadius, kPanelCornerRadius, kPanelCornerRadius);
    mask.resizingMode = NSImageResizingModeStretch;
    effect.maskImage = mask;
    IndexPanelFill *tint = [[IndexPanelFill alloc] initWithFrame:effect.bounds];
    tint.color = index_panel_color([NSColor colorWithWhite:1 alpha:kPanelWhiteTint], NSColor.clearColor);
    tint.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [effect addSubview:tint];
    surface = effect;
  }
  // Follows the window's frame, and with it the height animation.
  surface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [self addSubview:surface];
  [self viewDidChangeEffectiveAppearance];
  [self.window invalidateShadow];
}
- (void)viewDidChangeEffectiveAppearance {
  [super viewDidChangeEffectiveAppearance];
  NSView *surface = self.subviews.firstObject;
  // The glass takes a plain color, so it is chosen again for each appearance.
  Class glass = NSClassFromString(@"NSGlassEffectView");
  if (glass && [surface isKindOfClass:glass])
    [surface setValue:index_dark(self.effectiveAppearance) ? nil : [NSColor colorWithWhite:1 alpha:kPanelWhiteTint] forKey:@"tintColor"];
  for (NSView *view in surface.subviews) view.needsDisplay = YES;
  surface.needsDisplay = YES;
}
@end
static id transparencyChanged;
// Once, when the panel is built: the surface goes behind the WebView and follows Reduce
// transparency while Index runs. The content is clipped to the panel's shape: macOS traces the
// window's shadow from what it draws, and a page that draws its opaque background (as it does
// before the panel page mounts) would otherwise leave a square shadow and rim at the corners. The
// circular corner encloses the glass's continuous one and matches the other surfaces.
void index_menu_prepare(void *pointer) {
  NSView *content = ((__bridge NSWindow *)pointer).contentView;
  content.wantsLayer = YES;
  content.layer.cornerRadius = kPanelCornerRadius;
  content.layer.masksToBounds = YES;
  IndexPanelSurface *surface = [[IndexPanelSurface alloc] initWithFrame:content.bounds];
  surface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [content addSubview:surface positioned:NSWindowBelow relativeTo:nil];
  [surface rebuild];
  transparencyChanged = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) { [surface rebuild]; }];
}
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

// While shown, the panel closes like other menu bar extras: on a click anywhere else, when another
// menu opens or when another app becomes active. Index's own status item toggles it, and Index's
// own windows take key status from it. Watching clicks needs no Accessibility permission.
static id outsideClicks, otherMenus, otherApps, ownMenuBegan, ownMenuEnded;
static NSInteger ownMenus;
static void index_menu_watch(void) {
  if (outsideClicks) return;
  outsideClicks = [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown | NSEventMaskOtherMouseDown handler:^(__unused NSEvent *event) { index_menu_dismiss(); }];
  // HIToolbox announces every menu, including a context menu inside the panel; only others close it.
  NSNotificationCenter *local = NSNotificationCenter.defaultCenter;
  ownMenuBegan = [local addObserverForName:NSMenuDidBeginTrackingNotification object:nil queue:nil usingBlock:^(__unused NSNotification *note) { ownMenus++; }];
  ownMenuEnded = [local addObserverForName:NSMenuDidEndTrackingNotification object:nil queue:nil usingBlock:^(__unused NSNotification *note) { if (ownMenus > 0) ownMenus--; }];
  otherMenus = [NSDistributedNotificationCenter.defaultCenter addObserverForName:@"com.apple.HIToolbox.beginMenuTrackingNotification" object:nil queue:NSOperationQueue.mainQueue usingBlock:^(__unused NSNotification *note) {
    if (!ownMenus) index_menu_dismiss();
  }];
  otherApps = [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:NSWorkspaceDidActivateApplicationNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    NSRunningApplication *app = note.userInfo[NSWorkspaceApplicationKey];
    if (app.processIdentifier != getpid()) index_menu_dismiss();
  }];
}
// Called whenever the panel hides; nothing watches while it is hidden.
void index_menu_unwatch(void) {
  if (!outsideClicks) return;
  [NSEvent removeMonitor:outsideClicks];
  [NSNotificationCenter.defaultCenter removeObserver:ownMenuBegan];
  [NSNotificationCenter.defaultCenter removeObserver:ownMenuEnded];
  [NSDistributedNotificationCenter.defaultCenter removeObserver:otherMenus];
  [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:otherApps];
  outsideClicks = otherMenus = otherApps = ownMenuBegan = ownMenuEnded = nil;
  ownMenus = 0;
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
  index_menu_watch();
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
