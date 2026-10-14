//! Session ordering. session.rs restores and persists the counter in the OS store.
#[derive(Default)]
pub struct Revision(u64);
impl Revision {
    pub const fn new() -> Self { Self(0) }
    pub fn restored(value: u64) -> Self { Self(value) }
    pub fn current(&self) -> u64 { self.0 }
    pub fn check(&self, expected: u64) -> Result<(), String> {
        if self.0 == expected { Ok(()) } else { Err("Session changed".into()) }
    }
    pub fn apply<T>(&self, expected: u64, operation: impl FnOnce() -> T) -> Result<T, String> {
        self.check(expected)?;
        Ok(operation())
    }
    pub fn advance(&mut self) -> u64 { self.0 += 1; self.0 }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn delayed_native_command_cannot_change_a_newer_registration() {
        let mut revision = Revision::default();
        let queued = revision.current();
        revision.advance(); // old account signs out
        revision.advance(); // new account signs in and registers
        let mut registered = Some("account-b");
        assert!(revision.apply(queued, || registered = None).is_err());
        assert_eq!(registered, Some("account-b"));
        assert!(revision.apply(queued, || registered = Some("account-a")).is_err());
        assert_eq!(registered, Some("account-b"));
        revision.apply(revision.current(), || registered = None).unwrap();
        assert_eq!(registered, None);
    }
    #[test]
    fn held_write_cannot_replace_a_newer_session() {
        let mut revision = Revision::default();
        let held = revision.current();
        revision.advance(); // sign out
        revision.advance(); // different account signs in
        assert!(revision.check(held).is_err());
        assert!(revision.check(2).is_ok());
    }
}
