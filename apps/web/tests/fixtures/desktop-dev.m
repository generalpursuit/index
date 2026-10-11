#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

extern void index_notifications_init(void);
extern int index_notifications_permission(bool request);
extern uint64_t index_notifications_epoch(void);
extern int index_notifications_show(const char *json, uint64_t epoch);
extern void index_notifications_clear(bool clearClick);
void index_show_main(void) {}

// Exercise the production bridge without credentials, opt-in, or delivering an alert.
int main(void) {
  @autoreleasepool {
    index_notifications_init();
    BOOL bundled = [NSBundle.mainBundle.bundleURL.pathExtension isEqualToString:@"app"];
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      int permission = index_notifications_permission(false);
      if (!bundled) {
        if (permission != -1 || index_notifications_permission(true) != -1) exit(2);
        if (index_notifications_show("{\"id\":\"test\",\"body\":\"test\"}", index_notifications_epoch())) exit(3);
      }
      index_notifications_clear(false);
      index_notifications_clear(true);
      NSDictionary *result = @{
        @"pid": @(getpid()),
        @"bundle": NSBundle.mainBundle.bundleURL.path,
        @"identifier": NSBundle.mainBundle.bundleIdentifier ?: @"",
        @"permission": @(permission),
        @"delegate": bundled ? NSStringFromClass(UNUserNotificationCenter.currentNotificationCenter.delegate.class) : @"",
        @"arguments": NSProcessInfo.processInfo.arguments,
        @"environment": NSProcessInfo.processInfo.environment[@"INDEX_RUNNER_TEST"] ?: @"",
      };
      NSData *json = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
      puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
      fflush(stdout);
      if ([NSProcessInfo.processInfo.arguments containsObject:@"--exit-failure"]) exit(23);
      if (![NSProcessInfo.processInfo.arguments containsObject:@"--wait"]) exit(0);
    });
    dispatch_main();
  }
}
