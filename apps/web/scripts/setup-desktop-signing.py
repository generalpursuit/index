#!/usr/bin/env python3
"""Run on the certificate owner's Mac. Secrets travel directly from local files to GitHub."""
import argparse
import base64
import getpass
import json
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import subprocess
import sys

CHANNELS = {'production': ('main', 'com.generalpursuit.index'), 'staging': ('staging', 'com.generalpursuit.index.staging')}

def progress(message):
    print(message, flush=True)

def certificate_path(value):
    value = value.strip()
    if not value:
        raise RuntimeError('Enter the path to your exported .p12 certificate.')
    path = Path(value).expanduser()
    if path.is_file(): return path.resolve()
    # Finder escapes spaces when a file is dragged into Terminal. Parse quoting
    # without running a shell or evaluating any characters in the filename.
    try:
        parts = shlex.split(value)
    except ValueError:
        parts = []
    if len(parts) == 1:
        path = Path(parts[0]).expanduser()
        if path.is_file(): return path.resolve()
    raise RuntimeError('Certificate file not found. Drag the exported .p12 file into Terminal, then press Enter.')

def run(args, data=None, optional=False):
    result = subprocess.run(args, input=data, capture_output=True)
    if result.returncode:
        if optional and b'HTTP 404' in result.stderr: return None
        # Never interpolate command arguments: some signing tools accept passwords as arguments.
        raise RuntimeError(f'{Path(args[0]).name} failed. Check authentication, file access, and the password; no secret output was printed.')
    return result.stdout

def gh(args, data=None, optional=False):
    return run(['gh', *args], data, optional)

def set_secret(repo, environment, name, value):
    if isinstance(value, str): value = value.encode()
    gh(['secret', 'set', name, '--repo', repo, '--env', environment], value)
    progress(f'  Stored {name} in {environment}.')

def set_variable(repo, environment, name, value):
    gh(['variable', 'set', name, '--repo', repo, '--env', environment, '--body', value])

def get_variable(repo, environment, name):
    result = gh(['api', f'repos/{repo}/environments/{environment}/variables/{name}'], optional=True)
    return json.loads(result)['value'] if result else None

def ensure_environment(repo, channel, branch):
    environment = 'desktop-' + channel
    path = f'repos/{repo}/environments/{environment}'
    current = gh(['api', path], optional=True)
    if current is None:
        gh(['api', path, '--method', 'PUT', '--input', '-'], json.dumps({'deployment_branch_policy': {'protected_branches': False, 'custom_branch_policies': True}}).encode())
    policies = json.loads(gh(['api', path + '/deployment-branch-policies']))['branch_policies']
    if not any(policy['name'] == branch and policy['type'] == 'branch' for policy in policies):
        gh(['api', path + '/deployment-branch-policies', '--method', 'POST', '--input', '-'], json.dumps({'name': branch, 'type': 'branch'}).encode())
    return environment

