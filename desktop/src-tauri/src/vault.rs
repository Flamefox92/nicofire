// vault.rs — vault management + health audit + encrypted export
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Mutex, OnceLock}};
use crate::crypto;

#[derive(Serialize, Deserialize, Clone)]
pub struct VaultFile {
    pub salt: String,
    // "kdf" tells us how to derive the key. Absent = legacy PBKDF2 vault.
    #[serde(default = "kdf_legacy")]
    pub kdf: String,
    pub verifier: EncBlock,
    pub data: EncBlock,
}
fn kdf_legacy() -> String { "pbkdf2".into() }

#[derive(Serialize, Deserialize, Clone)]
pub struct EncBlock { pub nonce: String, pub ct: String }

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct VaultData {
    pub credentials: Vec<Credential>,
    #[serde(default)] pub logs: Vec<LogEntry>,
    #[serde(default)] pub settings: Settings,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Credential {
    pub id: String, pub website: String, pub username: String, pub password: String,
    #[serde(default)] pub label: Option<String>,
    #[serde(default)] pub folder: Option<String>,
    #[serde(default)] pub tags: Vec<String>,
    #[serde(default)] pub favorite: bool,
    #[serde(default)] pub totp_secret: Option<String>,
    #[serde(default)] pub notes: Option<String>,
    pub created_at: String, pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LogEntry { pub ts: i64, pub level: String, pub context: String, pub message: String }

#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    #[serde(default = "d_lock")] pub auto_lock_mins: u32,
    #[serde(default = "d_clip")] pub clip_clear_secs: u32,
    #[serde(default = "d_theme")] pub theme: String,
}
fn d_lock() -> u32 { 5 } fn d_clip() -> u32 { 20 } fn d_theme() -> String { "dark".into() }
impl Default for Settings { fn default() -> Self { Self { auto_lock_mins: 5, clip_clear_secs: 20, theme: "dark".into() } } }

pub struct VaultState { pub key: Option<[u8; 32]>, pub data: Option<VaultData>, pub path: PathBuf }
static STATE: OnceLock<Mutex<VaultState>> = OnceLock::new();
pub fn state() -> &'static Mutex<VaultState> {
    STATE.get_or_init(|| Mutex::new(VaultState { key: None, data: None, path: vault_path() }))
}
fn vault_path() -> PathBuf {
    let dir = dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("NICOFIRE");
    fs::create_dir_all(&dir).ok();
    dir.join("vault.json")
}

pub fn vault_exists() -> bool { state().lock().unwrap().path.exists() }
pub fn is_unlocked() -> bool { state().lock().unwrap().key.is_some() }

/// Unlock or create. Handles transparent migration from legacy PBKDF2 vaults.
pub fn unlock(password: &str) -> Result<bool, String> {
    let mut st = state().lock().unwrap();

    if !st.path.exists() {
        // New vault → Argon2id from the start
        let salt = crypto::random_salt();
        let key = crypto::derive_key_argon2(password, &salt)?;
        let (vn, vc) = crypto::encrypt(&key, b"NICOFIRE_VALID")?;
        let empty = serde_json::to_vec(&VaultData::default()).unwrap();
        let (dn, dc) = crypto::encrypt(&key, &empty)?;
        let vf = VaultFile {
            salt: hex::encode(&salt), kdf: "argon2id".into(),
            verifier: EncBlock { nonce: hex::encode(&vn), ct: hex::encode(&vc) },
            data: EncBlock { nonce: hex::encode(&dn), ct: hex::encode(&dc) },
        };
        write_file(&st.path, &vf)?;
        st.key = Some(key); st.data = Some(VaultData::default());
        return Ok(true);
    }

    let vf = read_file(&st.path)?;
    let salt = hex::decode(&vf.salt).map_err(|e| e.to_string())?;

    // Derive per the vault's KDF
    let key = match vf.kdf.as_str() {
        "argon2id" => crypto::derive_key_argon2(password, &salt)?,
        _          => crypto::derive_key_pbkdf2(password, &salt), // legacy
    };

    let vn = hex::decode(&vf.verifier.nonce).map_err(|e| e.to_string())?;
    let vc = hex::decode(&vf.verifier.ct).map_err(|e| e.to_string())?;
    match crypto::decrypt(&key, &vn, &vc) {
        Ok(v) if v == b"NICOFIRE_VALID" => {}
        _ => return Ok(false),
    }
    let dn = hex::decode(&vf.data.nonce).map_err(|e| e.to_string())?;
    let dc = hex::decode(&vf.data.ct).map_err(|e| e.to_string())?;
    let plain = crypto::decrypt(&key, &dn, &dc)?;
    let data: VaultData = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;

    st.key = Some(key); st.data = Some(data);
    let was_legacy = vf.kdf != "argon2id";
    drop(st);

    // Transparent upgrade: re-wrap a legacy vault under Argon2id using the same password.
    if was_legacy {
        let _ = migrate_to_argon2(password);
    }
    Ok(true)
}

