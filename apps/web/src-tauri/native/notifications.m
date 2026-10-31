#import <AppKit/AppKit.h>
#import <UserNotifications/UserNotifications.h>
#import <Security/Security.h>
#include <stdlib.h>
#include <stdbool.h>
#include <stdatomic.h>
static atomic_uint_fast64_t notificationEpoch;
extern void index_show_main(void);

// OS-only bridge. Session credentials remain exclusively behind Rust session_read().
static NSLock *clickLock;
// Orders display submission/seen updates with epoch invalidation. Never held while waiting.
static NSRecursiveLock *deliveryLock;
static NSString *pendingClick;
@interface IndexNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end
@implementation IndexNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center didReceiveNotificationResponse:(UNNotificationResponse *)response withCompletionHandler:(void (^)(void))completion {
  NSData *data = [NSJSONSerialization dataWithJSONObject:response.notification.request.content.userInfo options:0 error:nil];
  [clickLock lock]; pendingClick = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]; [clickLock unlock];
  dispatch_async(dispatch_get_main_queue(), ^{
    // Deliberately target/recreate main; the menu panel must never consume this click.
    index_show_main();
  });
  completion();
}
- (void)userNotificationCenter:(UNUserNotificationCenter *)center willPresentNotification:(UNNotification *)notification withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completion {
  completion(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionSound);
}
@end
static IndexNotificationDelegate *delegate;
static UNUserNotificationCenter *notificationCenter;
void index_notifications_init(void) {
  clickLock = [NSLock new];
  deliveryLock = [NSRecursiveLock new];
  // UserNotifications raises an exception for bare executables, even when a
  // plist is embedded. The dev runner supplies a real .app; direct cargo runs
  // remain usable with notifications unavailable.
  if (![NSBundle.mainBundle.bundleURL.pathExtension isEqualToString:@"app"] || !NSBundle.mainBundle.bundleIdentifier.length) return;
  notificationCenter = UNUserNotificationCenter.currentNotificationCenter;
  delegate = [IndexNotificationDelegate new];
  notificationCenter.delegate = delegate;
}
// Only called on a Rust blocking thread. Never wait on the AppKit main thread.
int index_notifications_permission(bool request) {
  if (!notificationCenter) return -1;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block int result = -1;
  UNUserNotificationCenter *center = notificationCenter;
  void (^read)(void) = ^{
    [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      switch (settings.authorizationStatus) {
        case UNAuthorizationStatusNotDetermined: result = 0; break;
        case UNAuthorizationStatusDenied: result = 1; break;
        case UNAuthorizationStatusAuthorized: result = 2; break;
        case UNAuthorizationStatusProvisional: result = 3; break;
        default: result = -1;
      }
      dispatch_semaphore_signal(done);
    }];
  };
  if (request) [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound completionHandler:^(BOOL granted, NSError *error) { read(); }];
  else read();
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC))) return -1;
  return result;
}
// Rust captures this under its runtime lock, before submitting any blocking work.
uint64_t index_notifications_epoch(void) { return atomic_load(&notificationEpoch); }
int index_notifications_show(const char *json, uint64_t epoch) {
  @autoreleasepool {
    if (!notificationCenter) return 0;
    if (epoch != atomic_load(&notificationEpoch)) return 0;
    NSData *data = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
    NSDictionary *alert = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![alert[@"id"] isKindOfClass:NSString.class] || ![alert[@"body"] isKindOfClass:NSString.class]) return 0;
    [deliveryLock lock];
    if (epoch != atomic_load(&notificationEpoch)) { [deliveryLock unlock]; return 0; }
    NSArray *seen = [NSUserDefaults.standardUserDefaults arrayForKey:@"index.notifications.seen"] ?: @[];
    BOOL alreadySeen = [seen containsObject:alert[@"id"]];
    [deliveryLock unlock];
    if (alreadySeen) return 1;
    UNUserNotificationCenter *center = notificationCenter;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block int success = 0;
    [center getDeliveredNotificationsWithCompletionHandler:^(NSArray<UNNotification *> *delivered) {
      [deliveryLock lock];
      if (epoch != atomic_load(&notificationEpoch)) { [deliveryLock unlock]; dispatch_semaphore_signal(done); return; }
      for (UNNotification *notification in delivered) {
        if ([notification.request.identifier isEqualToString:alert[@"id"]]) { success = 1; [deliveryLock unlock]; dispatch_semaphore_signal(done); return; }
      }
      UNMutableNotificationContent *content = [UNMutableNotificationContent new];
      content.title = @"Index"; content.body = alert[@"body"]; content.sound = UNNotificationSound.defaultSound;
      // No hidden preview fields: this is precisely the server-authorized alert object.
      content.userInfo = @{ @"id": alert[@"id"], @"recipientId": alert[@"recipientId"], @"path": alert[@"path"] };
      UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:alert[@"id"] content:content trigger:nil];
      [center addNotificationRequest:request withCompletionHandler:^(NSError *error) {
        [deliveryLock lock];
        if (epoch != atomic_load(&notificationEpoch)) {
          // A late completion owns only this alert, never B's global state/epoch.
          [center removeDeliveredNotificationsWithIdentifiers:@[alert[@"id"]]];
          [center removePendingNotificationRequestsWithIdentifiers:@[alert[@"id"]]];
          success = 0;
        } else success = error ? 0 : 1;
        [deliveryLock unlock];
        dispatch_semaphore_signal(done);
      }];
      [deliveryLock unlock];
    }];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC))) return 0;
    [deliveryLock lock];
    if (epoch != atomic_load(&notificationEpoch)) { [deliveryLock unlock]; return 0; }
    if (success) {
      // Read again inside the lock; another current job may have completed first.
      NSMutableArray *next = [[NSUserDefaults.standardUserDefaults arrayForKey:@"index.notifications.seen"] mutableCopy] ?: [NSMutableArray new];
      if (![next containsObject:alert[@"id"]]) [next addObject:alert[@"id"]];
      while (next.count > 256) [next removeObjectAtIndex:0];
      [NSUserDefaults.standardUserDefaults setObject:next forKey:@"index.notifications.seen"];
    }
    [deliveryLock unlock];
    return success;
  }
}
void index_notifications_clear(bool clearClick) {
  [deliveryLock lock];
  atomic_fetch_add(&notificationEpoch, 1);
  [NSUserDefaults.standardUserDefaults removeObjectForKey:@"index.notifications.seen"];
  if (clearClick) { [clickLock lock]; pendingClick = nil; [clickLock unlock]; }
  [notificationCenter removeAllDeliveredNotifications];
  [notificationCenter removeAllPendingNotificationRequests];
  [deliveryLock unlock];
}
char *index_notifications_click(const char *ack) {
  [clickLock lock];
  if (ack && pendingClick) {
    NSDictionary *value = [NSJSONSerialization JSONObjectWithData:[pendingClick dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
    if ([value[@"id"] isEqualToString:[NSString stringWithUTF8String:ack]]) pendingClick = nil;
  }
  char *result = pendingClick ? strdup(pendingClick.UTF8String) : NULL;
  [clickLock unlock]; return result;
}
char *index_notifications_identity(const char *api) {
  @autoreleasepool {
    NSString *service = [@"com.generalpursuit.index.notifications." stringByAppendingString:[NSString stringWithUTF8String:api]];
    NSDictionary *query = @{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword, (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: @"installation", (__bridge id)kSecUseDataProtectionKeychain: @YES };
    NSMutableDictionary *read = [query mutableCopy]; read[(__bridge id)kSecReturnData] = @YES;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)read, &result);
    if (status == errSecSuccess) { NSData *data = CFBridgingRelease(result); NSString *proof = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]; return proof ? strdup(proof.UTF8String) : NULL; }
    if (status != errSecItemNotFound) return NULL;
    uint8_t bytes[32]; if (SecRandomCopyBytes(kSecRandomDefault, sizeof(bytes), bytes) != errSecSuccess) return NULL;
    NSString *proof = [[[NSData dataWithBytes:bytes length:sizeof(bytes)] base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
    proof = [[proof stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];
    NSMutableDictionary *insert = [query mutableCopy]; insert[(__bridge id)kSecValueData] = [proof dataUsingEncoding:NSUTF8StringEncoding]; insert[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
    if (SecItemAdd((__bridge CFDictionaryRef)insert, NULL) != errSecSuccess) return NULL;
    return strdup(proof.UTF8String);
  }
}
char *index_notifications_optin(const char *api, const char *set) {
  NSString *key = [@"index.notifications.optin." stringByAppendingString:[NSString stringWithUTF8String:api]];
  if (set) { NSString *value = [NSString stringWithUTF8String:set]; if (value.length) [NSUserDefaults.standardUserDefaults setObject:value forKey:key]; else [NSUserDefaults.standardUserDefaults removeObjectForKey:key]; }
  NSString *value = [NSUserDefaults.standardUserDefaults stringForKey:key]; return value ? strdup(value.UTF8String) : NULL;
}
void index_notifications_free(char *value) { free(value); }

// One process-owned socket. Waiting here waits on local events, never on a database poll.
static NSCondition *liveCondition;
static NSMutableArray<NSString *> *liveEvents;
static uint64_t liveGeneration;
static NSURLSessionWebSocketTask *liveSocket;
static NSURLSession *liveSession;
static void live_event(uint64_t generation, NSString *event) {
  [liveCondition lock];
  if (generation == liveGeneration) {
    // Hints are coalescible; never retain unbounded events while the process is suspended.
    if (liveEvents.count < 8) [liveEvents addObject:event];
    [liveCondition broadcast];
  }
  [liveCondition unlock];
}
static void live_receive(NSURLSessionWebSocketTask *socket, uint64_t generation) {
  [socket receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message, NSError *error) {
    if (error) {
      [liveCondition lock]; BOOL current = generation == liveGeneration && socket == liveSocket; [liveCondition unlock];
      if (current) live_event(generation, @"closed");
      return;
    }
    if (message.string) live_event(generation, message.string);
    [liveCondition lock]; BOOL current = generation == liveGeneration && socket == liveSocket; [liveCondition unlock];
    if (current) live_receive(socket, generation);
  }];
}
void index_notifications_socket_close(uint64_t generation) {
  [liveCondition lock];
  if (generation == liveGeneration) {
    [liveSocket cancelWithCloseCode:NSURLSessionWebSocketCloseCodeNormalClosure reason:nil];
    [liveSession invalidateAndCancel];
    liveSocket = nil; liveSession = nil;
    [liveEvents removeAllObjects]; [liveEvents addObject:@"closed"];
    [liveCondition broadcast];
  }
  [liveCondition unlock];
}
void index_notifications_socket_open(const char *address, uint64_t generation) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{ liveCondition = [NSCondition new]; liveEvents = [NSMutableArray new]; });
  [liveCondition lock];
  [liveSocket cancelWithCloseCode:NSURLSessionWebSocketCloseCodeNormalClosure reason:nil];
  [liveSession invalidateAndCancel];
  liveGeneration = generation; [liveEvents removeAllObjects];
  NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
  config.HTTPShouldSetCookies = NO; config.HTTPCookieStorage = nil; config.URLCache = nil;
  liveSession = [NSURLSession sessionWithConfiguration:config delegate:[NSClassFromString(@"IndexNotificationNetwork") new] delegateQueue:nil];
  liveSocket = [liveSession webSocketTaskWithURL:[NSURL URLWithString:[NSString stringWithUTF8String:address]]];
  NSURLSessionWebSocketTask *socket = liveSocket;
  [socket resume];
  [liveCondition unlock];
  live_receive(socket, generation);
}
char *index_notifications_socket_wait(uint64_t generation) {
  [liveCondition lock];
  if (generation == liveGeneration && !liveEvents.count) [liveCondition waitUntilDate:[NSDate dateWithTimeIntervalSinceNow:30]];
  NSString *event = generation == liveGeneration ? liveEvents.firstObject : @"closed";
  if (generation == liveGeneration && liveEvents.count) [liveEvents removeObjectAtIndex:0];
  char *result = strdup((event ?: @"timeout").UTF8String);
  [liveCondition unlock];
  return result;
}
void index_notifications_socket_send(uint64_t generation, const char *message) {
  [liveCondition lock]; NSURLSessionWebSocketTask *socket = generation == liveGeneration ? liveSocket : nil; [liveCondition unlock];
  if (socket) [socket sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:[NSString stringWithUTF8String:message]] completionHandler:^(NSError *error) {
    if (error) {
      [liveCondition lock]; BOOL current = generation == liveGeneration && socket == liveSocket; [liveCondition unlock];
      if (current) live_event(generation, @"closed");
    }
  }];
}

