# NICOFIRE — How to build the one-click installer

This produces a Windows installer you can give to **any** PC. On that PC,
the user just double-clicks and NICOFIRE installs like a normal app —
no Rust, no Node, no Docker, no build tools required.

There are two phases: **build once**, then **distribute the installer**.

---

## Phase 1 — Build the installer (do this once)

You need one Windows machine to compile on. Everything is automated.

### Easiest way
1. Unzip this folder anywhere (e.g. `Downloads\nicofire-v2`).
2. **Double-click `BUILD.bat`.**
3. Wait. The script will:
   - Install Node.js, Rust, and the Visual C++ Build Tools if missing
   - Install project dependencies
   - Compile NICOFIRE and produce the installer
4. When it finishes, an Explorer window opens showing the installer files.

First run takes 15–30 min mostly because of the C++ Build Tools download
and the initial Rust compile. Later builds take 2–3 min.

### If BUILD.bat is blocked
Right-click `BUILD.ps1` → **Run with PowerShell**, or run in a terminal:
```powershell
powershell -ExecutionPolicy Bypass -File BUILD.ps1
```

### Where the installer lands
```
src-tauri\target\release\bundle\nsis\NICOFIRE_2.0.0_x64-setup.exe   <- one-click installer (recommended)
src-tauri\target\release\bundle\msi\NICOFIRE_2.0.0_x64_en-US.msi    <- MSI (for enterprise/GPO deploys)
```

---

## Phase 2 — Distribute (give NICOFIRE to any PC)

Copy the `.exe` (or `.msi`) to the target PC and double-click it.

- Installs per-user (no admin needed)
- Adds a Start Menu shortcut and optional desktop icon
- Runs in the system tray; the vault window opens on launch
- Uninstall via Settings → Apps like any normal program

The target PC needs **nothing** pre-installed. WebView2 (the render engine)
ships with Windows 10/11. If a very old Windows build lacks it, the installer
fetches it automatically.

---

## What the app does

A fully offline, AES-256-GCM encrypted password manager:
- Master password, auto-lock, clipboard auto-clear
- Vault health score (weak / reused / old detection)
- Built-in TOTP / 2FA codes
- Password generator, folders, tags, favorites
- Spotlight search (Ctrl+K), dark/light themes
- Export / import JSON backups

Vault location on the user's PC: `%APPDATA%\NICOFIRE\vault.json` (encrypted).

---

## Troubleshooting the build

**"link.exe not found"** — the C++ workload didn't install. Re-run BUILD.bat,
or open the Visual Studio Installer, Modify the Build Tools, and tick
"Desktop development with C++".

**"cargo/npm not recognized" right after install** — the script refreshes PATH
automatically, but if it still happens, close the window and run BUILD.bat again;
the tools are installed, they just needed a fresh shell.

**Build succeeds but no installer** — check the very first red error line in the
output; share it and it can be fixed quickly.

---

## Reproducible builds (Cargo.lock)

Dependencies are pinned to **exact versions** in `src-tauri/Cargo.toml`
(e.g. `aes-gcm = "=0.10.3"`). The first build generates `src-tauri/Cargo.lock`,
which locks the entire dependency tree — including transitive dependencies —
so every subsequent build on any machine is identical.

**Keep `src-tauri/Cargo.lock` after the first build** (commit it / include it in
backups). With it present, builds never drift and never break from upstream
crate updates.
