"""Exercise channel/profile validation without Apple credentials or macOS tools."""
import copy
from datetime import datetime, timezone
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

with patch.dict(os.environ, {'RUNNER_TEMP': tempfile.gettempdir()}):
    spec = importlib.util.spec_from_file_location('signing', Path(__file__).with_name('ci-apple-signing.py'))
    signing = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(signing)

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
