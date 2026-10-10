#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <stdlib.h>
#include <string.h>

// Same normalization contract and shared fixtures as IndexCore.APIScope. Rust callers use
// this implementation, so both Apple hosts use Foundation URL parsing, not divergent parsers.
char *index_shared_scope(const char *raw) {
  @autoreleasepool {
    if (!raw) return NULL;
    for (const unsigned char *p = (const unsigned char *)raw; *p; p++)
      if (*p < 33 || *p > 126 || *p == '\\') return NULL;
    NSString *input = [NSString stringWithUTF8String:raw];
    if ([input rangeOfString:@"%(?![0-9A-Fa-f]{2})" options:NSRegularExpressionSearch].location != NSNotFound) return NULL;
    NSURLComponents *parts = [NSURLComponents componentsWithString:[NSString stringWithUTF8String:raw]];
    NSString *scheme = parts.scheme.lowercaseString, *host = parts.host.lowercaseString;
    if (!host.length || parts.user || parts.password || parts.query || parts.fragment) return NULL;
    if (![scheme isEqualToString:@"https"] && !([scheme isEqualToString:@"http"] &&
        [@[@"localhost", @"127.0.0.1", @"::1", @"[::1]"] containsObject:host])) return NULL;
    for (NSString *segment in [parts.percentEncodedPath componentsSeparatedByString:@"/"]) {
      NSString *decoded = segment.stringByRemovingPercentEncoding;
      if (!decoded || [decoded isEqualToString:@"."] || [decoded isEqualToString:@".."] ||
          [decoded containsString:@"/"] || [decoded containsString:@"\\"]) return NULL;
    }
    parts.scheme = scheme; parts.host = host;
    if (parts.port.integerValue == ([scheme isEqualToString:@"https"] ? 443 : 80)) parts.port = nil;
    if (parts.port && (parts.port.integerValue < 1 || parts.port.integerValue > 65535)) return NULL;
    NSString *path = parts.percentEncodedPath;
    while ([path hasSuffix:@"/"]) path = [path substringToIndex:path.length - 1];
    parts.percentEncodedPath = path;
    return parts.string ? strdup(parts.string.UTF8String) : NULL;
  }
}

// 0 = unconfigured; 1 = shared namespace configured. An invalid configured group fails closed.
int index_shared_enabled(void) {
  return [[NSBundle mainBundle] objectForInfoDictionaryKey:@"IndexKeychainGroup"] != nil;
}
static NSMutableDictionary *query(const char *server) {
  char *scope = index_shared_scope(server);
  if (!scope) return nil;
  NSString *service = [@"com.generalpursuit.index.session." stringByAppendingString:[NSString stringWithUTF8String:scope]];
  free(scope);
  NSString *group = [[NSBundle mainBundle] objectForInfoDictionaryKey:@"IndexKeychainGroup"];
  if (![group isKindOfClass:NSString.class] || !group.length || [group containsString:@"$("]) return nil;
  return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: @"session",
    (__bridge id)kSecAttrAccessGroup: group, (__bridge id)kSecUseDataProtectionKeychain: @YES} mutableCopy];
}
int index_shared_read(const char *server, char **token) {
  @autoreleasepool {
    *token = NULL;
    NSMutableDictionary *q = query(server);
    if (!q) return errSecParam;
    q[(__bridge id)kSecReturnData] = @YES;
    q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)q, &result);
    if (status == errSecItemNotFound) return 0;
    if (status != errSecSuccess) return status;
    NSData *data = CFBridgingRelease(result);
    NSString *value = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    if (!value || !value.length) return errSecDecode;
    *token = strdup(value.UTF8String);
    return *token ? 0 : errSecAllocate;
  }
}
int index_shared_write(const char *server, const char *token) {
  @autoreleasepool {
    NSMutableDictionary *q = query(server);
    if (!q) return errSecParam;
    if (!token) {
      OSStatus status = SecItemDelete((__bridge CFDictionaryRef)q);
      return status == errSecItemNotFound ? 0 : status;
    }
    NSData *data = [[NSString stringWithUTF8String:token] dataUsingEncoding:NSUTF8StringEncoding];
    if (!data.length) return errSecParam;
    NSDictionary *attrs = @{(__bridge id)kSecValueData: data,
      (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)q, (__bridge CFDictionaryRef)attrs);
    if (status == errSecItemNotFound) { [q addEntriesFromDictionary:attrs]; status = SecItemAdd((__bridge CFDictionaryRef)q, NULL); }
    return status;
  }
}
void index_shared_free(char *value) { free(value); }

// A separate non-account scalar; this never reads or changes a session credential.
void index_shared_appearance(const char *server, const char *preference) {
  @autoreleasepool {
    NSMutableDictionary *q = query(server);
    NSString *value = preference ? [NSString stringWithUTF8String:preference] : nil;
    if (!q || ![@[@"system", @"light", @"dark"] containsObject:value]) return;
    q[(__bridge id)kSecAttrService] = @"com.generalpursuit.index.appearance";
    q[(__bridge id)kSecAttrAccount] = @"device";
    NSDictionary *attrs = @{(__bridge id)kSecValueData: [value dataUsingEncoding:NSUTF8StringEncoding],
      (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)q, (__bridge CFDictionaryRef)attrs);
    if (status == errSecItemNotFound) { [q addEntriesFromDictionary:attrs]; SecItemAdd((__bridge CFDictionaryRef)q, NULL); }
  }
}