@interface IndexNotificationNetwork : NSObject <NSURLSessionTaskDelegate>
@end
@implementation IndexNotificationNetwork
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completion {
  completion(nil); // Never forward a session credential through a redirect.
}
@end
char *index_notifications_request(const char *api, const char *token, const char *path, const char *json) {
  @autoreleasepool {
    NSURL *url = [NSURL URLWithString:[[NSString stringWithUTF8String:api] stringByAppendingString:[NSString stringWithUTF8String:path]]];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:15];
    [request setValue:[@"Bearer " stringByAppendingString:[NSString stringWithUTF8String:token]] forHTTPHeaderField:@"Authorization"];
    [request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
    if (json) {
      request.HTTPMethod = @"POST";
      request.HTTPBody = [[NSString stringWithUTF8String:json] dataUsingEncoding:NSUTF8StringEncoding];
      [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    }
    NSURLSessionConfiguration *config = NSURLSessionConfiguration.ephemeralSessionConfiguration;
    config.HTTPShouldSetCookies = NO; config.HTTPCookieStorage = nil; config.URLCache = nil;
    IndexNotificationNetwork *delegate = [IndexNotificationNetwork new];
    NSURLSession *session = [NSURLSession sessionWithConfiguration:config delegate:delegate delegateQueue:nil];
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block NSString *result = nil;
    NSLock *resultLock = [NSLock new];
    NSURLSessionDataTask *task = [session dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
      if (!error && [response isKindOfClass:NSHTTPURLResponse.class]) {
        id body = data ? [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil] : nil;
        NSDictionary *value = @{ @"status": @(((NSHTTPURLResponse *)response).statusCode), @"body": body ?: NSNull.null };
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
        [resultLock lock]; result = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding]; [resultLock unlock];
      }
      dispatch_semaphore_signal(done);
    }];
    [task resume];
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_SEC))) [task cancel];
    [session invalidateAndCancel];
    [resultLock lock]; char *copy = result ? strdup(result.UTF8String) : NULL; [resultLock unlock];
    return copy;
  }
}
