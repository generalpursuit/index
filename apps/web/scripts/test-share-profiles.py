#!/usr/bin/env python3
"""Synthetic decoded Apple profiles only; no profiles/accounts/signing needed on Linux."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('share_verifier', Path(__file__).with_name('verify-share-bundle.py'))
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)
NOW = datetime(2026, 10, 10, tzinfo=timezone.utc)
GROUP = 'PREFIXTEST.com.example.index.shared'
BUNDLE = 'com.example.index'
SIGNED = {'com.apple.application-identifier': 'PREFIXTEST.' + BUNDLE,
          'com.apple.developer.team-identifier': 'TEAMTEST01', 'keychain-access-groups': [GROUP]}
PROFILE = {'ExpirationDate': NOW + timedelta(days=7), 'TeamIdentifier': ['TEAMTEST01'],
           'ApplicationIdentifierPrefix': ['PREFIXTEST'],
           'Entitlements': {'com.apple.application-identifier': 'PREFIXTEST.' + BUNDLE,
                            'com.apple.developer.team-identifier': 'TEAMTEST01', 'keychain-access-groups': [GROUP]}}

class ProfileValidation(unittest.TestCase):
    def validate(self, profile=None, signed=None):
        verifier.validate_profile(PROFILE if profile is None else profile, SIGNED if signed is None else signed, BUNDLE, GROUP, NOW)

    def test_exact_profile_and_distinct_app_prefix_team(self):
        self.validate()
        profile = deepcopy(PROFILE)
        profile['ExpirationDate'] = profile['ExpirationDate'].replace(tzinfo=None)
        self.validate(profile)

    def test_expiry_is_required_and_enforced(self):
        for value in [None, NOW, NOW - timedelta(seconds=1)]:
            profile = deepcopy(PROFILE); profile['ExpirationDate'] = value
            with self.assertRaisesRegex(RuntimeError, 'expir'): self.validate(profile)

    def test_team_and_prefix_cannot_be_substituted(self):
        for field, value in [('TeamIdentifier', ['OTHERTEAM1']), ('ApplicationIdentifierPrefix', ['OTHERPREFIX'])]:
            profile = deepcopy(PROFILE); profile[field] = value
            with self.assertRaises(RuntimeError): self.validate(profile)
        profile = deepcopy(PROFILE); profile['Entitlements']['com.apple.developer.team-identifier'] = 'OTHERTEAM1'
        with self.assertRaises(RuntimeError): self.validate(profile)

    def test_bundle_id_and_profile_application_match(self):
        profile = deepcopy(PROFILE); profile['Entitlements']['com.apple.application-identifier'] += '.other'
        with self.assertRaisesRegex(RuntimeError, 'Application identifier'): self.validate(profile)
        signed = deepcopy(SIGNED); signed['com.apple.application-identifier'] += '.other'
        with self.assertRaisesRegex(RuntimeError, 'bundle'): self.validate(signed=signed)

    def test_groups_must_be_signed_and_authorized(self):
        profile = deepcopy(PROFILE); profile['Entitlements']['keychain-access-groups'] = []
        with self.assertRaisesRegex(RuntimeError, 'Keychain'): self.validate(profile)
        signed = deepcopy(SIGNED); signed['keychain-access-groups'] = ['PREFIXTEST.other']
        with self.assertRaisesRegex(RuntimeError, 'Keychain'): self.validate(signed=signed)
        signed = deepcopy(SIGNED); signed['keychain-access-groups'].append('OTHERTEAM1.extra')
        with self.assertRaisesRegex(RuntimeError, 'Keychain'): self.validate(signed=signed)

    def test_valid_wildcards_are_bounded_to_the_profile_prefix(self):
        profile = deepcopy(PROFILE)
        profile['Entitlements']['com.apple.application-identifier'] = 'PREFIXTEST.*'
        profile['Entitlements']['keychain-access-groups'] = ['PREFIXTEST.*']
        self.validate(profile)
        profile['Entitlements']['keychain-access-groups'] = ['PREFIXTES?.*']
        with self.assertRaises(RuntimeError): self.validate(profile)

    def test_debugging_requires_profile_authorization(self):
        for key in ('get-task-allow', 'com.apple.security.get-task-allow'):
            with self.subTest(key=key):
                signed = deepcopy(SIGNED); signed[key] = True
                with self.assertRaisesRegex(RuntimeError, 'debugging'): self.validate(signed=signed)
                profile = deepcopy(PROFILE); profile['Entitlements'][key] = True
                self.validate(profile, signed)

if __name__ == '__main__': unittest.main()
