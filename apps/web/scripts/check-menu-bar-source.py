#!/usr/bin/env python3
"""Linux source/config checks only; does not compile Rust/Objective-C or exercise macOS."""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
TAURI = WEB / 'src-tauri'

class MenuBarPackaging(unittest.TestCase):
    def test_local_windows_keep_navigation_and_ipc_boundary(self):
        capability = json.loads((TAURI / 'capabilities/default.json').read_text())
        self.assertEqual(set(capability['windows']), {'main', 'menu-bar'})
        self.assertNotIn('remote', capability)
        self.assertEqual(capability['permissions'], ['core:default'])
        windows = (TAURI / 'src/menu_bar.rs').read_text()
        self.assertIn('crate::restrict_navigation(WebviewWindowBuilder::from_config', windows)
        self.assertIn('crate::restrict_navigation(builder, app).build()', windows)
        library = (TAURI / 'src/lib.rs').read_text()
        self.assertIn('NewWindowResponse::Deny', library)
        for command in ['session_snapshot', 'session_compare_write', 'session_touch',
                        'desktop_open', 'desktop_take_navigation', 'desktop_panel_ready',
                        'desktop_hide', 'desktop_quit', 'launch_at_login_status', 'launch_at_login_set']:
            self.assertEqual(library.count('::' + command + ','), 2, command)

    def test_native_asset_and_composed_build(self):
        asset = TAURI / 'icons/menu-bar.pdf'
        before = asset.read_bytes()
        self.assertTrue(before.startswith(b'%PDF-1.4'))
        subprocess.run([sys.executable, str(WEB / 'scripts/menu-bar-icon.py')], check=True)
        self.assertEqual(before, asset.read_bytes())
        build = (TAURI / 'build.rs').read_text()
        for module in ['sharing_build', 'notification_build', 'menu_bar_build']:
            self.assertIn(module + '::build()', build)
        menu_build = (TAURI / 'menu_bar_build.rs').read_text()
        self.assertIn('native/menu_bar.m', menu_build)
        self.assertIn('ServiceManagement', menu_build)

    def test_login_items_only_register_from_explicit_set(self):
        source = (TAURI / 'native/menu_bar.m').read_text()
        before_set, setter = source.split('int index_login_set', 1)
        self.assertNotIn('registerAndReturnError', before_set)
        self.assertIn('@available(macOS 13.0, *)', before_set)
        self.assertIn('SMAppService.mainAppService.status', before_set)
        self.assertIn('SMAppServiceStatusRequiresApproval', before_set)
        self.assertIn('unregisterAndReturnError', setter)
        self.assertIn('LOCK_EX | LOCK_NB', before_set)
        self.assertIn('O_NOFOLLOW | O_CLOEXEC', before_set)

    def test_notification_click_and_window_lifecycle_are_main_owned(self):
        click = (TAURI / 'native/notifications.m').read_text()
        self.assertIn('index_show_main();', click)
        self.assertNotIn('for (NSWindow *window in NSApp.windows)', click)
        menu = (TAURI / 'src/menu_bar.rs').read_text()
        lifecycle = menu.split('pub fn attach_lifecycle', 1)[1].split('fn valid_navigation', 1)[0]
        self.assertIn('api.prevent_close()', lifecycle)
        self.assertIn('handle.hide()', lifecycle)
        self.assertNotIn('invalidate()', lifecycle)
        self.assertNotIn('notification_stop', lifecycle)
        self.assertNotIn('shutdown()', lifecycle)
        self.assertIn('notifications::shutdown()', (TAURI / 'src/lib.rs').read_text())
        self.assertIn('!isMenuBar && <NotificationLifecycle', (WEB / 'src/routes/__root.tsx').read_text())

    def test_revision_guards_cover_native_notification_mutations(self):
        notifications = (TAURI / 'src/notifications.rs').read_text()
        for name in ['notification_start', 'notification_stop', 'notification_active', 'notification_take_click']:
            signature = re.search(r'pub async fn ' + name + r'\(([^)]*)\)', notifications).group(1)
            self.assertIn('expected_revision: u64', signature)
        self.assertGreaterEqual(notifications.count('with_revision(expected_revision'), 5)
        start = notifications.split('async fn start(', 1)[1].split('#[tauri::command]', 1)[0]
        self.assertLess(start.index('auth["user"]["emailVerified"]'), start.index('advance(&mut state)'))
        session = (TAURI / 'src/session.rs').read_text()
        self.assertIn('if token.is_none() { crate::notifications::invalidate(); }', session)
        self.assertIn('revision.apply(expected, operation)', session)
        self.assertIn('if shared_session::enabled() { return shared_session::read(); }', session)
        self.assertIn('if shared_session::enabled() { return shared_session::write(token); }', session)

    def test_stale_notification_work_never_clears_new_runtime_or_adopts_epoch(self):
        source = (TAURI / 'src/notifications.rs').read_text()
        terminal = source.split('fn invalidate_if_current(', 1)[1].split('/// Process exit', 1)[0]
        self.assertEqual(terminal.count('runtime().lock()'), 1)
        self.assertIn('if state.generation == generation { invalidate_locked(&mut state); }', terminal)
        capture = source.split('fn display_epoch(', 1)[1].split('fn invalidate_locked', 1)[0]
        self.assertIn('runtime().lock()', capture)
        self.assertIn('(state.generation == generation).then(os::epoch)', capture)
        run = source.split('async fn run(', 1)[1].split('#[cfg(test)]', 1)[0]
        self.assertIn('invalidate_if_current(generation);', run)
        self.assertNotIn('os::clear()', run)
        self.assertLess(run.index('display_epoch(generation)'), run.index('spawn_blocking'))
        self.assertIn('move || os::show(&data, epoch)', run)
        native = (TAURI / 'native/notifications.m').read_text()
        show = native.split('int index_notifications_show(const char *json, uint64_t epoch)', 1)[1].split('void index_notifications_clear', 1)[0]
        self.assertNotIn('uint64_t epoch =', show)
        self.assertNotIn('removeAll', show)
        self.assertGreaterEqual(show.count('epoch != atomic_load(&notificationEpoch)'), 4)
        self.assertIn('removeDeliveredNotificationsWithIdentifiers', show)
        self.assertIn('old_worker_termination_cannot_invalidate_new_runtime', source)
        self.assertIn('queued_old_display_cannot_adopt_new_epoch_or_clear_it', source)

if __name__ == '__main__':
    unittest.main()
