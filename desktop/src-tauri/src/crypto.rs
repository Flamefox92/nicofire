// crypto.rs — cryptographic primitives
//
// Key derivation: Argon2id (memory-hard, GPU/ASIC resistant) — PRIMARY.
//   PBKDF2-SHA256 is retained ONLY to open vaults created by older versions,
//   which are then transparently re-wrapped with Argon2id on next save.
// Encryption:  AES-256-GCM (authenticated).
// Nonce: 12 random bytes, fresh on every write. Salt: 32 random bytes.

use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use argon2::{Argon2, Algorithm, Params, Version};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 32;

// Legacy PBKDF2 iteration count (only for reading old vaults)
const PBKDF2_ITER_LEGACY: u32 = 100_000;

// ── Argon2id parameters ─────────────────────────────────────────────────────
// 64 MiB memory, 3 passes, 1 lane. Strong desktop defaults per OWASP 2024+.
const ARGON_MEM_KIB: u32 = 65_536; // 64 MiB
const ARGON_TIME:    u32 = 3;
const ARGON_LANES:   u32 = 1;

/// Derive a 256-bit key using Argon2id (current standard).
pub fn derive_key_argon2(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(ARGON_MEM_KIB, ARGON_TIME, ARGON_LANES, Some(KEY_LEN))
        .map_err(|e| format!("Argon2 params: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| format!("Argon2 derive: {e}"))?;
    Ok(key)
}

/// Legacy PBKDF2 derivation — used ONLY to open vaults made by older versions.
pub fn derive_key_pbkdf2(password: &str, salt: &[u8]) -> [u8; KEY_LEN] {
    let mut key = [0u8; KEY_LEN];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), salt, PBKDF2_ITER_LEGACY, &mut key);
    key
}

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut b = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut b);
    b
}
pub fn random_salt() -> Vec<u8> { random_bytes(SALT_LEN) }

pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce_bytes = random_bytes(NONCE_LEN);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ct = cipher.encrypt(nonce, plaintext).map_err(|_| "Encryption failed".to_string())?;
    Ok((nonce_bytes, ct))
}

pub fn decrypt(key: &[u8; KEY_LEN], nonce: &[u8], ct: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce);
    cipher.decrypt(nonce, ct).map_err(|_| "Wrong password or corrupted vault".to_string())
}

/// Password generator with proper (bias-free) rejection sampling.
pub fn generate_password(length: usize, upper: bool, lower: bool, digits: bool, symbols: bool) -> String {
    let mut charset: Vec<u8> = Vec::new();
    if lower  { charset.extend_from_slice(b"abcdefghijkmnopqrstuvwxyz"); }
    if upper  { charset.extend_from_slice(b"ABCDEFGHJKLMNPQRSTUVWXYZ"); }
    if digits { charset.extend_from_slice(b"23456789"); }
    if symbols{ charset.extend_from_slice(b"!@#$%^&*()-_=+[]{};:,.?"); }
    if charset.is_empty() { charset.extend_from_slice(b"abcdefghijklmnopqrstuvwxyz"); }

    let mut rng = rand::thread_rng();
    let target = length.max(4);
    let limit = 256 - (256 % charset.len());
    let mut out = String::new();
    while out.len() < target {
        let mut b = [0u8; 1];
        rng.fill_bytes(&mut b);
        let i = b[0] as usize;
        if i < limit { out.push(charset[i % charset.len()] as char); }
    }
    out
}
