// server.js — NICOFIRE vault REST API (localhost only)
'use strict';
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const V = require('./vault');

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(cors({ origin: (o, cb) => cb(null, true) }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// ── Status / auth ────────────────────────────────────────────────────────────────
app.get('/status', (req, res) =>
  res.json({ unlocked: V.isUnlocked(), vaultExists: V.exists() }));

app.post('/unlock', async (req, res) => {
  const { masterPassword } = req.body || {};
  if (!masterPassword) return res.status(400).json({ success: false, error: 'masterPassword required' });
  try {
    const ok = await V.unlock(masterPassword);
    if (ok) { V.log('INFO', 'auth', 'Vault unlocked'); V.persist(); }
    res.json({ success: ok, error: ok ? undefined : 'Wrong master password' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/lock', (req, res) => { V.lock(); res.json({ success: true }); });

app.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword)
    return res.status(400).json({ success: false, error: 'Both passwords required' });
  try {
    const ok = await V.changePassword(currentPassword, newPassword);
    res.json({ success: ok, error: ok ? undefined : 'Current password is wrong' });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Guard ─────────────────────────────────────────────────────────────────────────
function requireUnlock(req, res, next) {
  if (!V.isUnlocked()) return res.status(401).json({ error: 'Vault locked', locked: true });
  next();
}

// ── Credentials ────────────────────────────────────────────────────────────────────
app.get('/passwords', requireUnlock, (req, res) => {
  res.json({ passwords: V.getData().credentials });
});

// Legacy match endpoint (kept for compatibility with earlier builds)
app.get('/passwords/match', (req, res) => {
  if (!V.isUnlocked()) return res.json({ matches: [] });
  const host = (req.query.hostname || '').toLowerCase().replace(/^www\./, '');
  const norm = s => (s || '').replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0].toLowerCase();
  const matches = V.getData().credentials.filter(c => {
    const s = norm(c.website);
    return s === host || s.endsWith('.' + host) || host.endsWith('.' + s);
  });
  res.json({ matches });
});

app.post('/passwords', requireUnlock, (req, res) => {
  // Bulk replace (used by import / older UI)
  const { passwords } = req.body || {};
  if (!Array.isArray(passwords)) return res.status(400).json({ error: 'passwords must be an array' });
  V.getData().credentials = passwords;
  try { V.persist(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/credential', requireUnlock, (req, res) => {
  const b = req.body || {};
  if (!b.website || !b.username || !b.password)
    return res.status(400).json({ success: false, error: 'website, username, password required' });
  const cred = {
    id: uuid(), website: b.website, username: b.username, password: b.password,
    label: b.label || null, folder: b.folder || null, tags: b.tags || [],
    favorite: !!b.favorite, totp_secret: b.totp_secret || null, notes: b.notes || null,
    created_at: now(), updated_at: now(),
  };
  V.getData().credentials.push(cred);
  V.log('INFO', 'vault', `Saved ${b.website}`);
  try { V.persist(); res.json({ success: true, id: cred.id }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.put('/credential/:id', requireUnlock, (req, res) => {
  const c = V.getData().credentials.find(x => x.id === req.params.id);
  if (!c) return res.status(404).json({ success: false, error: 'Not found' });
  const b = req.body || {};
  Object.assign(c, {
    website: b.website ?? c.website, username: b.username ?? c.username, password: b.password ?? c.password,
    label: b.label ?? c.label, folder: b.folder ?? c.folder, tags: b.tags ?? c.tags,
    favorite: b.favorite ?? c.favorite, totp_secret: b.totp_secret ?? c.totp_secret,
    notes: b.notes ?? c.notes, updated_at: now(),
  });
  try { V.persist(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/credential/:id', requireUnlock, (req, res) => {
  const d = V.getData();
  d.credentials = d.credentials.filter(c => c.id !== req.params.id);
  V.log('INFO', 'vault', 'Deleted credential');
  try { V.persist(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/credential/:id/favorite', requireUnlock, (req, res) => {
  const c = V.getData().credentials.find(x => x.id === req.params.id);
  if (c) c.favorite = !c.favorite;
  try { V.persist(); res.json({ success: true, favorite: c?.favorite }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Features ────────────────────────────────────────────────────────────────────────
app.get('/health', requireUnlock, (req, res) => res.json(V.health()));

app.get('/generate', (req, res) => {
  const { length = 20, upper = 'true', lower = 'true', digits = 'true', symbols = 'true' } = req.query;
  const pw = V.genPassword(+length, upper !== 'false', lower !== 'false', digits !== 'false', symbols !== 'false');
  res.json({ password: pw, strength: V.strength(pw) });
});

app.get('/totp', requireUnlock, (req, res) => {
  try { res.json({ success: true, ...V.totp(req.query.secret || '') }); }
  catch (e) { res.json({ success: false, error: e.message }); }
});

app.get('/settings', requireUnlock, (req, res) => res.json(V.getData().settings));
app.post('/settings', requireUnlock, (req, res) => {
  V.getData().settings = { ...V.getData().settings, ...(req.body || {}) };
  try { V.persist(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/logs', requireUnlock, (req, res) => res.json({ logs: V.getData().logs }));

app.get('/export', requireUnlock, (req, res) => res.json({ credentials: V.getData().credentials }));
app.post('/import', requireUnlock, (req, res) => {
  const incoming = Array.isArray(req.body?.credentials) ? req.body.credentials : [];
  const d = V.getData();
  let added = 0;
  incoming.forEach(c => {
    if (!d.credentials.some(e => e.website === c.website && e.username === c.username)) {
      d.credentials.push({ ...c, id: c.id || uuid() }); added++;
    }
  });
  try { V.persist(); res.json({ success: true, added }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔥 NICOFIRE vault API on 0.0.0.0:${PORT}`);
  console.log(`   UI: http://localhost:${PORT}`);
  console.log(`   Vault dir: ${process.env.VAULT_DIR || '~/.nicofire'}`);
});
