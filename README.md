<div align="center">

# 🔥 NICOFIRE

### Your passwords — private, encrypted, and entirely your own.

**A local-first password manager with no cloud, no telemetry, and no tracking.**

[![License: MIT](https://img.shields.io/badge/License-MIT-7c5cff.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Docker-ff6b2c)
![Encryption](https://img.shields.io/badge/encryption-AES--256--GCM-3ddc84)
![Key Derivation](https://img.shields.io/badge/KDF-Argon2id-3ddc84)
![Made with Rust](https://img.shields.io/badge/built%20with-Rust%20%2B%20Tauri-a98bff)

</div>

---

## What is NICOFIRE?

NICOFIRE is a password manager that keeps every one of your logins inside a single
encrypted vault, locked behind one master password that only you know. Instead of reusing
weak passwords or scattering them across sticky notes and browsers, you keep them all in one
place — protected by strong, modern cryptography.

What makes NICOFIRE different is its **uncompromising commitment to privacy**. It runs
entirely on your own machine. There is no cloud account, no syncing to someone else's
server, no analytics, and no network activity of any kind. Your passwords never leave your
computer. Even the little site icons are drawn locally, so NICOFIRE never so much as hints
to the outside world which websites you use.

It comes in two editions that share the exact same interface and security model — pick
whichever fits how you work, or use both.

---

## The two editions

| | 🖥️ **Desktop** | 🐳 **Docker** |
|---|---|---|
| **Best for** | Everyday use on a Windows PC | Home servers, headless boxes, self-hosting |
| **Runs as** | A native app in your system tray | A container serving a local web app |
| **Built with** | Rust + Tauri 2 | Node.js + Express |
| **You open it** | As a normal desktop window | At `http://localhost:3000` |
| **Where it lives** | [`/desktop`](desktop) | [`/docker`](docker) |

Both store an encrypted vault locally, both are localhost-only, and both are built on the
same AES-256-GCM + Argon2id foundation.

---

## Features

### 🔒 Security
- **AES-256-GCM** authenticated encryption — tampering is detected, not just prevented
- **Argon2id** key derivation — memory-hard and resistant to brute-force cracking
- **Master password** is never stored; the key exists in memory only while the vault is unlocked
- **Auto-lock** after inactivity, and **clipboard auto-clear** after you copy a password
- **Vault health audit** — flags weak, reused, and aging passwords and gives you a score
- **Built-in 2FA / TOTP** codes (the same standard as Google Authenticator)
- **Encrypted backups** — passphrase-protected export files you can safely store anywhere

### 🎨 Interface
- A clean **dashboard** with a live health-score ring
- **Spotlight search** — hit `Ctrl+K` and start typing to find any login instantly
- **Folders, tags, and favorites** to organize everything
- **Dark and light themes** in a warm purple-and-ember palette
- **Password generator** with adjustable rules
- Fast, keyboard-friendly, and lightweight

---

## Quick start

### 🖥️ Desktop (Windows)

Build the installer — the script sets up everything it needs automatically:

```powershell
cd desktop
.\BUILD.bat
```

When it finishes, you'll have a one-click installer under
`desktop/src-tauri/target/release/bundle/`. Double-click it to install NICOFIRE like any
normal Windows app. Full details are in [`desktop/HOW_TO_BUILD.md`](desktop/HOW_TO_BUILD.md).

Prefer to just try it in development first?

```powershell
cd desktop
npm install
npm run dev
```

### 🐳 Docker

```bash
cd docker
docker compose up -d
```

Then open **http://localhost:3000** in your browser. Full details are in
[`docker/README.md`](docker/README.md).

---

## How your data is protected

When you unlock NICOFIRE, your master password is run through **Argon2id** to derive an
encryption key. That key decrypts your vault into memory — and is wiped the moment you lock
it. The vault file on disk is encrypted with **AES-256-GCM** and is useless to anyone
without your master password.

Your vault lives at:
- **Desktop:** `%APPDATA%\NICOFIRE\vault.json`
- **Docker:** a private Docker volume (`nicofire-data`)

> ⚠️ **Please note:** Your master password **cannot be recovered**. This is deliberate —
> there is no backdoor, which is precisely what keeps your vault secure. Choose a strong
> master password you'll remember, and keep a safe note of it until you do.

Like every local password manager, NICOFIRE protects your vault **at rest**. It cannot
defend a computer that is already infected with malware while the vault is unlocked — so
keep your system clean and lock the vault when you step away. See [SECURITY.md](SECURITY.md)
for the full threat model.

---

## Repository structure

```
nicofire/
├─ desktop/      🖥️  Windows desktop edition (Tauri 2 + Rust)
├─ docker/       🐳  Docker edition (Node.js + Express)
├─ LICENSE       📄  MIT license
├─ SECURITY.md   🔒  Security policy & responsible disclosure
└─ README.md     👋  You are here
```

---

## Contributing

Contributions, ideas, and bug reports are welcome. Because this is a security tool, please
report any vulnerability privately through a
[GitHub Security Advisory](../../security/advisories/new) rather than a public issue — see
[SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE) — free to use, study, modify, and share.

---

<div align="center">
<sub>🔥 <b>NICOFIRE</b> — because your passwords should belong to you, and no one else.</sub>
</div>
