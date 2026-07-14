const SERVICE: &str = "com.sesh.terminal";

fn entry(profile_id: &str, kind: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, &format!("{profile_id}:{kind}"))
        .map_err(|e| format!("Credential vault is unavailable: {e}"))
}
pub fn set(profile_id: &str, kind: &str, value: &str) -> Result<(), String> {
    entry(profile_id, kind)?
        .set_password(value)
        .map_err(|e| format!("Could not save credential: {e}"))
}
pub fn get(profile_id: &str, kind: &str) -> Option<String> {
    entry(profile_id, kind).ok()?.get_password().ok()
}
pub fn delete(profile_id: &str, kind: &str) {
    if let Ok(e) = entry(profile_id, kind) {
        let _ = e.delete_credential();
    }
}
