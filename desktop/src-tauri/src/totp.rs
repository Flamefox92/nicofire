// totp.rs — RFC 6238 TOTP (time-based one-time password) generator
use hmac::{Hmac, Mac};
use sha1::Sha1;
use std::time::{SystemTime, UNIX_EPOCH};

type HmacSha1 = Hmac<Sha1>;

/// Generate a 6-digit TOTP code from a base32 secret (standard Google Authenticator format).
/// Returns (code, seconds_remaining_in_period).
pub fn generate(secret_b32: &str) -> Result<(String, u64), String> {
    // Normalise: strip spaces, uppercase, remove padding
    let cleaned: String = secret_b32.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase()
        .replace('=', "");

    let key = base32::decode(base32::Alphabet::Rfc4648 { padding: false }, &cleaned)
        .ok_or("Invalid base32 secret")?;
    if key.is_empty() { return Err("Empty secret".into()); }

    let now = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?.as_secs();
    let period = 30u64;
    let counter = now / period;
    let remaining = period - (now % period);

    let msg = counter.to_be_bytes();
    let mut mac = HmacSha1::new_from_slice(&key).map_err(|e| e.to_string())?;
    mac.update(&msg);
    let hash = mac.finalize().into_bytes();

    // Dynamic truncation (RFC 4226)
    let offset = (hash[hash.len() - 1] & 0x0f) as usize;
    let bin = ((hash[offset] as u32 & 0x7f) << 24)
        | ((hash[offset + 1] as u32) << 16)
        | ((hash[offset + 2] as u32) << 8)
        | (hash[offset + 3] as u32);
    let code = bin % 1_000_000;
    Ok((format!("{:06}", code), remaining))
}