/// Re-derive with Argon2id and rewrite the whole vault. Called after opening a legacy vault.
fn migrate_to_argon2(password: &str) -> Result<(), String> {
    let mut st = state().lock().unwrap();
    let data = st.data.clone().ok_or("No data")?;
    let salt = crypto::random_salt();
    let key = crypto::derive_key_argon2(password, &salt)?;
    let (vn, vc) = crypto::encrypt(&key, b"NICOFIRE_VALID")?;
    let plain = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let (dn, dc) = crypto::encrypt(&key, &plain)?;
    let vf = VaultFile {
        salt: hex::encode(&salt), kdf: "argon2id".into(),
        verifier: EncBlock { nonce: hex::encode(&vn), ct: hex::encode(&vc) },
        data: EncBlock { nonce: hex::encode(&dn), ct: hex::encode(&dc) },
    };
    write_file(&st.path, &vf)?;
    st.key = Some(key);
    Ok(())
}

pub fn lock() {
    let mut st = state().lock().unwrap();
    if let Some(ref mut k) = st.key { k.fill(0); }
    st.key = None; st.data = None;
}

pub fn save() -> Result<(), String> {
    let st = state().lock().unwrap();
    let key = st.key.as_ref().ok_or("Vault is locked")?;
    let data = st.data.as_ref().ok_or("No data")?;
    let mut vf = read_file(&st.path)?;
    vf.kdf = "argon2id".into(); // ensure we never downgrade
    let plain = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    let (n, c) = crypto::encrypt(key, &plain)?;
    vf.data = EncBlock { nonce: hex::encode(&n), ct: hex::encode(&c) };
    let tmp = st.path.with_extension("tmp");
    write_file(&tmp, &vf)?;
    fs::rename(&tmp, &st.path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn change_password(old: &str, new: &str) -> Result<bool, String> {
    if !unlock(old)? { return Ok(false); }
    let mut st = state().lock().unwrap();
    let data = st.data.clone().ok_or("No data")?;
    let salt = crypto::random_salt();
    let new_key = crypto::derive_key_argon2(new, &salt)?;
    let (vn, vc) = crypto::encrypt(&new_key, b"NICOFIRE_VALID")?;
    let plain = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    let (dn, dc) = crypto::encrypt(&new_key, &plain)?;
    let nvf = VaultFile {
        salt: hex::encode(&salt), kdf: "argon2id".into(),
        verifier: EncBlock { nonce: hex::encode(&vn), ct: hex::encode(&vc) },
        data: EncBlock { nonce: hex::encode(&dn), ct: hex::encode(&dc) },
    };
    write_file(&st.path, &nvf)?;
    st.key = Some(new_key);
    Ok(true)
}

// ── Encrypted export / import ────────────────────────────────────────────────
// Produces a self-contained encrypted blob protected by a user-chosen passphrase
// (independent of the master password). Format mirrors the vault file.
#[derive(Serialize, Deserialize)]
pub struct EncryptedExport {
    pub format: String,   // "nicofire-encrypted-export-v1"
    pub kdf: String,      // "argon2id"
    pub salt: String,
    pub nonce: String,
    pub ct: String,
}

pub fn export_encrypted(passphrase: &str) -> Result<String, String> {
    let st = state().lock().unwrap();
    let creds = st.data.as_ref().map(|d| d.credentials.clone()).ok_or("Locked")?;
    drop(st);
    let salt = crypto::random_salt();
    let key = crypto::derive_key_argon2(passphrase, &salt)?;
    let plain = serde_json::to_vec(&creds).map_err(|e| e.to_string())?;
    let (nonce, ct) = crypto::encrypt(&key, &plain)?;
    let exp = EncryptedExport {
        format: "nicofire-encrypted-export-v1".into(),
        kdf: "argon2id".into(),
        salt: hex::encode(&salt), nonce: hex::encode(&nonce), ct: hex::encode(&ct),
    };
    serde_json::to_string_pretty(&exp).map_err(|e| e.to_string())
}

pub fn import_encrypted(blob: &str, passphrase: &str) -> Result<usize, String> {
    let exp: EncryptedExport = serde_json::from_str(blob)
        .map_err(|_| "Not a valid NICOFIRE encrypted export".to_string())?;
    if !exp.format.starts_with("nicofire-encrypted-export") {
        return Err("Unrecognised export format".into());
    }
    let salt = hex::decode(&exp.salt).map_err(|e| e.to_string())?;
    let key = crypto::derive_key_argon2(passphrase, &salt)?;
    let nonce = hex::decode(&exp.nonce).map_err(|e| e.to_string())?;
    let ct = hex::decode(&exp.ct).map_err(|e| e.to_string())?;
    let plain = crypto::decrypt(&key, &nonce, &ct)
        .map_err(|_| "Wrong passphrase or corrupted export".to_string())?;
    let incoming: Vec<Credential> = serde_json::from_slice(&plain).map_err(|e| e.to_string())?;

    let mut st = state().lock().unwrap();
    let d = st.data.as_mut().ok_or("Locked")?;
    let mut added = 0;
    for mut c in incoming {
        if !d.credentials.iter().any(|e| e.website == c.website && e.username == c.username) {
            if c.id.is_empty() { c.id = uuid_new(); }
            d.credentials.push(c); added += 1;
        }
    }
    drop(st);
    save()?;
    Ok(added)
}

fn uuid_new() -> String { uuid::Uuid::new_v4().to_string() }

// ── Health audit ─────────────────────────────────────────────────────────────
#[derive(Serialize)]
pub struct HealthReport { pub score: u32, pub total: usize, pub weak: Vec<String>, pub reused: Vec<String>, pub old: Vec<String> }

pub fn health() -> HealthReport {
    let st = state().lock().unwrap();
    let creds = st.data.as_ref().map(|d| d.credentials.clone()).unwrap_or_default();
    let total = creds.len();
    let (mut weak, mut reused, mut old) = (Vec::new(), Vec::new(), Vec::new());
    let mut seen: HashMap<&str, Vec<&str>> = HashMap::new();
    for c in &creds { seen.entry(c.password.as_str()).or_default().push(&c.id); }
    for (_p, ids) in &seen { if ids.len() > 1 { for id in ids { reused.push(id.to_string()); } } }
    let now = chrono::Utc::now();
    for c in &creds {
        if password_strength(&c.password) < 3 { weak.push(c.id.clone()); }
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&c.updated_at) {
            if (now - dt.with_timezone(&chrono::Utc)).num_days() > 365 { old.push(c.id.clone()); }
        }
    }
    let score = if total == 0 { 100 } else {
        let issues = weak.len() + reused.len() + old.len();
        let max = total * 3;
        (100 - ((issues.min(max) * 100) / max)) as u32
    };
    HealthReport { score, total, weak, reused, old }
}

pub fn password_strength(pw: &str) -> u32 {
    let mut s = 0;
    if pw.len() >= 8 { s += 1; }
    if pw.len() >= 12 { s += 1; }
    if pw.chars().any(|c| c.is_uppercase()) && pw.chars().any(|c| c.is_lowercase()) { s += 1; }
    if pw.chars().any(|c| c.is_ascii_digit()) { s += 1; }
    if pw.chars().any(|c| !c.is_alphanumeric()) { s += 1; }
    s
}

fn read_file(p: &PathBuf) -> Result<VaultFile, String> {
    let raw = fs::read(p).map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw).map_err(|e| e.to_string())
}
fn write_file(p: &PathBuf, vf: &VaultFile) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(vf).map_err(|e| e.to_string())?;
    fs::write(p, json).map_err(|e| e.to_string())
}
