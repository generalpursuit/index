#!/usr/bin/env python3
"""Install release credentials on an ephemeral macOS runner without logging their contents."""
import base64
import json
import os
from pathlib import Path
import plistlib
import secrets
import shutil
import subprocess
import sys
from datetime import datetime, timezone

STATE = Path(os.environ['RUNNER_TEMP']) / 'index-apple-signing'

def run(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed during Apple signing setup.')
    return result.stdout

def required(name):
    value = os.environ.get(name, '')
    if not value:
        raise RuntimeError(f'Missing {name} in this desktop GitHub environment. Run the Mac signing setup script.')
    return value

def validate_profile(profile, identifier, prefix, team, group, now=None):
    ent = profile.get('Entitlements', {})
    app_id = ent.get('com.apple.application-identifier', ent.get('application-identifier'))
    if app_id != f'{prefix}.{identifier}' or team not in profile.get('TeamIdentifier', []):
        raise RuntimeError('Profile does not belong to this channel and signing team.')
    if profile['ExpirationDate'].replace(tzinfo=timezone.utc) <= (now or datetime.now(timezone.utc)):
        raise RuntimeError('Provisioning profile has expired.')
    if ent.get('get-task-allow') or ent.get('com.apple.security.get-task-allow'):
        raise RuntimeError('Distribution profiles must not enable debugging.')
    groups = ent.get('keychain-access-groups', [])
    if group not in groups and f'{prefix}.*' not in groups:
        raise RuntimeError('Profile does not authorize the channel Keychain group.')

def prepare():
    STATE.mkdir(mode=0o700)
    original = run(['security', 'list-keychains', '-d', 'user']).decode().splitlines()
    original = [line.strip().strip('"') for line in original]
    (STATE / 'keychains.json').write_text(json.dumps(original))
    certificate = STATE / 'certificate.p12'
    certificate.write_bytes(base64.b64decode(required('APPLE_CERTIFICATE'), validate=True))
    certificate.chmod(0o600)
    keychain = str(STATE / 'build.keychain-db')
    password = secrets.token_urlsafe(32)
    run(['security', 'create-keychain', '-p', password, keychain])
    run(['security', 'set-keychain-settings', '-lut', '21600', keychain])
    run(['security', 'unlock-keychain', '-p', password, keychain])
    run(['security', 'import', str(certificate), '-k', keychain, '-P', required('APPLE_CERTIFICATE_PASSWORD'), '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'])
    run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
    run(['security', 'list-keychains', '-d', 'user', '-s', keychain, *original])
    identity = required('APPLE_SIGNING_IDENTITY')
    if not identity.startswith('Developer ID Application:') or identity not in run(['security', 'find-identity', '-v', '-p', 'codesigning', keychain]).decode():
        raise RuntimeError('A valid Developer ID Application signing identity and private key are required.')
    certificate.unlink()
    channel = required('INDEX_DESKTOP_CHANNEL')
    if channel not in ('production', 'staging'): raise RuntimeError('Invalid desktop channel.')
    bundle = 'com.generalpursuit.index' + ('.staging' if channel == 'staging' else '')
    prefix = required('INDEX_APP_ID_PREFIX')
    team = required('INDEX_APPLE_TEAM_ID')
    values = {}
    for kind, identifier in [('HOST', bundle), ('EXTENSION', bundle + '.share-mac')]:
        profile_path = STATE / f'{kind.lower()}.provisionprofile'
        profile_path.write_bytes(base64.b64decode(required(f'INDEX_MAC_{kind}_PROFILE_BASE64'), validate=True))
        profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(profile_path)]))
        validate_profile(profile, identifier, prefix, team, f'{prefix}.{bundle}.shared')
        for directory in [Path.home() / 'Library/MobileDevice/Provisioning Profiles', Path.home() / 'Library/Developer/Xcode/UserData/Provisioning Profiles']:
            directory.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(profile_path, directory / (profile['UUID'] + '.provisionprofile'))
        if kind == 'HOST': values['INDEX_MAC_HOST_PROFILE'] = str(profile_path)
        else: values['INDEX_MAC_EXTENSION_PROFILE_SPECIFIER'] = profile['UUID']
    key = STATE / 'notary.p8'
    key.write_text(required('APPLE_API_KEY_CONTENT'))
    key.chmod(0o600)
    required('APPLE_API_KEY')
    required('APPLE_API_ISSUER')
    values['APPLE_API_KEY_PATH'] = str(key)
    with open(os.environ['GITHUB_ENV'], 'a') as output:
        for name, value in values.items():
            if '\n' in value or '\r' in value: raise RuntimeError('Invalid signing configuration value.')
            output.write(f'{name}={value}\n')
    print('Developer ID identity and both channel profiles are installed.')

def cleanup():
    if not STATE.exists(): return
    original = STATE / 'keychains.json'
    if original.exists(): run(['security', 'list-keychains', '-d', 'user', '-s', *json.loads(original.read_text())])
    keychain = STATE / 'build.keychain-db'
    if keychain.exists(): run(['security', 'delete-keychain', str(keychain)])
    shutil.rmtree(STATE)

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['prepare']: prepare()
        elif sys.argv[1:] == ['cleanup']: cleanup()
        else: raise RuntimeError('Choose prepare or cleanup.')
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Apple signing setup failed; check the configured certificate and profiles.', file=sys.stderr)
        sys.exit(1)
