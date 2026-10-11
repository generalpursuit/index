"""Exercise channel/profile validation without Apple credentials or macOS tools."""
import copy
from datetime import datetime, timezone
import importlib.util
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

with patch.dict(os.environ, {'RUNNER_TEMP': tempfile.gettempdir()}):
    spec = importlib.util.spec_from_file_location('signing', Path(__file__).with_name('ci-apple-signing.py'))
    signing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(signing)

spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('setup-desktop-signing.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)

class CertificatePaths(unittest.TestCase):
    def test_terminal_paths_with_spaces_quotes_and_shell_characters(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'Developer ID $(do-not-run).p12'
            path.touch()
            for value in (str(path), str(path).replace(' ', '\\ '), "'" + str(path) + "'", '"' + str(path) + '"'):
                self.assertEqual(setup.certificate_path(value), path.resolve())

    def test_empty_missing_and_directory_paths_fail_before_password_prompt(self):
        for value in ('', '/path/that/does/not/exist.p12', tempfile.gettempdir()):
            with self.assertRaises(RuntimeError): setup.certificate_path(value)

class SecretHandling(unittest.TestCase):
    def test_signing_password_is_scoped_to_child_environment_and_not_arguments(self):
        password = 'test-only-password-with-$-and-spaces'
        with patch.dict(os.environ, {'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': 'existing-value'}), \
             patch.object(setup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, b'', b'')) as child:
            setup.check_update_key(['tauri'], Path('/tmp/example.key'), password, Path('/tmp/probe.txt'))
            args, kwargs = child.call_args
            self.assertNotIn(password, str(args))
            self.assertNotIn('--password', args[0])
            self.assertEqual(kwargs['env']['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'], password)
            self.assertEqual(os.environ['TAURI_SIGNING_PRIVATE_KEY_PASSWORD'], 'existing-value')

    def test_generation_uses_hidden_terminal_prompts_and_cannot_inherit_ci_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / 'example.key'
            key.touch()
            with patch.dict(os.environ, {'CI': 'true', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD': 'test-only-password'}), \
                 patch.object(sys.stdin, 'isatty', return_value=True), \
                 patch.object(setup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as child:
                setup.generate_update_key(['tauri'], key)
                args, kwargs = child.call_args
                self.assertNotIn('--ci', args[0])
                self.assertNotIn('--password', args[0])
                self.assertNotIn('CI', kwargs['env'])
                self.assertNotIn('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', kwargs['env'])
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            with patch.object(sys.stdin, 'isatty', return_value=False), patch.object(setup.subprocess, 'run') as child:
                with self.assertRaisesRegex(RuntimeError, 'interactive Terminal'):
                    setup.generate_update_key(['tauri'], key)
                child.assert_not_called()

    def test_subprocess_failure_does_not_print_secret_output(self):
        with patch.object(setup.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, b'TEST_PRIVATE_KEY', b'TEST_PASSWORD')):
            with self.assertRaises(RuntimeError) as error:
                setup.run(['tauri', 'signer', 'sign'])
            self.assertNotIn('TEST_PRIVATE_KEY', str(error.exception))
            self.assertNotIn('TEST_PASSWORD', str(error.exception))

class ProfileUploadOnly(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.folder = Path(self.directory.name)
        self.team = 'TEAM123456'
        self.prefix = 'PREFIX1234'
        for channel, (_, bundle) in setup.CHANNELS.items():
            for kind, identifier in [('host', bundle), ('extension', bundle + '.share-mac')]:
                profile = {
                    'TeamIdentifier': [self.team],
                    'ExpirationDate': datetime(2099, 1, 1),
                    'Entitlements': {
                        'com.apple.application-identifier': self.prefix + '.' + identifier,
                        'keychain-access-groups': [self.prefix + '.*'],
                    },
                }
                (self.folder / f'{channel}-{kind}.provisionprofile').write_bytes(plistlib.dumps(profile))

    def decode(self, args, *unused, **kwargs):
        self.assertEqual(args[:4], ['security', 'cms', '-D', '-i'])
        path = Path(args[4])
        self.assertEqual(path.parent, self.folder)
        return path.read_bytes()

    def test_cli_uploads_only_profiles_without_prompting_or_loading_private_keys(self):
        with patch.object(sys, 'argv', ['setup', '--profiles-only', '--profiles', str(self.folder)]), \
             patch.object(sys, 'platform', 'darwin'), patch.object(setup.shutil, 'which', return_value='/usr/bin/gh'), \
             patch.object(setup, 'gh', return_value=b''), patch.object(setup, 'get_variable', return_value=self.team), \
             patch.object(setup, 'run', side_effect=self.decode), \
             patch.object(setup.getpass, 'getpass', side_effect=AssertionError('Must not request a password')), \
             patch.object(setup, 'certificate_identity', side_effect=AssertionError('Must not open a private key')), \
             patch.object(setup, 'set_secret') as secret, patch.object(setup, 'set_variable') as variable:
            setup.main()
            self.assertEqual(secret.call_count, 4)
            self.assertEqual({call.args[2] for call in secret.call_args_list},
                             {'INDEX_MAC_HOST_PROFILE_BASE64', 'INDEX_MAC_EXTENSION_PROFILE_BASE64'})
            self.assertEqual({call.args[1] for call in secret.call_args_list}, {'desktop-production', 'desktop-staging'})
            self.assertEqual(variable.call_count, 2)
            self.assertTrue(all(call.args[2:] == ('INDEX_APP_ID_PREFIX', self.prefix) for call in variable.call_args_list))

    def test_all_profiles_are_validated_before_any_upload(self):
        path = self.folder / 'staging-extension.provisionprofile'
        original = plistlib.loads(path.read_bytes())
        for problem in ('wrong_app', 'wrong_team', 'expired', 'debug', 'wrong_keychain', 'mismatched_prefix'):
            profile = copy.deepcopy(original)
            ent = profile['Entitlements']
            if problem == 'wrong_app': ent['com.apple.application-identifier'] = self.prefix + '.com.generalpursuit.index'
            elif problem == 'wrong_team': profile['TeamIdentifier'] = ['OTHER12345']
            elif problem == 'expired': profile['ExpirationDate'] = datetime(2000, 1, 1)
            elif problem == 'debug': ent['com.apple.security.get-task-allow'] = True
            elif problem == 'wrong_keychain': ent['keychain-access-groups'] = [self.prefix + '.com.generalpursuit.index.shared']
            else:
                ent['com.apple.application-identifier'] = 'OTHER12345.com.generalpursuit.index.staging.share-mac'
                ent['keychain-access-groups'] = ['OTHER12345.*']
            path.write_bytes(plistlib.dumps(profile))
            with self.subTest(problem=problem), patch.object(setup, 'get_variable', return_value=self.team), \
                 patch.object(setup, 'run', side_effect=self.decode), \
                 patch.object(setup, 'set_secret') as secret, patch.object(setup, 'set_variable') as variable:
                with self.assertRaises(RuntimeError): setup.upload_profiles_only('owner/repo', self.folder)
                secret.assert_not_called()
                variable.assert_not_called()

class Profiles(unittest.TestCase):
    def setUp(self):
        self.bundle = 'com.generalpursuit.index.staging'
        self.prefix = 'PREFIX1234'
        self.team = 'TEAM123456'
        self.group = self.prefix + '.' + self.bundle + '.shared'
        self.profile = {
            'TeamIdentifier': [self.team],
            'ExpirationDate': datetime(2030, 1, 1),
            'Entitlements': {
                'com.apple.application-identifier': self.prefix + '.' + self.bundle,
                'keychain-access-groups': [self.group],
            },
        }

    def validate(self, profile, bundle=None):
        signing.validate_profile(profile, bundle or self.bundle, self.prefix, self.team, self.group,
                                 now=datetime(2026, 1, 1, tzinfo=timezone.utc))

    def test_explicit_and_wildcard_groups_allow_different_team_and_app_prefix(self):
        self.validate(self.profile)
        self.profile['Entitlements']['keychain-access-groups'] = [self.prefix + '.*']
        self.validate(self.profile)

    def test_production_profile_cannot_sign_staging_or_its_extension(self):
        with self.assertRaisesRegex(RuntimeError, 'channel'):
            self.validate(self.profile, 'com.generalpursuit.index')
        with self.assertRaisesRegex(RuntimeError, 'channel'):
            self.validate(self.profile, self.bundle + '.share-mac')

    def test_other_team_and_other_keychain_group_are_rejected(self):
        other = copy.deepcopy(self.profile)
        other['TeamIdentifier'] = ['OTHER12345']
        with self.assertRaisesRegex(RuntimeError, 'team'): self.validate(other)
        self.profile['Entitlements']['keychain-access-groups'] = [self.prefix + '.com.generalpursuit.index.shared']
        with self.assertRaisesRegex(RuntimeError, 'Keychain'): self.validate(self.profile)

    def test_expired_and_debug_profiles_are_rejected(self):
        expired = copy.deepcopy(self.profile)
        expired['ExpirationDate'] = datetime(2025, 1, 1)
        with self.assertRaisesRegex(RuntimeError, 'expired'): self.validate(expired)
        for key in ('get-task-allow', 'com.apple.security.get-task-allow'):
            debug = copy.deepcopy(self.profile)
            debug['Entitlements'][key] = True
            with self.assertRaisesRegex(RuntimeError, 'debugging'): self.validate(debug)

if __name__ == '__main__': unittest.main()