def certificate_identity(path, password):
    def extract(options):
        command = ['openssl', 'pkcs12', '-in', str(path), *options, '-passin', 'stdin']
        try:
            return run(command, password.encode() + b'\n')
        except RuntimeError:
            # Keychain exports may use legacy encryption unsupported by OpenSSL 3's defaults.
            return run([*command, '-legacy'], password.encode() + b'\n')
    cert = extract(['-clcerts', '-nokeys'])
    subject = run(['openssl', 'x509', '-noout', '-subject', '-nameopt', 'sep_multiline,lname,utf8'], cert).decode()
    identity = re.search(r'^\s*commonName\s*=\s*(.+)$', subject, re.MULTILINE)
    team = re.search(r'^\s*organizationalUnitName\s*=\s*([A-Z0-9]{10})\s*$', subject, re.MULTILINE)
    if not identity or not identity[1].startswith('Developer ID Application:') or not team:
        raise RuntimeError('Choose a Developer ID Application certificate with its private key.')
    run(['openssl', 'x509', '-checkend', '0', '-noout'], cert)
    # Verify the exported file really contains the private key, keeping all output in memory.
    key = extract(['-nocerts', '-nodes'])
    if b'PRIVATE KEY-----' not in key: raise RuntimeError('The export does not include its private key.')
    return identity[1].strip(), team[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('certificate', nargs='?', type=Path)
    parser.add_argument('--repo', default='generalpursuit/index')
    parser.add_argument('--notary-key', type=Path)
    parser.add_argument('--key-id')
    parser.add_argument('--issuer')
    parser.add_argument('--profiles', type=Path, help='Folder containing production-host, production-extension, staging-host and staging-extension .provisionprofile files')
    args = parser.parse_args()
    if sys.platform != 'darwin': raise RuntimeError('Run this script on the Mac holding the certificate.')
    if not shutil.which('gh'): raise RuntimeError('Install the GitHub CLI (brew install gh), then run gh auth login.')
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', args.repo): raise RuntimeError('Invalid repository.')
    progress('Checking GitHub authentication…')
    gh(['auth', 'status'])
    if any((args.notary_key, args.key_id, args.issuer)) and not all((args.notary_key, args.key_id, args.issuer)):
        raise RuntimeError('Provide --notary-key, --key-id and --issuer together.')
    if not args.certificate:
        certificate = certificate_path(input('Drag your exported .p12 file into this Terminal, then press Enter: '))
    else:
        certificate = certificate_path(str(args.certificate))
    password = getpass.getpass('Certificate export password (hidden): ')
    if not password or '\n' in password: raise RuntimeError('A nonempty, single-line export password is required.')
    progress('Checking the certificate and its private key…')
    identity, team = certificate_identity(certificate, password)
    encoded = base64.b64encode(certificate.read_bytes())
    if len(encoded) > 48000: raise RuntimeError('Certificate export is too large for a GitHub secret; export only the Developer ID identity.')
    if shutil.which('bun'): signer = ['bun', 'x', '@tauri-apps/cli@2.12.1']
    elif shutil.which('npx'): signer = ['npx', '--yes', '@tauri-apps/cli@2.12.1']
    else: raise RuntimeError('Install Bun or Node.js to generate the Tauri update signing keys.')
    key_dir = Path.home() / 'Library/Application Support/Index Release Keys'
    key_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    key_dir.chmod(0o700)
    remaining = []
    for channel, (branch, bundle) in CHANNELS.items():
        progress(f'Configuring {channel} for {branch}…')
        environment = ensure_environment(args.repo, channel, branch)
        key_path = key_dir / f'{channel}.key'
        public_path = key_dir / f'{channel}.key.pub'
        remote_public = get_variable(args.repo, environment, 'INDEX_UPDATER_PUBLIC_KEY')
        if key_path.exists() != public_path.exists(): raise RuntimeError('Incomplete updater key backup; restore the matching key pair before continuing.')
        if remote_public and (not public_path.exists() or public_path.read_text().strip() != remote_public):
            raise RuntimeError(f'Restore the original {channel} updater key backup. Replacing it would prevent installed apps from updating.')
        if not key_path.exists():
            progress(f'  Preparing the Tauri signing tool and generating the {channel} update key. The first run may download the tool; encrypted key generation can take a while.')
            run([*signer, 'signer', 'generate', '--ci', '--write-keys', str(key_path), '--password', password])
            key_path.chmod(0o600)
        # Validate existing encrypted keys with the password before altering GitHub secrets.
        probe = key_dir / 'probe.txt'
        probe.write_text('Index updater signing test\n')
        try:
            progress(f'  Testing the encrypted {channel} update key…')
            run([*signer, 'signer', 'sign', '--private-key-path', str(key_path), '--password', password, str(probe)])
        finally:
            probe.unlink(missing_ok=True)
            probe.with_suffix('.txt.sig').unlink(missing_ok=True)
        progress(f'  Uploading signing secrets to {environment}…')
        set_secret(args.repo, environment, 'APPLE_CERTIFICATE', encoded)
        set_secret(args.repo, environment, 'APPLE_CERTIFICATE_PASSWORD', password)
        set_secret(args.repo, environment, 'TAURI_SIGNING_PRIVATE_KEY', key_path.read_bytes())
        set_secret(args.repo, environment, 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD', password)
        progress(f'  Saving public signing settings in {environment}…')
        set_variable(args.repo, environment, 'INDEX_UPDATER_PUBLIC_KEY', public_path.read_text().strip())
        set_variable(args.repo, environment, 'APPLE_SIGNING_IDENTITY', identity)
        set_variable(args.repo, environment, 'INDEX_APPLE_TEAM_ID', team)
        prefix = get_variable(args.repo, environment, 'INDEX_APP_ID_PREFIX') or team
        if args.profiles:
            prefixes = set()
            for kind, identifier in [('host', bundle), ('extension', bundle + '.share-mac')]:
                path = args.profiles.expanduser() / f'{channel}-{kind}.provisionprofile'
                profile = plistlib.loads(run(['security', 'cms', '-D', '-i', str(path)]))
                ent = profile.get('Entitlements', {})
                app_id = ent.get('com.apple.application-identifier', ent.get('application-identifier', ''))
                if not app_id.endswith('.' + identifier) or team not in profile.get('TeamIdentifier', []): raise RuntimeError(f'The {channel} {kind} profile does not match this app and team.')
                prefixes.add(app_id[:-(len(identifier) + 1)])
                set_secret(args.repo, environment, f'INDEX_MAC_{kind.upper()}_PROFILE_BASE64', base64.b64encode(path.read_bytes()))
            if len(prefixes) != 1: raise RuntimeError('Host and extension App ID prefixes differ.')
            prefix = prefixes.pop()
        else:
            remaining.append(f'{channel}: host and Share extension Developer ID provisioning profiles')
        set_variable(args.repo, environment, 'INDEX_APP_ID_PREFIX', prefix)
        if args.notary_key:
            progress(f'  Uploading the notarization key to {environment}…')
            set_secret(args.repo, environment, 'APPLE_API_KEY_CONTENT', args.notary_key.expanduser().read_bytes())
            set_variable(args.repo, environment, 'APPLE_API_KEY', args.key_id)
            set_variable(args.repo, environment, 'APPLE_API_ISSUER', args.issuer)
        else:
            remaining.append(f'{channel}: App Store Connect notarization key, Key ID and Issuer ID')
    print(f'Certificate and independent update keys are stored in both GitHub environments. Encrypted key backups: {key_dir}')
    print('Keep these encrypted updater keys and the export password; reuse them for all future releases.')
    if remaining:
        print('Still needed before signed Mac releases:')
        for item in remaining: print('  ' + item)

if __name__ == '__main__':
    try: main()
    except (KeyboardInterrupt, EOFError): sys.exit('Setup cancelled.')
    except Exception as error:
        print(str(error) if isinstance(error, RuntimeError) else 'Setup failed. Check the selected local files; no secret contents were printed.', file=sys.stderr)
        sys.exit(1)
