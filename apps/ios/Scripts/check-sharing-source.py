#!/usr/bin/env python3
"""Linux-capable packaging/security contract checks; NOT Swift/Rust compilation."""
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

root = Path(__file__).resolve().parents[1]
repo = root.parents[1]

class SharingSources(unittest.TestCase):
    def test_generated_project_is_reproducible_and_embeds_extension(self):
        project = root / 'Index.xcodeproj/project.pbxproj'
        before = project.read_text()
        with tempfile.TemporaryDirectory() as directory:
            generated = Path(directory) / 'Index.xcodeproj'
            subprocess.run([sys.executable, str(root / 'Scripts/generate-project.py'), '--output', str(generated)], check=True)
            for file in generated.rglob('*'):
                if file.is_file():
                    self.assertEqual(file.read_bytes(), (project.parent / file.relative_to(generated)).read_bytes(), str(file.relative_to(generated)))
        self.assertEqual(before.count('productType = "com.apple.product-type.app-extension"'), 2)
        for required in ['ShareExtension/ShareViewController.swift', 'Embed App Extensions', 'PBXTargetDependency', 'productName = IndexSharing', 'productName = IndexUI', 'APPLICATION_EXTENSION_API_ONLY = "YES"']:
            self.assertIn(required, before)

    def test_activation_and_matching_entitlements(self):
        for platform in ['iOS', 'macOS']:
            info = plistlib.loads((root / f'ShareExtension/{platform}-Info.plist').read_bytes())
            ext = info['NSExtension']
            self.assertEqual(ext['NSExtensionPointIdentifier'], 'com.apple.share-services')
            self.assertEqual(ext['NSExtensionPrincipalClass'], 'ShareViewController')
            rule = ext['NSExtensionAttributes']['NSExtensionActivationRule']
            self.assertIsInstance(rule, dict)
            self.assertEqual(rule['NSExtensionActivationSupportsWebURLWithMaxCount'], 1)
            self.assertNotIn('NSExtensionActivationSupportsImageWithMaxCount', rule)
            ent = plistlib.loads((root / f'ShareExtension/{platform}.entitlements').read_bytes())
            host = plistlib.loads((root / 'Config/Index.entitlements').read_bytes())
            self.assertEqual(ent['keychain-access-groups'], host['keychain-access-groups'])
            self.assertEqual(info['IndexKeychainGroup'], '$(INDEX_KEYCHAIN_GROUP)')
            if platform == 'macOS':
                self.assertTrue(ent['com.apple.security.app-sandbox'])
                self.assertTrue(ent['com.apple.security.network.client'])

    def test_extension_auth_is_read_only_and_pinned(self):
        api = (root / 'Sources/IndexCore/APIClient.swift').read_text()
        self.assertIn('if !externallyManagedSession, let signed', api)
        self.assertGreaterEqual(api.count('credentials.read() == token'), 2)
        self.assertIn('if !externallyManagedSession { try credentials.write(nil) }', api)
        model = (root / 'Sources/IndexSharing/ShareModel.swift').read_text()
        self.assertIn('ReadOnlyCredentials', model)
        self.assertIn('session.user.id == account', model)
        self.assertIn('session.user.emailVerified', model)
        for folder in ['Sources/IndexSharing', 'ShareExtension']:
            for source in (root / folder).rglob('*.swift'):
                self.assertNotIn('UserDefaults', source.read_text())
                self.assertNotIn('UIApplication.shared', source.read_text())

    def test_configured_mac_credentials_fail_closed_and_smoke_is_separate(self):
        session = (repo / 'apps/web/src-tauri/src/session.rs').read_text()
        self.assertIn('not(feature = "native-smoke")', session)
        self.assertIn('if shared_session::enabled() { return shared_session::read(); }', session)
        self.assertIn('if shared_session::enabled() { return shared_session::write(token); }', session)
        bridge = (repo / 'apps/web/src-tauri/native/shared_session.m').read_text()
        self.assertIn('kSecUseDataProtectionKeychain: @YES', bridge)
        self.assertIn('kSecAttrAccessibleWhenUnlockedThisDeviceOnly', bridge)
        packaging = (repo / 'apps/web/scripts/share-extension-build.mjs').read_text()
        self.assertIn('"PlugIns/IndexShareMac.appex": extension', packaging)
        self.assertRegex(packaging, r'"-scheme",\s*"IndexShareMac"')

if __name__ == '__main__': unittest.main()
