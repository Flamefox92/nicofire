# NICOFIRE v2.1.0 — Security Hardening Release

This release implements the highest-impact fixes identified in a security review.
The focus: protect the vault **at rest** as strongly as possible, and close the
most likely real-world leak paths.

## What changed

### 1. Argon2id key derivation (was: PBKDF2-100k)
The master password is now stretched with **Argon2id** — a memory-hard function
that is resistant to GPU and ASIC brute-force attacks.

- Parameters: 64 MiB memory, 3 passes, 1 lane (OWASP-aligned desktop defaults).
- Why it matters: if someone steals your `vault.json`, Argon2id makes offline
  password-guessing dramatically slower and more expensive than PBKDF2 did.
- **Existing vaults migrate automatically.** The first time you unlock a vault
  created by an older version, it is transparently re-encrypted under Argon2id
  using your same master password. No action needed; nothing is lost.

### 2. Encrypted backup by default (was: plaintext JSON only)
Backups are now encrypted with a passphrase you choose.

- "🔒 Encrypted backup" produces a `.ncf` file — AES-256-GCM, Argon2id-derived
  key from your passphrase. Safe to store anywhere; useless without the passphrase.
- "🔓 Restore backup" reads it back.
- The old plaintext JSON export still exists but is now clearly marked as unsafe
  and requires confirming a warning before it runs.

### 3. Strict Content-Security-Policy + XSS hardening (was: CSP disabled)
The app previously ran with CSP turned off. It is now locked down.

- CSP: `script-src 'self'` — injected content cannot execute script, so a
  malicious value in a saved field cannot call the backend and exfiltrate the vault.
- All rendered fields are HTML-escaped; identifiers placed in HTML attributes are
  stripped to a safe character set; the escape function now also handles single quotes.

### 4. Clipboard privacy hardening
When you copy a username or password, the clipboard entry is now tagged to be:

- excluded from **Windows Clipboard History**,
- excluded from **cloud clipboard sync** to other devices,
- excluded from clipboard monitoring by other tools.

Combined with the existing auto-clear timer, this significantly reduces how long
and how widely a copied secret is exposed.

## What did NOT change (deliberately)

- **No cloud, no telemetry, no network calls.** Still 100% local.
- **No master-password recovery.** Losing it still means losing the vault — this
  is what keeps the vault secure, and adding recovery would weaken it.
- **AES-256-GCM** remains the cipher (it was already appropriate).

## Honest limitations that remain

These are inherent to any local password manager and cannot be fully solved:

- While the vault is **unlocked**, decrypted secrets exist in process memory and
  could be read by malware running as your Windows user. Lock the vault when away.
- The master password is typed into a normal window, so a keylogger on an already
  compromised machine could capture it. (Biometric/Windows Hello unlock is a
  candidate future mitigation.)
- The installer is not yet code-signed, so Windows SmartScreen shows a warning on
  first run. Code-signing is the recommended next step.

## Upgrade notes

- Just install v2.1.0 over your existing version and unlock as normal — your vault
  migrates itself to Argon2id automatically on first unlock.
- After upgrading, consider making a fresh **encrypted backup** and deleting any
  old plaintext JSON exports you may have created.
