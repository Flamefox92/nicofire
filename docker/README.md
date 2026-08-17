# NICOFIRE Vault — Docker Edition (v2)

The same secure vault as the desktop app, running in a container with a
built-in web UI. Useful for a headless PC, a home server, or running the
vault separately from the desktop.

## Features (identical to desktop v2)

- AES-256-GCM encryption, PBKDF2-SHA256 (100k iterations)
- Master password, change password, auto-lock
- Vault health audit (weak / reused / old detection + score)
- TOTP / 2FA code generation
- Password generator, folders, tags, favorites
- Dashboard, Spotlight search (Ctrl+K), dark/light themes
- Export / import JSON

## Run

```bash
docker compose up -d
```

Then open: **http://localhost:3000**

The port is bound to `127.0.0.1` only — never reachable from your network.

## Where is my data?

Stored encrypted in the Docker named volume `nicofire-data` at
`/app/data/vault.json` inside the container. It survives restarts and
rebuilds. To back it up:

```bash
docker run --rm -v nicofire-data:/data -v ${PWD}:/backup alpine \
  cp /data/vault.json /backup/vault-backup.json
```

## Stop / remove

```bash
docker compose down          # stop, keep data
docker compose down -v       # stop AND delete the vault (careful!)
```

## API (all localhost-only)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET  | /status | unlocked + vaultExists |
| POST | /unlock | { masterPassword } |
| POST | /lock | lock vault |
| POST | /change-password | { currentPassword, newPassword } |
| GET  | /passwords | all credentials |
| POST | /credential | create one |
| PUT  | /credential/:id | update one |
| DELETE | /credential/:id | delete one |
| POST | /credential/:id/favorite | toggle favorite |
| GET  | /health | vault health report |
| GET  | /generate | password generator |
| GET  | /totp?secret= | current 2FA code |
| GET/POST | /settings | read/write settings |
| GET  | /export | export credentials |
| POST | /import | import credentials |
