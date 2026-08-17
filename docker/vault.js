// vault.js — NICOFIRE vault crypto + logic (Node built-in crypto only)
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VAULT_DIR = process.env.VAULT_DIR
  || path.join(process.env.HOME || process.env.USERPROFILE || '/root', '.nicofire');
const VAULT_PATH = path.join(VAULT_DIR, 'vault.json');

const PBKDF2_ITER = 100_000;
const KEY_LEN = 32, IV_LEN = 12;
const MAGIC = 'NICOFIRE_VALID';

let derivedKey = null;
let cache = null;              // decrypted VaultData while unlocked
let autoLockTimer = null;

// ── Crypto ────────────────────────────────────────────────────────────────────
function pbkdf2(pw, saltB64) {
  return new Promise((res, rej) => {
    crypto.pbkdf2(pw, Buffer.from(saltB64, 'base64'), PBKDF2_ITER, KEY_LEN, 'sha256',
      (e, k) => e ? rej(e) : res(k));
  });
}
function enc(key, plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return { iv: iv.toString('base64'), data: data.toString('base64'), tag: c.getAuthTag().toString('base64') };
}
function dec(key, blk) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blk.iv, 'base64'));
  d.setAuthTag(Buffer.from(blk.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blk.data, 'base64')), d.final()]).toString('utf8');
}

// ── Auto-lock ─────────────────────────────────────────────────────────────────
function resetAutoLock() {
  clearTimeout(autoLockTimer);
  const mins = (cache?.settings?.auto_lock_mins) ?? 5;
  if (mins > 0) autoLockTimer = setTimeout(lock, mins * 60_000);
}

// ── Vault lifecycle ─────────────────────────────────────────────────────────────
function exists() { return fs.existsSync(VAULT_PATH); }
function isUnlocked() { return derivedKey !== null; }

async function unlock(pw) {
  if (!exists()) {
    const salt = crypto.randomBytes(32).toString('base64');
    const key = await pbkdf2(pw, salt);
    const data = defaultData();
    const vf = { salt, verifier: enc(key, MAGIC), data: enc(key, JSON.stringify(data)) };
    fs.mkdirSync(VAULT_DIR, { recursive: true });
    fs.writeFileSync(VAULT_PATH, JSON.stringify(vf, null, 2));
    derivedKey = key; cache = data; resetAutoLock();
    return true;
  }
  const vf = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  const key = await pbkdf2(pw, vf.salt);
  try { if (dec(key, vf.verifier) !== MAGIC) return false; }
  catch { return false; }
  cache = JSON.parse(dec(key, vf.data));
  if (!cache.settings) cache.settings = defaultData().settings;
  derivedKey = key; resetAutoLock();
  return true;
}

function lock() {
  if (derivedKey) derivedKey.fill(0);
  derivedKey = null; cache = null;
  clearTimeout(autoLockTimer);
}

function persist() {
  if (!derivedKey || !cache) throw new Error('Vault locked');
  const vf = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  vf.data = enc(derivedKey, JSON.stringify(cache));
  const tmp = VAULT_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(vf, null, 2));
  fs.renameSync(tmp, VAULT_PATH);
}

async function changePassword(oldPw, newPw) {
  if (!await unlock(oldPw)) return false;
  const data = cache;
  const vf = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
  const newKey = await pbkdf2(newPw, vf.salt);
  vf.verifier = enc(newKey, MAGIC);
  vf.data = enc(newKey, JSON.stringify(data));
  fs.writeFileSync(VAULT_PATH, JSON.stringify(vf, null, 2));
  derivedKey = newKey;
  return true;
}

// ── Data helpers ────────────────────────────────────────────────────────────────
function defaultData() {
  return { credentials: [], logs: [], settings: { auto_lock_mins: 5, clip_clear_secs: 20, theme: 'dark' } };
}
function getData() { if (!cache) throw new Error('Vault locked'); resetAutoLock(); return cache; }
function log(level, ctx, msg) {
  if (!cache) return;
  cache.logs.push({ ts: Date.now(), level, context: ctx, message: msg });
  if (cache.logs.length > 500) cache.logs.shift();
}

// ── Health audit ─────────────────────────────────────────────────────────────────
function strength(pw) {
  let s = 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++; if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}
function health() {
  const creds = cache?.credentials || [];
  const total = creds.length;
  const weak = [], reused = [], old = [];
  const seen = {};
  creds.forEach(c => { (seen[c.password] = seen[c.password] || []).push(c.id); });
  Object.values(seen).forEach(ids => { if (ids.length > 1) ids.forEach(id => reused.push(id)); });
  const now = Date.now();
  creds.forEach(c => {
    if (strength(c.password) < 3) weak.push(c.id);
    const upd = Date.parse(c.updated_at || c.created_at || 0);
    if (upd && (now - upd) > 365 * 864e5) old.push(c.id);
  });
  let score = 100;
  if (total > 0) {
    const issues = weak.length + reused.length + old.length;
    const max = total * 3;
    score = Math.round(100 - (Math.min(issues, max) * 100 / max));
  }
  return { score, total, weak, reused, old };
}

// ── Password generator ────────────────────────────────────────────────────────────
function genPassword(length = 20, upper = true, lower = true, digits = true, symbols = true) {
  let cs = '';
  if (lower) cs += 'abcdefghijkmnopqrstuvwxyz';
  if (upper) cs += 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  if (digits) cs += '23456789';
  if (symbols) cs += '!@#$%^&*()-_=+[]{};:,.?';
  if (!cs) cs = 'abcdefghijklmnopqrstuvwxyz';
  const target = Math.max(4, length);
  let out = '';
  // Rejection sampling to avoid modulo bias, but keep drawing until full length
  const limit = 256 - (256 % cs.length);
  while (out.length < target) {
    const buf = crypto.randomBytes(target * 2);
    for (let i = 0; i < buf.length && out.length < target; i++) {
      if (buf[i] < limit) out += cs[buf[i] % cs.length];
    }
  }
  return out;
}

// ── TOTP (RFC 6238) ────────────────────────────────────────────────────────────────
function base32Decode(s) {
  const alph = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = s.replace(/[\s=]/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const idx = alph.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret) {
  const key = base32Decode(secret);
  if (!key.length) throw new Error('Empty secret');
  const period = 30;
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);
  const remaining = period - (now % period);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const bin = ((hmac[off] & 0x7f) << 24) | (hmac[off + 1] << 16) | (hmac[off + 2] << 8) | hmac[off + 3];
  return { code: String(bin % 1_000_000).padStart(6, '0'), remaining };
}

module.exports = {
  exists, isUnlocked, unlock, lock, persist, changePassword,
  getData, log, health, strength, genPassword, totp,
};
