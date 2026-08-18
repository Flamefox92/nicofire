NICOFIRE v2 — Secure Local Password Manager
A fully private, offline, AES-256 encrypted password manager for Windows. No cloud. No telemetry. No network calls. Everything stays on your machine.

Features
Security

AES-256-GCM authenticated encryption
Encrypted backups (passphrase-protected .ncf files)
Strict Content-Security-Policy; clipboard excluded from Windows history/cloud sync
Argon2id key derivation (memory-hard, GPU-resistant) — auto-migrates old PBKDF2 vaults
Master password — never stored, only the derived key lives in memory while unlocked
Auto-lock after inactivity (configurable)
Clipboard auto-clear after copy (configurable)
Vault health audit: detects weak, reused, and aging passwords
Built-in secure password generator with rules
Built-in TOTP / 2FA code generator (RFC 6238)
Change master password (re-encrypts everything)
Interface
Dashboard with animated health score ring
Spotlight-style quick search (Ctrl+K)
Folders, tags, and favorites
Dark and light themes with purple/ember palette
Locally-generated color avatars (no favicon fetching = no privacy leak)
Live TOTP codes with countdown rings
Export / import JSON backups
Keyboard shortcuts
Ctrl+K — Quick search
Ctrl+N — Add credential
Esc — Close dialogs




Build & run
# Prerequisites (one-time): Rust, Node.js, MS C++ Build Tools
cd nicofire-v2
npm install
npm run dev        # development
npm run build      # production installer → src-tauri/target/release/bundle/



Where is my data?
Encrypted vault: %APPDATA%\NICOFIRE\vault.json This file is useless without your master password.

Backup
Settings → Export JSON. Store the backup somewhere safe — it contains your credentials in plaintext JSON, so treat it like a secret.
