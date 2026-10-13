#import <AppKit/AppKit.h>

// The main window's WebView extends under its transparent titlebar, so the page paints that
// band like the rest of the window, modal backdrops included. This view covers the band above
// the WebView and below the window buttons, keeping its input native: a drag moves the window
// and a double-click performs the action chosen in System Settings.
extern void index_titlebar_changed(void);

@interface IndexTitlebarView : NSView
@end

// "Double-click a window's title bar to" in Desktop & Dock. Fill has no public API; use
// AppKit's own titlebar action while AppKit still offers it, otherwise Zoom.
static void performDoubleClickAction(NSWindow *window) {
  NSString *action = [NSUserDefaults.standardUserDefaults stringForKey:@"AppleActionOnDoubleClick"];
  if ([action isEqualToString:@"None"]) return;
  if ([action isEqualToString:@"Minimize"]) { [window performMiniaturize:nil]; return; }
  SEL fill = NSSelectorFromString(@"_zoomFill:");
  if ([action isEqualToString:@"Fill"] && [window respondsToSelector:fill]) {
    [NSApp sendAction:fill to:window from:window];
    return;
  }
  [window performZoom:nil];
}

@implementation IndexTitlebarView
// An inactive window moves on its first click, as with a native titlebar.
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
// Every press is handled below, so AppKit must not also act on a double-click.
- (BOOL)mouseDownCanMoveWindow { return NO; }
- (void)mouseDown:(NSEvent *)event {
  NSWindow *window = self.window;
  if (event.clickCount != 2) { [window performWindowDragWithEvent:event]; return; }
  // Like AppKit, act when the second click is released; dragging instead moves the window.
  NSEvent *next = [window nextEventMatchingMask:NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged];
  if (next.type == NSEventTypeLeftMouseDragged) [window performWindowDragWithEvent:event];
  else performDoubleClickAction(window);
}
@end

// The band a titled window reserves above its content, known before any window exists.
double index_titlebar_height(void) {
  NSRect content = NSMakeRect(0, 0, 100, 100);
  return NSHeight([NSWindow frameRectForContentRect:content styleMask:NSWindowStyleMaskTitled]) - NSHeight(content);
}

static IndexTitlebarView *titlebarView(NSWindow *window) {
  for (NSView *view in window.contentView.subviews) {
    if ([view isKindOfClass:IndexTitlebarView.class]) return (IndexTitlebarView *)view;
  }
  return nil;
}

// Full screen hides the titlebar, so the page may use the band until the titlebar returns.
double index_titlebar_inset(void *pointer) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  IndexTitlebarView *view = titlebarView(window);
  return view && !view.hidden ? NSHeight(view.frame) : 0;
}

void index_titlebar_install(void *pointer) {
  NSWindow *window = (__bridge NSWindow *)pointer;
  NSView *content = window.contentView;
  if (!content || titlebarView(window)) return;
  CGFloat height = index_titlebar_height();
  NSRect bounds = content.bounds;
  IndexTitlebarView *view = [[IndexTitlebarView alloc] initWithFrame:NSMakeRect(
      0, content.isFlipped ? 0 : NSHeight(bounds) - height, NSWidth(bounds), height)];
  view.autoresizingMask = NSViewWidthSizable | (content.isFlipped ? NSViewMaxYMargin : NSViewMinYMargin);
  [content addSubview:view positioned:NSWindowAbove relativeTo:nil];
  __weak IndexTitlebarView *weakView = view;
  NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
  [center addObserverForName:NSWindowDidEnterFullScreenNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    weakView.hidden = YES;
    index_titlebar_changed();
  }];
  // Reserve the band again before the titlebar animates back in.
  [center addObserverForName:NSWindowWillExitFullScreenNotification object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) {
    weakView.hidden = NO;
    index_titlebar_changed();
  }];
}
