#!/usr/bin/env python3
"""Check signed bundle/decoded profile compatibility; device launch remains a separate check."""
from datetime import datetime, timezone
from fnmatch import fnmatchcase
from pathlib import Path
import argparse
import plistlib
import subprocess


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def application_id(entitlements):
    return entitlements.get('com.apple.application-identifier') or entitlements.get('application-identifier')


def authorized(value, patterns):
    # Apple profiles use literal identifiers or a terminal wildcard, not general shell globs.
    return any(isinstance(pattern, str) and not any(c in pattern for c in '?[]')
               and ('*' not in pattern or pattern.endswith('*') and pattern.count('*') == 1)
               and fnmatchcase(value, pattern) for pattern in patterns)


def validate_profile(profile, signed, bundle_id, group, now=None):
    """Pure validation for Linux synthetic tests. Never include profile contents in errors."""
    now = now or datetime.now(timezone.utc)
    expires = profile.get('ExpirationDate')
    require(isinstance(expires, datetime), 'Provisioning profile has no valid expiry.')
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    require(expires > now, 'Provisioning profile has expired.')
    team = signed.get('com.apple.developer.team-identifier')
    require(isinstance(team, str) and team in profile.get('TeamIdentifier', []), 'Profile team does not match the signature.')
    permissions = profile.get('Entitlements', {})
    require(permissions.get('com.apple.developer.team-identifier') == team, 'Profile entitlement team does not match.')
    identifier = application_id(signed)
    require(isinstance(identifier, str) and identifier.endswith('.' + bundle_id), 'Signed application identifier does not match the bundle.')
    prefix = identifier[:-(len(bundle_id) + 1)]
    require(prefix in profile.get('ApplicationIdentifierPrefix', []), 'Application prefix is not authorized by the profile.')
    require(authorized(identifier, [application_id(permissions)]), 'Application identifier is not authorized by the profile.')
    actual_groups = signed.get('keychain-access-groups', [])
    require(isinstance(actual_groups, list) and group in actual_groups, 'Signature lacks the configured shared Keychain group.')
    allowed_groups = permissions.get('keychain-access-groups', [])
    require(isinstance(allowed_groups, list) and all(isinstance(value, str) and authorized(value, allowed_groups) for value in actual_groups), 'Keychain access group is not authorized by the profile.')
    for key in ('get-task-allow', 'com.apple.security.get-task-allow'):
        require(not signed.get(key) or permissions.get(key) is True, 'Signature enables debugging without profile authorization.')


def entitlements(path):
    subprocess.run(['codesign', '--verify', '--strict', str(path)], check=True)
    result = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(path)], check=True, capture_output=True)
    data = result.stdout if b'<?xml' in result.stdout else result.stderr
    start, end = data.find(b'<?xml'), data.find(b'</plist>')
    require(start >= 0 and end >= 0, 'Missing signed bundle entitlements.')
    return plistlib.loads(data[start:end+8])


def decode_profile(path):
    require(path.is_file(), 'Missing embedded provisioning profile.')
    # Decode into memory only; do not print certificates, profile details or credentials.
    result = subprocess.run(['security', 'cms', '-D', '-i', str(path)], check=True, capture_output=True)
    return plistlib.loads(result.stdout)


def verify(app):
    extension = app / 'Contents/PlugIns/IndexShareMac.appex'
    host = entitlements(app)
    share = entitlements(extension)
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    ext = plistlib.loads((extension / 'Contents/Info.plist').read_bytes())
    group = info['IndexKeychainGroup']
    require(isinstance(group, str) and group and '$(' not in group, 'Unresolved shared Keychain group.')
    require(group == ext['IndexKeychainGroup'], 'Host and extension Keychain groups differ.')
    for path, signed, bundle in [(app, host, info), (extension, share, ext)]:
        profile = decode_profile(path / 'Contents/embedded.provisionprofile')
        validate_profile(profile, signed, bundle['CFBundleIdentifier'], group)
    require(host['com.apple.developer.team-identifier'] == share['com.apple.developer.team-identifier'], 'Host and extension signing teams differ.')
    require(share.get('com.apple.security.app-sandbox') is True and share.get('com.apple.security.network.client') is True, 'Extension lacks sandbox or network entitlement.')
    require(info['IndexAPIURL'] == ext['IndexAPIURL'], 'Host and extension API scopes differ.')
    require(info['CFBundleShortVersionString'] == ext['CFBundleShortVersionString'], 'Host and extension versions differ.')
    require(ext['NSExtension']['NSExtensionPointIdentifier'] == 'com.apple.share-services', 'Bundle is not a Share extension.')
    print('Signed host/extension and profile compatibility verified. Launch/device checks remain separate.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('app', type=Path)
    verify(parser.parse_args().app)
