#import <AppKit/AppKit.h>
#include <stdbool.h>

// A device preference, like the app icon. Without its Dock icon Index is an accessory app: it
// leaves the Dock and the app switcher, and keeps its menu bar item and windows.
#ifdef INDEX_NATIVE_SMOKE
static NSString *const hiddenKey = @"index.dock-hidden.native-smoke";
#else
static NSString *const hiddenKey = @"index.dock-hidden";
#endif

static void onMain(void (^block)(void)) {
  if (NSThread.isMainThread) block();
  else dispatch_sync(dispatch_get_main_queue(), block);
}

// AppKit's policy, not the preference, so a failed change never reads as applied.
bool index_dock_visible(void) {
  __block bool visible = true;
  onMain(^{ visible = NSApp.activationPolicy == NSApplicationActivationPolicyRegular; });
  return visible;
}

bool index_dock_show(bool visible, bool persist) {
  __block bool applied = false;
  onMain(^{
    if (!NSApp) return;
    NSApplicationActivationPolicy policy = visible ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory;
    if (NSApp.activationPolicy != policy && ![NSApp setActivationPolicy:policy]) return;
    if (persist) [NSUserDefaults.standardUserDefaults setBool:!visible forKey:hiddenKey];
    applied = true;
  });
  return applied;
}

bool index_dock_restore(void) {
  return index_dock_show(![NSUserDefaults.standardUserDefaults boolForKey:hiddenKey], false);
}
