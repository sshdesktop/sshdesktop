#!/usr/bin/env node
/**
 * SSH Desktop - All-in-One Standalone Web Server & Remote SSH Management Engine
 * Frontend Port: 2222 | Backend Port: 2020
 *
 * Full SSH2 Backend: Remote Shell (PTY), SFTP, Telemetry, Services, Docker,
 * Packages, Firewall, Users, Cron, Disk, System Monitor, and Storage Persistence.
 *
 * Copyright 2026 SSH Desktop Contributors
 * Licensed under the Apache License, Version 2.0
 */

import http from 'http';
import https from 'https';
import tls from 'tls';
import net from 'net';
import zlib from 'zlib';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import child_process from 'child_process';
import util from 'util';
import { fileURLToPath } from 'url';
import { Client } from 'ssh2';
import { WebSocketServer, WebSocket } from 'ws';
import { EMBEDDED_FILES } from './embedded-dist.js';

const currentFile = typeof __filename !== 'undefined' ? __filename : (typeof process !== 'undefined' && process.argv ? process.argv[1] : process.cwd());
const currentDir = typeof __dirname !== 'undefined' ? __dirname : (currentFile ? path.dirname(currentFile) : process.cwd());

const VERSION = '2.4.2';

// Instant CLI Argument Checks (--version, -v, --help, -h)
// Prevents standalone SEA binaries from starting long-running server during verification
const cliArgs = process.argv.slice(2);
if (cliArgs.includes('--version') || cliArgs.includes('-v')) {
  console.log(`sshdesktop ${VERSION}`);
  process.exit(0);
}
if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
  console.log(`
SSH Desktop - All-in-One Standalone Web Server & Remote SSH Engine
Version: ${VERSION}
Usage: sshdesktop [options]

Options:
  -v, --version         Show version number (${VERSION})
  -h, --help            Show this help manual
  --host <host>         Frontend bind address (default: 0.0.0.0)
  --backend-host <host> Backend bind address (default: 127.0.0.1)
  --port <port>         Frontend web desktop port (default: 2222)
  --backend-port <port> Backend API port (default: 2020)
  --data-dir <path>     Directory for secure local storage
`);
  process.exit(0);
}

function getCliArg(flag) {
  const idx = cliArgs.indexOf(flag);
  if (idx !== -1 && idx + 1 < cliArgs.length) return cliArgs[idx + 1];
  const prefix = flag + '=';
  const eq = cliArgs.find(a => a.startsWith(prefix));
  if (eq) return eq.slice(prefix.length);
  return null;
}

// Port Configuration: Frontend on 2222 (public/bind), Backend on 2020 (localhost private)
const FRONTEND_PORT = parseInt(
  getCliArg('--port') || process.env.FRONTEND_PORT || process.env.PORT || '2222',
  10
);

const BACKEND_PORT = parseInt(
  getCliArg('--backend-port') || process.env.BACKEND_PORT || '2020',
  10
);

const HOST = getCliArg('--host') || process.env.HOST || '0.0.0.0';

const BACKEND_HOST =
  getCliArg('--backend-host') ||
  process.env.BACKEND_HOST ||
  '127.0.0.1';

// Locate dist directory (supports raw development, external override, and packaged binary layouts)
let DIST_DIR = path.join(currentDir, 'dist');
if (!fs.existsSync(DIST_DIR)) {
  const altDist = path.join(process.cwd(), 'dist');
  if (fs.existsSync(altDist)) {
    DIST_DIR = altDist;
  } else if (process.execPath) {
    const binDist = path.join(path.dirname(process.execPath), 'dist');
    if (fs.existsSync(binDist)) {
      DIST_DIR = binDist;
    }
  }
}

// Safe & Secure Persistent Storage Resolution (Owner-only: 0700)
function resolveSafeDataDir() {
  const cliDir = getCliArg('--data-dir');
  if (cliDir) return path.resolve(cliDir);

  if (process.env.SSHDESKTOP_DATA_DIR) {
    return path.resolve(process.env.SSHDESKTOP_DATA_DIR);
  }

  const platform = os.platform();
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  if (platform === 'linux') {
    if (isRoot) {
      try {
        const varLib = '/var/lib/sshdesktop';
        if (!fs.existsSync(varLib)) fs.mkdirSync(varLib, { recursive: true, mode: 0o700 });
        return varLib;
      } catch {}
    }
    // Standard Linux user: XDG Base Directory specification (~/.local/share/sshdesktop)
    // Prevents storing credentials in world-readable /home root
    const xdgData = process.env.XDG_DATA_HOME || path.join(os.homedir() || '/root', '.local', 'share');
    return path.join(xdgData, 'sshdesktop');
  }

  if (platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || (process.env.APPDATA ? path.join(process.env.APPDATA, '..', 'Local') : null);
    if (localApp) {
      return path.join(localApp, 'sshdesktop');
    }
  }

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'sshdesktop');
  }

  return path.join(os.homedir() || '.', '.sshdesktop');
}

const DATA_DIR = resolveSafeDataDir();
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
  try {
    fs.chmodSync(DATA_DIR, 0o700);
  } catch {}
} catch (e) {
  console.warn('Notice: Could not create secure data directory, using local fallback:', e.message);
}

const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');
const POLICY_FILE = path.join(DATA_DIR, 'policy.json');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');
const TEAM_FILE = path.join(DATA_DIR, 'team.json');
const APPROVALS_FILE = path.join(DATA_DIR, 'approvals.json');
const SSO_FILE = path.join(DATA_DIR, 'sso.json');
const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings');
const VAULT_FILE = path.join(DATA_DIR, 'vault.enc.json');
const VAULT_KEY_FILE = path.join(DATA_DIR, 'vault.key');
const KEYS_DIR = path.join(DATA_DIR, 'keys');
try {
  if (!fs.existsSync(KEYS_DIR)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  }
  try { fs.chmodSync(KEYS_DIR, 0o700); } catch {}
} catch {}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
};

// Global in-memory states
const activeConnections = new Map(); // id -> { client, sftp, config, connectedAt }
const activeTerminals = new Map();   // termId -> { stream, connId, buffer }
const activeWsClients = new Map();   // termId -> WebSocket
const pendingTerminalResizes = new Map(); // termId -> { rows, cols }

// Helper: Safely resolve active SSH connection (strict matching: no cross-server fallback)
function matchKnownHostToken(pattern, host, port) {
  const token = port === 22 ? host : `[${host}]:${port}`;
  if (pattern.startsWith('|1|')) {
    const segments = pattern.slice(3).split('|');
    if (segments.length !== 2) return false;
    try {
      const salt = Buffer.from(segments[0], 'base64');
      const expectedDigest = Buffer.from(segments[1], 'base64');
      if (!salt.length || !expectedDigest.length) return false;
      const digest = crypto.createHmac('sha1', salt).update(token, 'utf8').digest();
      return digest.length === expectedDigest.length && crypto.timingSafeEqual(digest, expectedDigest);
    } catch {
      return false;
    }
  }
  const wildcardToRegex = (glob) => {
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`);
  };
  if (pattern.includes('*') || pattern.includes('?')) {
    return wildcardToRegex(pattern).test(token) || (port === 22 && wildcardToRegex(pattern).test(host));
  }
  return pattern === token || (port === 22 && pattern === host);
}

function knownHostFieldMatches(hostField, host, port) {
  let matched = false;
  for (const raw of String(hostField || '').split(',')) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith('!')) {
      if (matchKnownHostToken(entry.slice(1), host, port)) return false;
    } else if (matchKnownHostToken(entry, host, port)) {
      matched = true;
    }
  }
  return matched;
}

function formatSshFingerprint(keyB64) {
  if (!keyB64) return '';
  return 'SHA256:' + crypto.createHash('sha256').update(Buffer.from(keyB64, 'base64')).digest('base64').replace(/=+$/, '');
}

/**
 * Evaluate OpenSSH known_hosts content with @revoked, @cert-authority, and |1| HMAC-SHA1 support.
 */
function evaluateKnownHostsContent(content, host, port, keyType, keyB64) {
  const fp = formatSshFingerprint(keyB64);
  const regularMatches = [];
  let sawCertAuthority = false;

  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === '@revoked' && parts.length >= 4) {
      if (knownHostFieldMatches(parts[1], host, port) && parts[2] === keyType && parts[3] === keyB64) {
        return {
          status: 'changed',
          key_type: keyType,
          fingerprint_sha256: fp,
          raw_public_key_b64: keyB64,
          known_key_type: parts[2],
          known_fingerprint_sha256: formatSshFingerprint(parts[3]),
          message: 'CRITICAL SECURITY ALERT: Server presented a REVOKED SSH host key (@revoked)!',
        };
      }
      continue;
    }
    if (parts[0] === '@cert-authority' && parts.length >= 4) {
      if (knownHostFieldMatches(parts[1], host, port)) sawCertAuthority = true;
      continue;
    }
    if (!parts[0]?.startsWith('@') && parts.length >= 3 && knownHostFieldMatches(parts[0], host, port)) {
      regularMatches.push({ keyType: parts[1], keyB64: parts[2] });
    }
  }

  if (regularMatches.some(m => m.keyType === keyType && m.keyB64 === keyB64)) {
    return {
      status: 'trusted',
      key_type: keyType,
      fingerprint_sha256: fp,
      raw_public_key_b64: keyB64,
      message: 'Host key verified against known_hosts.',
    };
  }
  if (regularMatches.length > 0) {
    const firstKnown = regularMatches[0];
    return {
      status: 'changed',
      key_type: keyType,
      fingerprint_sha256: fp,
      raw_public_key_b64: keyB64,
      known_key_type: firstKnown.keyType || '',
      known_fingerprint_sha256: formatSshFingerprint(firstKnown.keyB64),
      message: 'WARNING: Remote SSH host key changed from previously trusted key!',
    };
  }
  if (sawCertAuthority) {
    return {
      status: 'unsupported_cert_authority',
      key_type: keyType,
      fingerprint_sha256: fp,
      raw_public_key_b64: keyB64,
      message: 'known_hosts contains @cert-authority for this host, which requires explicit SSH certificate verification or pinning the concrete host key.',
    };
  }
  return {
    status: 'not_found',
    key_type: keyType,
    fingerprint_sha256: fp,
    raw_public_key_b64: keyB64,
    message: 'Host key is not yet recorded in known_hosts.',
  };
}

function sendTerminalOutput(termId, text) {
  const ws = activeWsClients.get(termId);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  // Never let a slow WebSocket client cause unbounded terminal-output buffering.
  if (ws.bufferedAmount > 1024 * 1024) {
    try { ws.close(1013, 'Terminal client is too slow; reconnect to resume output'); } catch {}
    if (activeWsClients.get(termId) === ws) activeWsClients.delete(termId);
    return;
  }
  try { ws.send(JSON.stringify({ type: 'output', text })); }
  catch (error) {
    console.warn('[SSH Desktop] Failed to send terminal output:', error.message);
    try { ws.close(1011, 'Terminal output transport failed'); } catch {}
    if (activeWsClients.get(termId) === ws) activeWsClients.delete(termId);
  }
}

function getActiveEntry(connId) {
  if (connId) {
    return activeConnections.get(connId) || null;
  }
  // Only if connId was omitted entirely and there is exactly one active connection
  if (activeConnections.size === 1) {
    return activeConnections.values().next().value;
  }
  return null;
}

// Helper: Read JSON from file
function readJsonSafe(filePath, fallback = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.warn(`Failed reading JSON from ${filePath}:`, err.message);
  }
  return fallback;
}

// Helper: Write JSON to file atomically with strict permissions
function writeJsonSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch {}
    }
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(tempPath, 0o600); } catch {}
    fs.renameSync(tempPath, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch {}
    return true;
  } catch (err) {
    console.warn(`Failed writing JSON to ${filePath}:`, err.message);
    return false;
  }
}

function getOrCreateVaultKey() {
  if (fs.existsSync(VAULT_KEY_FILE)) {
    const raw = fs.readFileSync(VAULT_KEY_FILE, 'utf8').trim();
    const buf = Buffer.from(raw, 'hex');
    if (buf.length === 32) return buf;
  }
  const key = crypto.randomBytes(32);
  const dir = path.dirname(VAULT_KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = `${VAULT_KEY_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempPath, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tempPath, 0o600); } catch {}
  fs.renameSync(tempPath, VAULT_KEY_FILE);
  try { fs.chmodSync(VAULT_KEY_FILE, 0o600); } catch {}
  return key;
}

function validateVaultKeyName(keyName) {
  const trimmed = String(keyName || '').trim();
  if (!trimmed || trimmed.length > 256) {
    throw new Error('Secret identifier must be between 1 and 256 characters.');
  }
  if (!trimmed.startsWith('db-profile:') && !trimmed.startsWith('docker-registry:')) {
    throw new Error("Secret identifier must use the 'db-profile:' or 'docker-registry:' namespace.");
  }
  if (!/^[a-zA-Z0-9:._-]+$/.test(trimmed)) {
    throw new Error('Secret identifier contains disallowed characters.');
  }
  return trimmed;
}

function vaultEncryptValue(plaintext) {
  const masterKey = getOrCreateVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('hex'),
  };
}

function vaultDecryptValue(record) {
  if (!record || typeof record !== 'object') return null;
  const masterKey = getOrCreateVaultKey();
  const iv = Buffer.from(String(record.iv || ''), 'hex');
  const tag = Buffer.from(String(record.tag || ''), 'hex');
  const data = Buffer.from(String(record.data || ''), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function vaultRotateKey() {
  const existingVault = readJsonSafe(VAULT_FILE, {});
  const decryptedEntries = {};
  let count = 0;
  for (const [k, encRecord] of Object.entries(existingVault || {})) {
    const plain = vaultDecryptValue(encRecord);
    if (plain !== null) {
      decryptedEntries[k] = plain;
      count += 1;
    }
  }
  const newKey = crypto.randomBytes(32);
  const dir = path.dirname(VAULT_KEY_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempKeyPath = `${VAULT_KEY_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempKeyPath, newKey.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tempKeyPath, 0o600); } catch {}

  const reencryptedVault = {};
  for (const [k, plain] of Object.entries(decryptedEntries)) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', newKey, iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    reencryptedVault[k] = {
      v: 1,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: enc.toString('hex'),
    };
  }
  const tempVaultPath = `${VAULT_FILE}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tempVaultPath, JSON.stringify(reencryptedVault, null, 2), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(tempVaultPath, 0o600); } catch {}
  fs.renameSync(tempVaultPath, VAULT_FILE);
  fs.renameSync(tempKeyPath, VAULT_KEY_FILE);
  try { fs.chmodSync(VAULT_FILE, 0o600); } catch {}
  try { fs.chmodSync(VAULT_KEY_FILE, 0o600); } catch {}
  return { rotated: true, entriesReencrypted: count };
}

// -------------------------------------------------------------
// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) & Scoped API Tokens
// -------------------------------------------------------------

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let out = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      out += BASE32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }
  if (bitsLeft > 0) {
    out += BASE32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').replace(/[\s=]+/g, '').toUpperCase();
  if (!clean) return null;
  let buffer = 0;
  let bitsLeft = 0;
  const bytes = [];
  for (const ch of clean) {
    const val = BASE32_ALPHABET.indexOf(ch);
    if (val === -1) return null;
    buffer = (buffer << 5) | val;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      bytes.push((buffer >> bitsLeft) & 0xff);
    }
  }
  return bytes.length ? Buffer.from(bytes) : null;
}

function computeTotpAt(secretBuf, unixSecs) {
  const counter = BigInt(Math.floor(Number(unixSecs) / 30));
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(counter, 0);
  const hmac = crypto.createHmac('sha1', secretBuf).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(binary % 1000000).padStart(6, '0');
}

function verifyTotpCode(secretBase32, code, nowSecs = Math.floor(Date.now() / 1000)) {
  const cleanCode = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const secretBuf = base32Decode(secretBase32);
  if (!secretBuf || !secretBuf.length) return false;
  const codeBuf = Buffer.from(cleanCode, 'utf8');
  for (const delta of [-30, 0, 30]) {
    const candidate = Buffer.from(computeTotpAt(secretBuf, nowSecs + delta), 'utf8');
    if (candidate.length === codeBuf.length && crypto.timingSafeEqual(candidate, codeBuf)) {
      return true;
    }
  }
  return false;
}

function loadTokensRaw() {
  const data = readJsonSafe(TOKENS_FILE, []);
  return Array.isArray(data) ? data : [];
}

function saveTokensRaw(tokens) {
  return writeJsonSafe(TOKENS_FILE, tokens);
}

function resolveApiToken(rawToken) {
  const tok = String(rawToken || '').trim();
  if (!tok.startsWith('sshdesktop_tok_')) return null;
  const tokenHash = crypto.createHash('sha256').update(tok, 'utf8').digest('hex');
  const tokens = loadTokensRaw();
  const now = Date.now();
  for (const record of tokens) {
    if (!record || record.revoked) continue;
    if (record.expiresAt && Date.parse(record.expiresAt) <= now) continue;
    if (typeof record.tokenHash === 'string' && record.tokenHash.length === tokenHash.length) {
      try {
        if (crypto.timingSafeEqual(Buffer.from(record.tokenHash, 'hex'), Buffer.from(tokenHash, 'hex'))) {
          return {
            username: `api-token:${record.name}`,
            role: record.role || 'read_only',
            tokenId: record.id,
            isApiToken: true,
          };
        }
      } catch {}
    }
  }
  return null;
}

// -------------------------------------------------------------
// Secure First-Run Authentication
// -------------------------------------------------------------

const scryptAsync = util.promisify(crypto.scrypt);

async function hashPasswordAsync(password, salt = crypto.randomBytes(16).toString('hex')) {
  const buf = await scryptAsync(password, salt, 64);
  return {
    password_salt: salt,
    password_hash: buf.toString('hex')
  };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {
    password_salt: salt,
    password_hash: hash
  };
}

async function verifyPasswordAsync(auth, password) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 1024) {
    return false;
  }
  if (auth.password_hash && auth.password_salt) {
    const calculated = await scryptAsync(password, auth.password_salt, 64);
    const stored = Buffer.from(auth.password_hash, 'hex');
    return stored.length === calculated.length && crypto.timingSafeEqual(stored, calculated);
  }
  if (typeof auth.password === 'string') {
    const supplied = Buffer.from(password);
    const stored = Buffer.from(auth.password);
    return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
  }
  return false;
}

function verifyPassword(auth, password) {
  if (typeof password !== 'string' || !password) {
    return false;
  }

  // New password format: scrypt hash.
  if (auth.password_hash && auth.password_salt) {
    const calculated = crypto.scryptSync(
      password,
      auth.password_salt,
      64
    );

    const stored = Buffer.from(auth.password_hash, 'hex');

    return stored.length === calculated.length &&
      crypto.timingSafeEqual(stored, calculated);
  }

  // Legacy password migration support.
  if (typeof auth.password === 'string') {
    const supplied = Buffer.from(password);
    const stored = Buffer.from(auth.password);
    return supplied.length === stored.length && crypto.timingSafeEqual(supplied, stored);
  }

  return false;
}

function initializeAuthentication() {
  let auth = null;
  if (fs.existsSync(AUTH_FILE)) {
    // Never interpret an unreadable or malformed existing credential file as
    // a first-run installation: doing so would silently replace valid access.
    let raw;
    try {
      raw = fs.readFileSync(AUTH_FILE, 'utf8');
      auth = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Authentication file ${AUTH_FILE} is unreadable or invalid; refusing to reset credentials: ${err.message}`);
    }
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
      throw new Error(`Authentication file ${AUTH_FILE} has an invalid structure; refusing to reset credentials.`);
    }
  }

  const isValidHashedAuth =
    auth &&
    typeof auth.username === 'string' && auth.username.length > 0 &&
    typeof auth.password_hash === 'string' && auth.password_hash.length > 0 &&
    typeof auth.password_salt === 'string' && auth.password_salt.length > 0;

  if (isValidHashedAuth) {
    return;
  }

  // Support only the known legacy plaintext format for migration. Any other
  // existing credential file is treated as corruption, not first-run state.
  if (auth && !(typeof auth.username === 'string' && auth.username.length > 0 &&
      typeof auth.password === 'string' && auth.password.length > 0)) {
    throw new Error(`Authentication file ${AUTH_FILE} is incomplete; refusing to reset credentials.`);
  }

  let initialPassword;

  if (auth && auth.username && auth.password &&
      auth.password !== 'sshdesktop') {
    // Preserve an existing custom password while migrating it.
    initialPassword = auth.password;
  } else {
    // Generate a new random password for a fresh installation,
    // or rotate the old insecure default password.
    initialPassword = crypto.randomBytes(24).toString('base64url');
  }

  const username = auth?.username || 'admin';

  const hashed = hashPassword(initialPassword);

  const newAuth = {
    username,
    ...hashed,
    must_change_password: true
  };

  if (!writeJsonSafe(AUTH_FILE, newAuth)) {
    throw new Error('Unable to initialize SSH Desktop authentication.');
  }

  const credentialsFile = path.join(
    DATA_DIR,
    'initial-admin-credentials.txt'
  );

  fs.writeFileSync(
    credentialsFile,
    `SSH Desktop Initial Login\nUsername: ${username}\nPassword: ${initialPassword}\nChange this password immediately after login.\n`,
    { encoding: 'utf8', mode: 0o600 }
  );

  try { fs.chmodSync(credentialsFile, 0o600); } catch {}

  // On Linux, mirror to /var/lib/sshdesktop/initial-admin-credentials.txt if accessible
  if (process.platform === 'linux' && DATA_DIR !== '/var/lib/sshdesktop') {
    try {
      const varLibDir = '/var/lib/sshdesktop';
      if (!fs.existsSync(varLibDir)) {
        fs.mkdirSync(varLibDir, { recursive: true, mode: 0o700 });
      }
      const varLibFile = path.join(varLibDir, 'initial-admin-credentials.txt');
      fs.writeFileSync(
        varLibFile,
        `SSH Desktop Initial Login\nUsername: ${username}\nPassword: ${initialPassword}\nChange this password immediately after login.\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
      try { fs.chmodSync(varLibFile, 0o600); } catch {}
    } catch {}
  }

  console.log(
    `[SSH Desktop] Initial credentials saved to: ${credentialsFile}`
  );
}

initializeAuthentication();

// -------------------------------------------------------------
// 1-Hour Session Management Engine (Website Security)
// -------------------------------------------------------------
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour session expiration (3600 seconds)
const activeSessions = new Map(); // token -> { token, username, createdAt, expiresAt }
const hashedSessions = new Map(); // tokenHash -> { username, createdAt, expiresAt }

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function loadSessions() {
  try {
    const saved = readJsonSafe(SESSIONS_FILE, {});
    const now = Date.now();
    for (const [key, sess] of Object.entries(saved)) {
      if (sess && sess.expiresAt && sess.expiresAt > now) {
        if (sess.token) {
          activeSessions.set(sess.token, sess);
        } else {
          hashedSessions.set(key, sess);
        }
      }
    }
  } catch {}
}
loadSessions();

function persistSessions() {
  const obj = {};
  const now = Date.now();
  for (const [token, sess] of activeSessions.entries()) {
    if (sess.expiresAt > now) {
      const h = hashToken(token);
      obj[h] = { username: sess.username, createdAt: sess.createdAt, expiresAt: sess.expiresAt, tokenHash: h };
    }
  }
  for (const [h, sess] of hashedSessions.entries()) {
    if (sess.expiresAt > now && !obj[h]) {
      obj[h] = sess;
    }
  }
  writeJsonSafe(SESSIONS_FILE, obj);
}

function createSession(username, role = 'admin') {
  const token = 'sshsess_' + crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    username,
    role,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  activeSessions.set(token, session);
  persistSessions();
  return session;
}

function getSession(token) {
  if (!token || typeof token !== 'string') return null;
  let session = activeSessions.get(token);
  if (!session) {
    const h = hashToken(token);
    const hashed = hashedSessions.get(h);
    if (hashed) {
      session = { token, username: hashed.username, createdAt: hashed.createdAt, expiresAt: hashed.expiresAt };
      activeSessions.set(token, session);
    }
  }
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    destroySession(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  if (!token) return false;
  activeSessions.delete(token);
  hashedSessions.delete(hashToken(token));

  // Revoke long-lived transports as well as the HTTP bearer token.
  for (const [termId, ws] of activeWsClients.entries()) {
    if (ws && ws.authToken === token) {
      try { ws.close(1008, 'Authentication session expired or was revoked'); } catch {}
      if (activeWsClients.get(termId) === ws) activeWsClients.delete(termId);
    }
  }
  if (typeof browserSessionRegistry !== 'undefined') {
    for (const [sessionId, gatewaySession] of browserSessionRegistry.entries()) {
      if (gatewaySession && gatewaySession.authToken === token) {
        for (const gatewaySocket of gatewaySession.sockets || []) {
          try { gatewaySocket.destroy(); } catch {}
        }
        browserSessionRegistry.delete(sessionId);
      }
    }
  }
  persistSessions();
  return true;
}

function extractSessionToken(req, payload) {
  const hToken = req?.headers?.['x-session-token'];
  if (hToken) return String(hToken).trim();

  const authHeader = req?.headers?.['authorization'];
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.substring(7).trim();
  }

  if (payload?.sessionToken) return String(payload.sessionToken).trim();
  if (payload?.token) return String(payload.token).trim();
  if (payload?.args?.sessionToken) return String(payload.args.sessionToken).trim();
  if (payload?.args?.token) return String(payload.args.token).trim();

  if (req?.headers?.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)sshdesktop_session=([^;]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]).trim(); }
      catch { return null; }
    }
  }
  return null;
}

// In-memory brute-force protection with memory leak prevention
const loginAttempts = new Map(); // ip -> { count, lastAttempt, lockedUntil }
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.lastAttempt > 300000 && record.lockedUntil <= now) {
      loginAttempts.delete(ip);
    }
  }
}, 60 * 1000).unref?.();

function getClientIp(req) {
  const remote = req?.socket?.remoteAddress || '127.0.0.1';
  const normalizedRemote = remote.startsWith('::ffff:') ? remote.slice(7) : remote;
  // The frontend proxy overwrites this private header. Trust it only when the
  // backend connection itself comes from loopback; never trust public XFF.
  if (normalizedRemote === '127.0.0.1' || normalizedRemote === '::1') {
    const forwarded = req?.headers?.['x-sshdesktop-client-ip'];
    if (typeof forwarded === 'string' && net.isIP(forwarded)) return forwarded;
  }
  return remote;
}

// Background session pruner (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, sess] of activeSessions.entries()) {
    if (!sess || sess.expiresAt <= now) {
      destroySession(token);
      changed = true;
    }
  }
  if (changed) persistSessions();
}, 60 * 1000).unref?.();

// Helper: Format bytes to human readable
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: Format octal file permissions
function formatPermissions(mode) {
  const isDir = (mode & 0o040000) !== 0;
  const isLink = (mode & 0o120000) === 0o120000;
  let type = isDir ? 'd' : isLink ? 'l' : '-';
  const rwx = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const u = rwx[(mode >> 6) & 7];
  const g = rwx[(mode >> 3) & 7];
  const o = rwx[mode & 7];
  return type + u + g + o;
}

// Get or initialize SFTP session on connection
function getSftp(client) {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

function shellQuote(val) {
  return `'${String(val ?? '').replace(/'/g, "'\\''")}'`;
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateInt(val, min, max, label) {
  const num = Number(val);
  if (!Number.isInteger(num) || num < min || num > max) {
    throw new Error(`Invalid ${label}: expected integer between ${min} and ${max}`);
  }
  return num;
}

function validateSafeToken(val, pattern, label) {
  const str = String(val ?? '').trim();
  if (!str || !pattern.test(str)) {
    throw new Error(`Invalid ${label}`);
  }
  return str;
}

function computeAuditEntryHash(prevHash, payloadWithoutHash) {
  return crypto
    .createHash('sha256')
    .update(`${prevHash}|${JSON.stringify(payloadWithoutHash)}`)
    .digest('hex');
}

function getLastAuditHash() {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return '0'.repeat(64);
    const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length === 0) return '0'.repeat(64);
    const last = JSON.parse(lines[lines.length - 1]);
    return typeof last.hash === 'string' && last.hash.length === 64 ? last.hash : '0'.repeat(64);
  } catch {
    return '0'.repeat(64);
  }
}

function appendAuditEvent(event) {
  try {
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      const st = fs.statSync(AUDIT_LOG_FILE);
      if (st.size > 10 * 1024 * 1024) {
        try { fs.renameSync(AUDIT_LOG_FILE, `${AUDIT_LOG_FILE}.1`); } catch {}
      }
    }
    const prev_hash = getLastAuditHash();
    const base = {
      ts: new Date().toISOString(),
      ...event
    };
    const hash = computeAuditEntryHash(prev_hash, base);
    const entry = JSON.stringify({ ...base, prev_hash, hash }) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, entry, { encoding: 'utf8', mode: 0o600 });
  } catch {}
}

function verifyAuditChain() {
  if (!fs.existsSync(AUDIT_LOG_FILE)) {
    return { valid: true, total: 0, verified: 0, brokenAt: null };
  }
  const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  let expectedPrev = '0'.repeat(64);
  let verified = 0;
  for (let i = 0; i < lines.length; i++) {
    let parsed;
    try { parsed = JSON.parse(lines[i]); } catch {
      return { valid: false, total: lines.length, verified, brokenAt: i + 1, reason: 'Malformed JSON audit record' };
    }
    const { prev_hash, hash, ...rest } = parsed;
    if (!hash || !prev_hash) {
      // Legacy unchained record written prior to chain upgrade: reset chain baseline if valid JSON
      expectedPrev = '0'.repeat(64);
      verified += 1;
      continue;
    }
    if (prev_hash !== expectedPrev) {
      return { valid: false, total: lines.length, verified, brokenAt: i + 1, reason: 'Previous hash mismatch' };
    }
    const calc = computeAuditEntryHash(prev_hash, rest);
    if (calc !== hash) {
      return { valid: false, total: lines.length, verified, brokenAt: i + 1, reason: 'Entry hash tamper detected' };
    }
    expectedPrev = hash;
    verified += 1;
  }
  return { valid: true, total: lines.length, verified, brokenAt: null };
}

function getSecurityPolicy() {
  const policy = readJsonSafe(POLICY_FILE, { role: 'admin', blockMetadataEgress: true });
  const role = ['admin', 'operator', 'read_only'].includes(policy.role) ? policy.role : 'admin';
  return {
    role,
    blockMetadataEgress: policy.blockMetadataEgress !== false,
    updatedAt: policy.updatedAt || null,
    updatedBy: policy.updatedBy || null,
  };
}

function enforcePolicyPermission(cmd, args, currentSession = null) {
  const policy = getSecurityPolicy();
  const roleRank = { read_only: 0, operator: 1, admin: 2 };
  const policyRole = policy.role || 'admin';
  const sessionRole = currentSession?.role;
  const effectiveRole = (sessionRole && roleRank[sessionRole] !== undefined && roleRank[sessionRole] < (roleRank[policyRole] ?? 2))
    ? sessionRole
    : policyRole;
  const readOnlyBlocked = new Set([
    'firewall_add_rule', 'firewall_add_rule_advanced', 'firewall_delete_rule', 'firewall_delete_rule_advanced',
    'firewall_toggle', 'firewall_install', 'firewall_set_default_policy', 'firewall_reset',
    'user_create', 'user_delete', 'user_modify', 'user_lock', 'user_sudo_toggle', 'group_add_user',
    'disk_create_label', 'disk_create_partition', 'disk_delete_partition', 'disk_resize_partition',
    'disk_set_partition_flag', 'disk_format_filesystem', 'disk_set_label', 'disk_manage_swap', 'disk_manage_tmp',
    'service_action', 'package_install', 'package_remove', 'cron_add', 'cron_delete',
    'sftp_write_file', 'sftp_write_text_file', 'sftp_delete', 'sftp_rename', 'sftp_chmod', 'sftp_chown',
    'sftp_mkdir', 'sftp_extract_archive_pure', 'backup_import_config',
    'tokens_create', 'tokens_revoke', 'vault_rotate_key', 'policy_set_mode',
    'auth_totp_setup', 'auth_totp_enable', 'auth_totp_disable',
    'process_kill', 'process_renice', 'cron_rollback',
    'team_add', 'team_set_role', 'team_remove', 'sso_set_config', 'approval_decide', 'ssh_rotate_server_key'
  ]);
  const operatorBlocked = new Set([
    'firewall_reset', 'firewall_set_default_policy',
    'disk_create_label', 'disk_create_partition', 'disk_delete_partition', 'disk_format_filesystem',
    'user_delete', 'user_sudo_toggle',
    'tokens_create', 'tokens_revoke', 'vault_rotate_key', 'policy_set_mode', 'backup_import_config',
    'auth_totp_setup', 'auth_totp_enable', 'auth_totp_disable',
    'team_add', 'team_set_role', 'team_remove', 'sso_set_config', 'approval_decide'
  ]);
  if (effectiveRole === 'read_only' && readOnlyBlocked.has(cmd)) {
    const err = new Error(`POLICY_DENIED: Command '${cmd}' is blocked while effective role is 'read_only'.`);
    err.statusCode = 403;
    throw err;
  }
  if (effectiveRole === 'operator' && operatorBlocked.has(cmd)) {
    const err = new Error(`POLICY_DENIED: Destructive command '${cmd}' requires 'admin' role (effective role: 'operator').`);
    err.statusCode = 403;
    throw err;
  }
  if (effectiveRole === 'read_only' && cmd === 'ssh_exec' && args?.command) {
    // Allow diagnostic/read inspections; destructive explicit UI actions go through dedicated commands
  }
}

// Execute command: remotely over active SSH connection. Never fallback to host execution!
function runRemoteExec(client, command, timeoutMs = 60000) {
  return runRemoteExecWithStdin(client, command, null, timeoutMs);
}

function runRemoteExecWithStdin(client, command, stdinData = null, timeoutMs = 60000) {
  if (!client) {
    return Promise.resolve({
      stdout: '',
      stderr: 'No active SSH connection available; refusing to execute remote command on host machine.',
      exit_code: -1,
      duration_ms: 0
    });
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let streamRef = null;
    let outputBytes = 0;
    let outputTruncated = false;
    const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
    const TRUNCATION_MARKER = '\n[Output truncated: size limit reached]';

    const timer = setTimeout(() => {
      timedOut = true;
      if (streamRef) {
        try { streamRef.close(); } catch {}
        try { streamRef.destroy(); } catch {}
      }
      resolve({
        stdout,
        stderr: stderr || 'Execution timed out after ' + (timeoutMs / 1000) + 's',
        exit_code: 124,
        duration_ms: Date.now() - startTime
      });
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        return resolve({
          stdout: '',
          stderr: String(err.message || err),
          exit_code: 1,
          duration_ms: Date.now() - startTime
        });
      }

      streamRef = stream;
      if (stdinData !== null && stdinData !== undefined) {
        try {
          stream.write(stdinData);
        } catch {}
        try {
          stream.end();
        } catch {}
      }

      const appendOutput = (which, chunk) => {
        if (outputTruncated) return;
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const remaining = MAX_OUTPUT_BYTES - outputBytes;
        if (data.length <= remaining) {
          if (which === 'stdout') stdout += data.toString('utf8');
          else stderr += data.toString('utf8');
          outputBytes += data.length;
          return;
        }
        const markerBytes = Buffer.byteLength(TRUNCATION_MARKER);
        const contentBudget = Math.max(0, remaining - markerBytes);
        if (contentBudget > 0) {
          const text = data.subarray(0, contentBudget).toString('utf8');
          if (which === 'stdout') stdout += text;
          else stderr += text;
          outputBytes += contentBudget;
        }
        if (remaining >= markerBytes) {
          if (which === 'stdout') stdout += TRUNCATION_MARKER;
          else stderr += TRUNCATION_MARKER;
          outputBytes += markerBytes;
        }
        outputTruncated = true;
        try { stream.close(); } catch {}
      };

      stream.on('data', chunk => appendOutput('stdout', chunk));
      stream.stderr.on('data', chunk => appendOutput('stderr', chunk));
      stream.on('error', err => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr || String(err.message || err), exit_code: -1, duration_ms: Date.now() - startTime });
      });
      stream.stderr.on('error', err => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({ stdout, stderr: stderr || String(err.message || err), exit_code: -1, duration_ms: Date.now() - startTime });
      });
      stream.on('close', code => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({ stdout, stderr, exit_code: typeof code === 'number' ? code : -1, duration_ms: Date.now() - startTime });
      });
    });
  });
}

// Execute privileged command with automatic sudo elevation (mirrors src-tauri run_cmd_priv)
async function runRemotePrivExec(entry, command, timeoutMs = 60000, stdinData = null) {
  if (!command || typeof command !== 'string') {
    return { stdout: '', stderr: '', exit_code: 0, duration_ms: 0 };
  }

  const trimmedCmd = command.trim();
  const normalizedCmd = trimmedCmd.startsWith('sudo ') ? trimmedCmd.slice(5).trim() : trimmedCmd;

  if (!entry || !entry.client) {
    return await runRemoteExec(null, normalizedCmd, timeoutMs);
  }

  const username = entry.config?.username || 'root';

  // 1st Condition: Is the user root?
  if (username === 'root' || (entry.privilege && entry.privilege.is_root)) {
    return await runRemoteExecWithStdin(entry.client, normalizedCmd, stdinData, timeoutMs);
  }

  // 2nd Condition: Passwordless Sudo (sudo -n)
  const escapedRaw = normalizedCmd.replace(/'/g, "'\\''");
  const sudoNCmd = `sudo -n -- sh -c '${escapedRaw}' 2>&1`;
  const nRes = await runRemoteExecWithStdin(entry.client, sudoNCmd, stdinData, timeoutMs);

  if (nRes.exit_code === 0) {
    return nRes;
  }

  // 3rd Condition: Evaluate why sudo -n failed
  const lowerOut = (nRes.stdout + '\n' + nRes.stderr).toLowerCase();

  // 3A. User is NOT in the sudoers file
  if (
    lowerOut.includes('not in the sudoers file') ||
    lowerOut.includes('is not allowed to execute') ||
    lowerOut.includes('not in sudoers')
  ) {
    if (entry.privilege) {
      entry.privilege.has_sudo = false;
      entry.privilege.sudo_type = 'none';
    }
    const msg = `Permission Denied: User '${username}' does not have administrator (sudo) privileges on this server.\n${(nRes.stdout || nRes.stderr).trim()}`;
    return {
      stdout: '',
      stderr: msg,
      exit_code: nRes.exit_code || 126,
      duration_ms: nRes.duration_ms
    };
  }

  // 3B. /usr/bin/sudo SUID permission broken on server
  if (lowerOut.includes('effective uid is not 0') || lowerOut.includes('nosuid')) {
    const msg = `Server Permission Error: /usr/bin/sudo has lost its setuid root permissions on the server.\nFix on your server by running as root:\n  chown root:root /usr/bin/sudo && chmod 4755 /usr/bin/sudo\nOr connect in SSH Desktop as 'root' using your PEM key.`;
    return {
      stdout: '',
      stderr: msg,
      exit_code: nRes.exit_code || 1,
      duration_ms: nRes.duration_ms
    };
  }

  // 3C. User requires password for sudo (sudo -S via SSH channel stdin, never CLI args)
  const pwd = entry.config?.password;
  if (pwd && typeof pwd === 'string' && pwd.length > 0) {
    if (pwd.includes('\n') || pwd.includes('\r')) {
      return {
        stdout: '',
        stderr: 'Refusing sudo elevation: password contains invalid newline characters.',
        exit_code: 1,
        duration_ms: 0
      };
    }
    const sudoSCmd = `sudo -S -p '' -- sh -c '${escapedRaw}' 2>&1`;
    const combinedStdin = stdinData ? `${pwd}\n${stdinData}` : `${pwd}\n`;
    const sRes = await runRemoteExecWithStdin(entry.client, sudoSCmd, combinedStdin, timeoutMs);

    if (sRes.exit_code === 0) {
      return sRes;
    }

    const sLower = (sRes.stdout + '\n' + sRes.stderr).toLowerCase();
    if (sLower.includes('effective uid is not 0') || sLower.includes('nosuid')) {
      const msg = `Server Permission Error: /usr/bin/sudo has lost its setuid root permissions on the server.\nFix on your server by running as root:\n  chown root:root /usr/bin/sudo && chmod 4755 /usr/bin/sudo\nOr connect in SSH Desktop as 'root' using your PEM key.`;
      return {
        stdout: '',
        stderr: msg,
        exit_code: sRes.exit_code || 1,
        duration_ms: sRes.duration_ms
      };
    }

    if (sLower.includes('not in the sudoers file') || sLower.includes('is not allowed to execute')) {
      if (entry.privilege) {
        entry.privilege.has_sudo = false;
        entry.privilege.sudo_type = 'none';
      }
      const msg = `Permission Denied: User '${username}' does not have administrator (sudo) privileges on this server.\n${(sRes.stdout || sRes.stderr).trim()}`;
      return {
        stdout: '',
        stderr: msg,
        exit_code: sRes.exit_code || 1,
        duration_ms: sRes.duration_ms
      };
    }

    if (
      sLower.includes('incorrect password') ||
      sLower.includes('authentication failure') ||
      sLower.includes('sorry, try again')
    ) {
      const msg = `Authentication Failed: Sudo password for user '${username}' was rejected.\n${(sRes.stdout || sRes.stderr).trim()}`;
      return {
        stdout: '',
        stderr: msg,
        exit_code: sRes.exit_code || 1,
        duration_ms: sRes.duration_ms
      };
    }

    return sRes;
  }

  // If user has no password stored and sudo -n required a password
  if (lowerOut.includes('password is required') || lowerOut.includes('terminal is required')) {
    const msg = `Permission Denied: Sudo password required for user '${username}', but no password is saved in session.`;
    return {
      stdout: '',
      stderr: msg,
      exit_code: nRes.exit_code || 1,
      duration_ms: nRes.duration_ms
    };
  }

  return nRes;
}

// -------------------------------------------------------------
// Unified Command Handler (Implements all 70+ Tauri IPC commands)
// -------------------------------------------------------------
// -------------------------------------------------------------
// SOCKS5 Dynamic Proxy Engine (RFC 1928 over SSH2 forwardOut)
// -------------------------------------------------------------
const activeSocksServers = new Map(); // connId -> { server, port }
const activeTunnels = new Map(); // tunnelId -> { server, info: { tunnel_id, conn_id, local_port, remote_host, remote_port, created_at } }

// Helper to accurately detect target Linux distribution package manager
async function detectPkgManager(client) {
  if (!client) return 'apt';
  try {
    const res = await runRemoteExec(client, "command -v dnf yum apt-get pacman zypper apk 2>/dev/null | head -n 1", 5000);
    const out = (res.stdout || '').trim().toLowerCase();
    if (out.includes('dnf')) return 'dnf';
    if (out.includes('yum')) return 'yum';
    if (out.includes('apt') || out.includes('dpkg')) return 'apt';
    if (out.includes('pacman')) return 'pacman';
    if (out.includes('zypper')) return 'zypper';
    if (out.includes('apk')) return 'apk';
  } catch {}
  return 'apt';
}

function buildInstallCommand(pm, rawName) {
  const name = String(rawName || '').trim();
  const lower = name.toLowerCase();

  // 1. MySQL / MariaDB Database Server & Client
  if (lower === 'mysql-server' || lower === 'mysql' || lower === 'mariadb-server' || lower === 'mariadb' || lower === 'mariadb105-server' || lower === 'default-mysql-server') {
    let installCmd = '';
    if (pm === 'dnf') {
      installCmd = "(dnf install -y mysql-server 2>&1 || dnf install -y mariadb105-server 2>&1 || dnf install -y mariadb-server 2>&1 || dnf install -y mariadb 2>&1 || dnf install -y community-mysql-server 2>&1) && (dnf install -y mysql 2>&1 || dnf install -y mariadb 2>&1 || dnf install -y mariadb105 2>&1 || true)";
    } else if (pm === 'yum') {
      installCmd = "(yum install -y mysql-server 2>&1 || yum install -y mariadb-server 2>&1 || yum install -y mariadb 2>&1) && (yum install -y mysql 2>&1 || yum install -y mariadb 2>&1 || true)";
    } else if (pm === 'pacman') {
      installCmd = "(pacman -S --noconfirm mariadb mariadb-clients 2>&1 || pacman -S --noconfirm mariadb 2>&1 || pacman -S --noconfirm mysql 2>&1)";
    } else if (pm === 'zypper') {
      installCmd = "(zypper --non-interactive in mariadb mariadb-client 2>&1 || zypper --non-interactive in mysql-community-server 2>&1)";
    } else if (pm === 'apk') {
      installCmd = "(apk add --no-cache mariadb mariadb-client mariadb-server-utils 2>&1 || apk add --no-cache mysql mysql-client 2>&1)";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y default-mysql-server 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server 2>&1) && (DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-client 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y default-mysql-client 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-client 2>&1 || true)";
    }
    const post = "if [ ! -d /var/lib/mysql/mysql ]; then (mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql 2>/dev/null || mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null || true); fi; (systemctl enable --now mariadb 2>/dev/null || systemctl enable --now mysqld 2>/dev/null || systemctl enable --now mysql 2>/dev/null || rc-service mariadb start 2>/dev/null || service mariadb start 2>/dev/null || service mysql start 2>/dev/null || service mysqld start 2>/dev/null || true); DB_INIT_PWD=$(openssl rand -hex 16 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \\n'); if [ -n \"$DB_INIT_PWD\" ]; then umask 077 && printf 'MySQL/MariaDB Initial Root Password: %s\\n' \"$DB_INIT_PWD\" > /root/.sshdesktop-mysql-init.txt; mysql -e \"CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$DB_INIT_PWD'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;\" 2>/dev/null || true; mysql -e \"ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY '$DB_INIT_PWD'; FLUSH PRIVILEGES;\" 2>/dev/null || true; fi";
    return { installCmd, post };
  }

  // 2. PostgreSQL Server & Client
  if (lower === 'postgresql' || lower === 'postgresql-server') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y postgresql-server postgresql 2>&1 || yum install -y postgresql-server postgresql 2>&1 || dnf install -y postgresql 2>&1 || yum install -y postgresql 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm postgresql 2>&1";
    } else if (pm === 'zypper') {
      installCmd = "zypper --non-interactive in postgresql-server postgresql 2>&1";
    } else if (pm === 'apk') {
      installCmd = "apk add --no-cache postgresql postgresql-contrib 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib 2>&1";
    }
    const post = "if [ ! -f /var/lib/pgsql/data/PG_VERSION ] && [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then (postgresql-setup --initdb 2>/dev/null || postgresql-setup initdb 2>/dev/null || su - postgres -c \"initdb -D '/var/lib/pgsql/data'\" 2>/dev/null || true); fi; (systemctl enable --now postgresql 2>/dev/null || rc-service postgresql start 2>/dev/null || service postgresql start 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 3. Docker Engine
  if (lower === 'docker' || lower === 'docker.io' || lower === 'docker-ce') {
    let installCmd = '';
    if (pm === 'dnf') {
      installCmd = "(dnf install -y docker 2>&1 || dnf install -y docker-ce 2>&1 || dnf install -y podman-docker 2>&1)";
    } else if (pm === 'yum') {
      installCmd = "(amazon-linux-extras install -y docker 2>/dev/null || yum install -y docker 2>&1 || yum install -y docker-ce 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm docker 2>&1";
    } else if (pm === 'zypper') {
      installCmd = "zypper --non-interactive in docker 2>&1";
    } else if (pm === 'apk') {
      installCmd = "apk add --no-cache docker 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce 2>&1)";
    }
    const post = "(systemctl enable --now docker 2>/dev/null || rc-service docker start 2>/dev/null || service docker start 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 4. Docker Compose
  if (lower === 'docker-compose' || lower === 'docker-compose-plugin') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y docker-compose-plugin 2>&1 || yum install -y docker-compose-plugin 2>&1 || dnf install -y docker-compose 2>&1 || yum install -y docker-compose 2>&1 || (curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose 2>&1))";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm docker-compose 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose 2>&1 || (curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose 2>&1))";
    }
    return { installCmd, post: null };
  }

  // 5. Redis Server & Tools
  if (lower === 'redis' || lower === 'redis-server' || lower === 'redis-tools') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y redis 2>&1 || yum install -y redis 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm redis 2>&1";
    } else if (pm === 'apk') {
      installCmd = "apk add --no-cache redis 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server redis-tools 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y redis 2>&1)";
    }
    const post = "(systemctl enable --now redis 2>/dev/null || systemctl enable --now redis-server 2>/dev/null || rc-service redis start 2>/dev/null || service redis start 2>/dev/null || service redis-server start 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 6. Apache2 / httpd
  if (lower === 'apache2' || lower === 'httpd' || lower === 'apache') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y httpd 2>&1 || yum install -y httpd 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm apache 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 2>&1";
    }
    const post = "(systemctl enable --now httpd 2>/dev/null || systemctl enable --now apache2 2>/dev/null || rc-service apache2 start 2>/dev/null || service httpd start 2>/dev/null || service apache2 start 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 7. Nginx
  if (lower === 'nginx') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y nginx 2>&1 || yum install -y nginx 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm nginx 2>&1";
    } else if (pm === 'apk') {
      installCmd = "apk add --no-cache nginx 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y nginx 2>&1";
    }
    const post = "(systemctl enable --now nginx 2>/dev/null || rc-service nginx start 2>/dev/null || service nginx start 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 8. OpenJDK Java
  if (lower.includes('openjdk') || lower.includes('jdk') || lower === 'java') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y java-17-openjdk-devel 2>&1 || yum install -y java-17-openjdk-devel 2>&1 || dnf install -y java-21-openjdk-devel 2>&1 || dnf install -y java-11-openjdk-devel 2>&1 || dnf install -y java-17-openjdk 2>&1 || yum install -y java-1.8.0-openjdk-devel 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm jdk-openjdk 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y default-jdk 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-11-jdk 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 9. Node.js & NPM
  if (lower === 'nodejs' || lower === 'node') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y nodejs npm 2>&1 || yum install -y nodejs npm 2>&1 || dnf install -y nodejs 2>&1 || yum install -y nodejs 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm nodejs npm 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 10. Python 3 & PIP
  if (lower === 'python3' || lower === 'python') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y python3 python3-pip 2>&1 || yum install -y python3 python3-pip 2>&1 || dnf install -y python3 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm python python-pip 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y python3 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 11. Go (Golang)
  if (lower === 'golang' || lower === 'go') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y golang 2>&1 || yum install -y golang 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm go 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y golang 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 12. Rust & Cargo
  if (lower === 'rust' || lower === 'rustc') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y rust cargo 2>&1 || yum install -y rust cargo 2>&1 || dnf install -y rust 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm rust 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y rustc cargo 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y rustc 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 13. PHP & PHP-FPM
  if (lower === 'php' || lower === 'php-fpm') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y php php-fpm php-cli php-mysqlnd 2>&1 || yum install -y php php-fpm 2>&1 || dnf install -y php 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm php php-fpm 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y php php-fpm php-mysql 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y php 2>&1)";
    }
    const post = "(systemctl enable --now php-fpm 2>/dev/null || systemctl enable --now php8.1-fpm 2>/dev/null || systemctl enable --now php8.2-fpm 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 14. AWS CLI
  if (lower === 'awscli' || lower === 'aws-cli') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y awscli 2>&1 || yum install -y awscli 2>&1 || dnf install -y aws-cli 2>&1 || (curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update && rm -rf /tmp/aws /tmp/awscliv2.zip 2>&1))";
    } else if (pm === 'pacman') {
      installCmd = "(pacman -S --noconfirm aws-cli 2>&1 || pacman -S --noconfirm awscli 2>&1)";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y awscli 2>&1 || (curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update && rm -rf /tmp/aws /tmp/awscliv2.zip 2>&1))";
    }
    return { installCmd, post: null };
  }

  // 15. kubectl (Kubernetes CLI)
  if (lower === 'kubectl') {
    const installCmd = "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y kubectl 2>&1) || (command -v dnf >/dev/null && dnf install -y kubectl 2>&1) || (command -v pacman >/dev/null && pacman -S --noconfirm kubectl 2>&1) || (curl -fsSL -o /usr/local/bin/kubectl \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt 2>/dev/null || echo 'v1.29.0')/bin/linux/amd64/kubectl\" && chmod +x /usr/local/bin/kubectl 2>&1))";
    return { installCmd, post: null };
  }

  // 16. Helm (Kubernetes Package Manager)
  if (lower === 'helm') {
    const installCmd = "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y helm 2>&1) || (command -v dnf >/dev/null && dnf install -y helm 2>&1) || (command -v pacman >/dev/null && pacman -S --noconfirm helm 2>&1) || (curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash 2>&1))";
    return { installCmd, post: null };
  }

  // 17. Terraform
  if (lower === 'terraform') {
    const installCmd = "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y terraform 2>&1) || (command -v dnf >/dev/null && dnf install -y terraform 2>&1) || (command -v pacman >/dev/null && pacman -S --noconfirm terraform 2>&1) || (curl -fsSL https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_amd64.zip -o /tmp/tf.zip && unzip -o /tmp/tf.zip -d /usr/local/bin/ && chmod +x /usr/local/bin/terraform && rm -f /tmp/tf.zip 2>&1))";
    return { installCmd, post: null };
  }

  // 18. k9s
  if (lower === 'k9s') {
    const installCmd = "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y k9s 2>&1) || (command -v dnf >/dev/null && dnf install -y k9s 2>&1) || (command -v pacman >/dev/null && pacman -S --noconfirm k9s 2>&1) || (curl -fsSL https://github.com/derailed/k9s/releases/download/v0.32.4/k9s_Linux_amd64.tar.gz | tar -xz -C /usr/local/bin k9s && chmod +x /usr/local/bin/k9s 2>&1))";
    return { installCmd, post: null };
  }

  // 19. Firewalls: UFW / Firewalld
  if (lower === 'ufw' || lower === 'firewalld') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y firewalld 2>&1 || yum install -y firewalld 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "(pacman -S --noconfirm firewalld 2>&1 || pacman -S --noconfirm ufw 2>&1)";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y ufw 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y firewalld 2>&1)";
    }
    const post = "(systemctl enable --now firewalld 2>/dev/null || systemctl enable --now ufw 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 20. WireGuard
  if (lower === 'wireguard' || lower === 'wireguard-tools') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y wireguard-tools 2>&1 || yum install -y wireguard-tools 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm wireguard-tools 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard wireguard-tools 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 21. sqlite3
  if (lower === 'sqlite3' || lower === 'sqlite') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y sqlite 2>&1 || yum install -y sqlite 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm sqlite 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3 2>&1";
    }
    return { installCmd, post: null };
  }

  // 22. Fail2ban
  if (lower === 'fail2ban') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y fail2ban 2>&1 || yum install -y fail2ban 2>&1 || dnf install -y epel-release && dnf install -y fail2ban 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm fail2ban 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban 2>&1";
    }
    const post = "(systemctl enable --now fail2ban 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 23. Memcached
  if (lower === 'memcached') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y memcached 2>&1 || yum install -y memcached 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm memcached 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y memcached 2>&1";
    }
    const post = "(systemctl enable --now memcached 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 24. HAProxy
  if (lower === 'haproxy') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y haproxy 2>&1 || yum install -y haproxy 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm haproxy 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y haproxy 2>&1";
    }
    const post = "(systemctl enable --now haproxy 2>/dev/null || true)";
    return { installCmd, post };
  }

  // 25. QEMU / KVM
  if (lower === 'qemu-kvm' || lower.startsWith('qemu')) {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y qemu-kvm 2>&1 || yum install -y qemu-kvm 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "(pacman -S --noconfirm qemu-base 2>&1 || pacman -S --noconfirm qemu-full 2>&1)";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y qemu-kvm 2>&1";
    }
    return { installCmd, post: null };
  }

  // 26. bat (bat / batcat)
  if (lower === 'bat' || lower === 'batcat') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y bat 2>&1 || yum install -y bat 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm bat 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y bat 2>&1 && (ln -sf /usr/bin/batcat /usr/local/bin/bat 2>/dev/null || true))";
    }
    return { installCmd, post: null };
  }

  // 27. eza / exa
  if (lower === 'eza' || lower === 'exa') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y eza 2>&1 || dnf install -y exa 2>&1 || yum install -y exa 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "(pacman -S --noconfirm eza 2>&1 || pacman -S --noconfirm exa 2>&1)";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y eza 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y exa 2>&1)";
    }
    return { installCmd, post: null };
  }

  // 28. Certbot
  if (lower === 'certbot') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y certbot 2>&1 || yum install -y certbot 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm certbot 2>&1";
    } else {
      installCmd = "DEBIAN_FRONTEND=noninteractive apt-get install -y certbot 2>&1";
    }
    return { installCmd, post: null };
  }

  // 29. MongoDB
  if (lower === 'mongodb' || lower === 'mongodb-org' || lower === 'mongod') {
    let installCmd = '';
    if (pm === 'dnf' || pm === 'yum') {
      installCmd = "(dnf install -y mongodb-org 2>&1 || yum install -y mongodb-org 2>&1 || dnf install -y mongodb 2>&1)";
    } else if (pm === 'pacman') {
      installCmd = "pacman -S --noconfirm mongodb-bin 2>&1 || pacman -S --noconfirm mongodb 2>&1";
    } else {
      installCmd = "(DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-org 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb 2>&1)";
    }
    const post = "(systemctl enable --now mongod 2>/dev/null || systemctl enable --now mongodb 2>/dev/null || true)";
    return { installCmd, post };
  }

  // Generic fallback
  const safe = name.replace(/'/g, "'\\''");
  let installCmd = '';
  if (pm === 'dnf') installCmd = `dnf install -y '${safe}' 2>&1`;
  else if (pm === 'yum') installCmd = `yum install -y '${safe}' 2>&1`;
  else if (pm === 'pacman') installCmd = `pacman -S --noconfirm '${safe}' 2>&1`;
  else if (pm === 'zypper') installCmd = `zypper --non-interactive in '${safe}' 2>&1`;
  else if (pm === 'apk') installCmd = `apk add --no-cache '${safe}' 2>&1`;
  else installCmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y '${safe}' 2>&1`;

  const post = `if systemctl list-unit-files '${safe}.service' >/dev/null 2>&1; then systemctl enable --now '${safe}' 2>/dev/null || true; fi`;
  return { installCmd, post };
}

const MAX_SOCKS5_CONCURRENT_STREAMS = 64;

function parseSocks5GreetingFrame(buffer) {
  if (buffer.length < 2) return { status: 'incomplete' };
  if (buffer[0] !== 0x05) return { status: 'error', reason: 'Unsupported SOCKS version' };
  const nmethods = buffer[1];
  if (nmethods === 0) return { status: 'error', reason: 'No authentication methods offered' };
  if (buffer.length < 2 + nmethods) return { status: 'incomplete' };
  const methods = Array.from(buffer.subarray(2, 2 + nmethods));
  return { status: 'ok', methods, consumed: 2 + nmethods };
}

function parseSocks5UserPassFrame(buffer) {
  if (buffer.length < 2) return { status: 'incomplete' };
  if (buffer[0] !== 0x01) return { status: 'error', reason: 'Unsupported RFC 1929 auth version' };
  const ulen = buffer[1];
  if (buffer.length < 2 + ulen + 1) return { status: 'incomplete' };
  const plen = buffer[2 + ulen];
  const totalLen = 2 + ulen + 1 + plen;
  if (buffer.length < totalLen) return { status: 'incomplete' };
  const username = buffer.subarray(2, 2 + ulen);
  const password = buffer.subarray(2 + ulen + 1, totalLen);
  return { status: 'ok', username, password, consumed: totalLen };
}

function parseSocks5ConnectFrame(buffer) {
  if (buffer.length < 4) return { status: 'incomplete' };
  if (buffer[0] !== 0x05) return { status: 'error', reason: 'Invalid SOCKS5 request version' };
  const cmd = buffer[1];
  if (cmd !== 0x01) return { status: 'unsupported_cmd', code: 0x07 };
  const atyp = buffer[3];
  let destHost = '';
  let totalLen = 0;

  if (atyp === 0x01) {
    totalLen = 4 + 4 + 2;
    if (buffer.length < totalLen) return { status: 'incomplete' };
    destHost = `${buffer[4]}.${buffer[5]}.${buffer[6]}.${buffer[7]}`;
  } else if (atyp === 0x03) {
    if (buffer.length < 5) return { status: 'incomplete' };
    const domainLen = buffer[4];
    if (domainLen === 0) return { status: 'bad_addr', code: 0x08 };
    totalLen = 5 + domainLen + 2;
    if (buffer.length < totalLen) return { status: 'incomplete' };
    destHost = buffer.subarray(5, 5 + domainLen).toString('utf8');
    if (/[\x00-\x20\x7f]/.test(destHost)) return { status: 'bad_addr', code: 0x08 };
  } else if (atyp === 0x04) {
    totalLen = 4 + 16 + 2;
    if (buffer.length < totalLen) return { status: 'incomplete' };
    const parts = [];
    for (let i = 4; i < 20; i += 2) {
      parts.push(buffer.readUInt16BE(i).toString(16));
    }
    destHost = parts.join(':');
  } else {
    return { status: 'bad_addr', code: 0x08 };
  }

  const destPort = buffer.readUInt16BE(totalLen - 2);
  if (destPort === 0) return { status: 'bad_addr', code: 0x08 };
  return { status: 'ok', destHost, destPort, consumed: totalLen };
}

function safeEqualUtf8(buf, expectedStr) {
  const a = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8');
  const b = Buffer.from(String(expectedStr), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function startSocks5Proxy(sshClient, preferredPort = 1080, socksAuth = null) {
  return new Promise((resolve, reject) => {
    let activeStreams = 0;
    const server = net.createServer(socket => {
      if (activeStreams >= MAX_SOCKS5_CONCURRENT_STREAMS) {
        try { socket.destroy(); } catch {}
        return;
      }
      activeStreams += 1;
      let decremented = false;
      const releaseSlot = () => {
        if (!decremented) {
          decremented = true;
          activeStreams = Math.max(0, activeStreams - 1);
        }
      };

      let state = 'GREETING';
      let sshStream = null;
      let recvBuffer = Buffer.alloc(0);

      const handshakeTimer = setTimeout(() => {
        if (state !== 'STREAM') {
          try { socket.destroy(); } catch {}
        }
      }, 10000);

      const cleanup = () => {
        clearTimeout(handshakeTimer);
        releaseSlot();
        if (sshStream) try { sshStream.end(); } catch {}
      };

      socket.on('close', cleanup);
      socket.on('error', () => {
        try { socket.destroy(); } catch {}
        cleanup();
      });

      socket.on('data', chunk => {
        if (state === 'STREAM') {
          return;
        }
        recvBuffer = Buffer.concat([recvBuffer, chunk]);
        if (recvBuffer.length > 16 * 1024) {
          try { socket.end(); } catch {}
          return;
        }

        while (state !== 'STREAM' && state !== 'CONNECTING' && recvBuffer.length > 0) {
          if (state === 'GREETING') {
            const parsed = parseSocks5GreetingFrame(recvBuffer);
            if (parsed.status === 'incomplete') return;
            if (parsed.status !== 'ok') {
              try { socket.end(); } catch {}
              return;
            }
            recvBuffer = recvBuffer.subarray(parsed.consumed);
            if (socksAuth) {
              if (!parsed.methods.includes(0x02)) {
                socket.write(Buffer.from([0x05, 0xff]));
                socket.end();
                return;
              }
              socket.write(Buffer.from([0x05, 0x02]));
              state = 'USERPASS';
            } else {
              if (!parsed.methods.includes(0x00)) {
                socket.write(Buffer.from([0x05, 0xff]));
                socket.end();
                return;
              }
              socket.write(Buffer.from([0x05, 0x00]));
              state = 'CMD';
            }
          } else if (state === 'USERPASS') {
            const parsed = parseSocks5UserPassFrame(recvBuffer);
            if (parsed.status === 'incomplete') return;
            if (parsed.status !== 'ok') {
              try {
                socket.write(Buffer.from([0x01, 0x01]));
                socket.end();
              } catch {}
              return;
            }
            recvBuffer = recvBuffer.subarray(parsed.consumed);
            const ok = socksAuth
              && safeEqualUtf8(parsed.username, socksAuth.username)
              && safeEqualUtf8(parsed.password, socksAuth.password);
            if (!ok) {
              socket.write(Buffer.from([0x01, 0x01]));
              socket.end();
              return;
            }
            socket.write(Buffer.from([0x01, 0x00]));
            state = 'CMD';
          } else if (state === 'CMD') {
            const parsed = parseSocks5ConnectFrame(recvBuffer);
            if (parsed.status === 'incomplete') return;
            if (parsed.status === 'unsupported_cmd') {
              socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              socket.end();
              return;
            }
            if (parsed.status === 'bad_addr' || parsed.status === 'error') {
              socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              socket.end();
              return;
            }

            const parsedHostLower = String(parsed.destHost || '').toLowerCase().replace(/^\[|\]$/g, '');
            const policy = getSecurityPolicy();
            if (policy.blockMetadataEgress && (
              parsedHostLower === '169.254.169.254' ||
              parsedHostLower === 'fd00:ec2::254' ||
              parsedHostLower === 'metadata.google.internal' ||
              parsedHostLower === '169.254.170.2'
            )) {
              socket.write(Buffer.from([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); // Connection not allowed by ruleset
              socket.end();
              return;
            }

            recvBuffer = recvBuffer.subarray(parsed.consumed);
            const initialPayload = recvBuffer;
            recvBuffer = Buffer.alloc(0);
            state = 'CONNECTING';
            socket.pause();

            const srcAddr = socket.remoteAddress || '127.0.0.1';
            const srcPort = socket.remotePort || 0;
            sshClient.forwardOut(srcAddr, srcPort, parsed.destHost, parsed.destPort, (err, stream) => {
              clearTimeout(handshakeTimer);
              if (err) {
                try {
                  socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                  socket.end();
                } catch {}
                return;
              }

              sshStream = stream;
              state = 'STREAM';
              socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              if (initialPayload.length > 0) {
                sshStream.write(initialPayload);
              }
              socket.pipe(sshStream);
              sshStream.pipe(socket);
              socket.resume();

              sshStream.on('error', () => {
                try { socket.destroy(); } catch {}
              });
              sshStream.on('close', () => {
                try { socket.end(); } catch {}
              });
            });
            return;
          }
        }
      });
    });

    server.on('error', err => {
      reject(err);
    });

    const targetPort = preferredPort && preferredPort > 0 ? preferredPort : 1080;
    server.listen(targetPort, '127.0.0.1', () => {
      const boundPort = server.address().port;
      resolve({ server, port: boundPort });
    });
  });
}

// ==========================================
// SSH Client Configuration & Key Helper
// ==========================================
function ensureKeyFile(connId, keyInput) {
  if (!keyInput || typeof keyInput !== 'string') return null;
  const trimmed = keyInput.trim();
  if (!trimmed) return null;

  // 1. If it's already an existing file on disk, return its path
  if (fs.existsSync(trimmed)) {
    try { fs.chmodSync(trimmed, 0o600); } catch {}
    return trimmed;
  }

  // 2. If it is raw key content (PEM or PPK string)
  if (trimmed.includes('PRIVATE KEY') || trimmed.includes('PuTTY-User-Key-File') || trimmed.includes('\n')) {
    try {
      if (!fs.existsSync(KEYS_DIR)) {
        fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
      }
      try { fs.chmodSync(KEYS_DIR, 0o700); } catch {}

      const isPpk = trimmed.includes('PuTTY-User-Key-File');
      const ext = isPpk ? 'ppk' : 'pem';
      const safeId = String(connId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
      const targetFile = path.join(KEYS_DIR, `${safeId}.${ext}`);

      fs.writeFileSync(targetFile, trimmed, { encoding: 'utf8', mode: 0o600 });
      try { fs.chmodSync(targetFile, 0o600); } catch {}
      return targetFile;
    } catch (err) {
      console.warn(`[SSH Desktop] Failed to save key file for ${connId}:`, err.message);
      return null;
    }
  }

  return null;
}

function sshHostTokenMatches(token, candidate) {
  if (token.startsWith('|1|')) {
    const parts = token.split('|');
    if (parts.length !== 4 || parts[1] !== '1') return false;
    try {
      const salt = Buffer.from(parts[2], 'base64');
      const expected = Buffer.from(parts[3], 'base64');
      const actual = crypto.createHmac('sha1', salt).update(candidate).digest();
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    } catch { return false; }
  }
  let pattern = '';
  for (const ch of token.toLowerCase()) {
    if (ch === '*') pattern += '.*';
    else if (ch === '?') pattern += '.';
    else {
      if ('.^$+()[]{}|\\'.includes(ch)) pattern += '\\';
      pattern += ch;
    }
  }
  try { return new RegExp('^' + pattern + '$', 'i').test(candidate); }
  catch { return false; }
}

function sshHostFieldMatches(field, candidates) {
  let positive = false;
  for (const raw of field.split(',')) {
    if (!raw) continue;
    const negated = raw.startsWith('!');
    const token = negated ? raw.slice(1) : raw;
    if (candidates.some(candidate => sshHostTokenMatches(token, candidate))) {
      if (negated) return false;
      positive = true;
    }
  }
  return positive;
}

// Verify the SSH wire-format key against OpenSSH known_hosts. Unknown, changed,
// revoked, malformed, and unreadable entries fail closed.
function verifySshHostKey(host, port, keyBlob) {
  try {
    const key = Buffer.isBuffer(keyBlob) ? keyBlob : Buffer.from(keyBlob);
    if (key.length < 4) return false;
    const typeLength = key.readUInt32BE(0);
    if (typeLength < 1 || typeLength > 256 || key.length < 4 + typeLength) return false;
    const keyType = key.subarray(4, 4 + typeLength).toString('ascii');
    if (!/^[A-Za-z0-9@._+-]+$/.test(keyType)) return false;
    const keyB64 = key.toString('base64');
    const normalizedHost = String(host).toLowerCase();
    const candidates = port === 22 ? [normalizedHost, '[' + normalizedHost + ']:22'] : ['[' + normalizedHost + ']:' + port];
    const knownHostsPath = path.join(os.homedir(), '.ssh', 'known_hosts');
    const contents = fs.readFileSync(knownHostsPath, 'utf8');
    let trusted = false;
    let revoked = false;
    for (const line of contents.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const fields = trimmed.split(/\s+/);
      let marker = null, hostField, storedType, storedKey;
      if (fields[0].startsWith('@')) {
        if (fields.length < 4) continue;
        [marker, hostField, storedType, storedKey] = fields;
      } else {
        if (fields.length < 3) continue;
        [hostField, storedType, storedKey] = fields;
      }
      if (marker === '@cert-authority' || !sshHostFieldMatches(hostField, candidates)) continue;
      if (storedType === keyType && storedKey === keyB64) {
        if (marker === '@revoked') revoked = true;
        else if (!marker) trusted = true;
      }
    }
    return trusted && !revoked;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('[SSH Desktop] Host-key verification failed closed:', error.message);
    return false;
  }
}

function buildSshClientConfig(config, targetId) {
  const host = String(config.host || '').trim();
  const port = config.port === undefined || config.port === null || config.port === '' ? 22 : Number(config.port);
  const username = String(config.username || 'root').trim();
  if (!host || host.length > 253 || /[\s/?#@]/.test(host)) {
    throw new Error('Invalid SSH host name or address.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SSH port must be an integer between 1 and 65535.');
  }
  if (!username || username.length > 255 || /[\0\r\n]/.test(username)) {
    throw new Error('Invalid SSH username.');
  }

  const connectConfig = {
    host,
    port,
    username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
    hostVerifier: key => verifySshHostKey(host, port, key),
    tryKeyboard: true,
    algorithms: {
      kex: [
        'curve25519-sha256',
        'curve25519-sha256@libssh.org',
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
      ],
      cipher: [
        'chacha20-poly1305@openssh.com',
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
      ],
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
      ],
      hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512',
        'hmac-sha2-256-etm@openssh.com',
        'hmac-sha2-512-etm@openssh.com',
      ]
    }
  };

  const rawAuth = String(config.auth_method || config.authMethod || config.auth_type || '').toLowerCase().trim();
  const rawKey = config.private_key || config.private_key_path || config.privateKeyPath || config.key_path || config.keyPath;
  const trimmedKey = typeof rawKey === 'string' ? rawKey.trim() : '';

  const hasKey = Boolean(
    trimmedKey &&
    (fs.existsSync(trimmedKey) || trimmedKey.includes('PRIVATE KEY') || trimmedKey.includes('\n') || trimmedKey.endsWith('.pem') || trimmedKey.endsWith('.ppk'))
  );

  const isPassword = rawAuth === 'password' || (!rawAuth && config.password && !hasKey);

  if (isPassword) {
    // STRICT PASSWORD AUTHENTICATION: Never attach privateKey
    connectConfig.password = String(config.password || '');
    connectConfig.tryKeyboard = true;
  } else {
    // STRICT KEY AUTHENTICATION (PEM/PPK: In-Memory string or On-Disk file)
    connectConfig.tryKeyboard = false;
    if (trimmedKey) {
      if (trimmedKey.includes('PRIVATE KEY') || trimmedKey.includes('\n')) {
        // In-memory PEM string
        connectConfig.privateKey = Buffer.from(trimmedKey, 'utf8');
      } else if (fs.existsSync(trimmedKey)) {
        // Saved key file on disk
        try {
          connectConfig.privateKey = fs.readFileSync(trimmedKey);
        } catch (e) {
          console.warn(`[SSH Desktop] Failed to read private key from ${trimmedKey}:`, e.message);
        }
      }
    }

    if (config.passphrase) {
      connectConfig.passphrase = String(config.passphrase);
    }
  }

  return connectConfig;
}

async function handleInvokeCommand(cmd, args, currentSession = null, clientIp = '127.0.0.1') {
  enforcePolicyPermission(cmd, args, currentSession);
  const connId = args?.connId;
  const entry = getActiveEntry(connId);

  switch (cmd) {
    // ==========================================
    // 1. Web Authentication & Session (1-Hour Expiration)
    // ==========================================
    case 'auth_get_status': {
      const token = extractSessionToken(null, { args });
      const session = currentSession || (token ? getSession(token) : null);
      const auth = readJsonSafe(AUTH_FILE, {});

      const credFile = path.join(DATA_DIR, 'initial-admin-credentials.txt');
      const varLibCredFile = '/var/lib/sshdesktop/initial-admin-credentials.txt';
      const hasInitialCreds = fs.existsSync(credFile) || (process.platform === 'linux' && fs.existsSync(varLibCredFile));
      const isFirstLogin = Boolean(auth.must_change_password || hasInitialCreds);

      return {
        is_configured: true,
        is_authenticated: Boolean(session),
        session_expired: !session && Boolean(token),
        expires_in_seconds: session
          ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000))
          : 0,
        session_duration_seconds: Math.floor(SESSION_TTL_MS / 1000),
        must_change_password: !!auth.must_change_password,
        totp_enabled: Boolean(auth.totp_enabled),
        is_first_login: isFirstLogin,
        initial_credentials_cmd: 'sudo cat /var/lib/sshdesktop/initial-admin-credentials.txt',
        username: session ? session.username : (isFirstLogin ? 'admin' : (auth.username || '')),
        storage_path: DATA_DIR
      };
    }

    case 'auth_login': {
      const { username, password, totpCode, totp_code } = args || {};
      const mfaCode = totpCode || totp_code || '';
      const now = Date.now();
      const ipRecord = loginAttempts.get(clientIp) || { count: 0, lastAttempt: 0, lockedUntil: 0 };
      if (ipRecord.lockedUntil > now) {
        const remainingSec = Math.ceil((ipRecord.lockedUntil - now) / 1000);
        return {
          success: false,
          must_change_password: false,
          mfa_required: false,
          username,
          message: `Too many failed login attempts. Locked out for ${remainingSec}s.`
        };
      }

      const auth = readJsonSafe(AUTH_FILE, {});

      const validUser = String(auth.username || '')
        .trim()
        .toLowerCase();

      const inputUser = String(username || '')
        .trim()
        .toLowerCase();

      const passwordMatches = await verifyPasswordAsync(auth, password);
      if (
        inputUser === validUser &&
        passwordMatches
      ) {
        if (auth.totp_enabled && auth.totp_secret) {
          if (!String(mfaCode).trim()) {
            return {
              success: false,
              mfa_required: true,
              must_change_password: false,
              username: auth.username,
              message: 'Two-factor authentication code required.'
            };
          }
          if (!verifyTotpCode(auth.totp_secret, mfaCode)) {
            ipRecord.count += 1;
            ipRecord.lastAttempt = now;
            if (ipRecord.count >= 5) ipRecord.lockedUntil = now + 60 * 1000;
            loginAttempts.set(clientIp, ipRecord);
            appendAuditEvent({ event: 'auth_login_totp', username: auth.username, ip: clientIp, status: 'failed' });
            return {
              success: false,
              mfa_required: true,
              must_change_password: false,
              username: auth.username,
              message: 'Invalid authenticator code.'
            };
          }
        }
        loginAttempts.delete(clientIp);
        const session = createSession(auth.username, 'admin');
        appendAuditEvent({ event: 'auth_login', username: auth.username, ip: clientIp, status: 'success' });

        return {
          success: true,
          token: session.token,
          expires_at: session.expiresAt,
          expires_in_seconds: Math.floor(SESSION_TTL_MS / 1000),
          must_change_password: !!auth.must_change_password,
          mfa_required: false,
          username: auth.username
        };
      }

      // Check configured team members
      const teamList = readJsonSafe(TEAM_FILE, []);
      if (Array.isArray(teamList)) {
        const teamUser = teamList.find(u => u && String(u.username || '').trim().toLowerCase() === inputUser);
        if (teamUser) {
          if (teamUser.disabled) {
            return { success: false, must_change_password: false, mfa_required: false, username, message: 'Account disabled by administrator.' };
          }
          const teamMatch = await verifyPasswordAsync(teamUser, password);
          if (teamMatch) {
            loginAttempts.delete(clientIp);
            teamUser.last_login_at = Math.floor(Date.now() / 1000);
            writeJsonSafe(TEAM_FILE, teamList);
            const session = createSession(teamUser.username, teamUser.role || 'read_only');
            appendAuditEvent({ event: 'auth_login', username: teamUser.username, ip: clientIp, role: session.role, status: 'success' });
            return {
              success: true,
              token: session.token,
              expires_at: session.expiresAt,
              expires_in_seconds: Math.floor(SESSION_TTL_MS / 1000),
              must_change_password: false,
              mfa_required: false,
              username: teamUser.username
            };
          }
        }
      }

      ipRecord.count += 1;
      ipRecord.lastAttempt = now;
      if (ipRecord.count >= 5) {
        ipRecord.lockedUntil = now + 60 * 1000; // 1 minute lockout
      }
      appendAuditEvent({ event: 'auth_login', username: String(username || ''), ip: clientIp, status: 'failed', attempts: ipRecord.count });
      const MAX_LOGIN_ATTEMPT_ENTRIES = 10000;
      if (!loginAttempts.has(clientIp) && loginAttempts.size >= MAX_LOGIN_ATTEMPT_ENTRIES) {
        let oldestIp = null;
        let oldestAttempt = Number.POSITIVE_INFINITY;
        for (const [ip, record] of loginAttempts.entries()) {
          if (record.lastAttempt < oldestAttempt) {
            oldestAttempt = record.lastAttempt;
            oldestIp = ip;
          }
        }
        if (oldestIp !== null) loginAttempts.delete(oldestIp);
      }
      loginAttempts.set(clientIp, ipRecord);

      return {
        success: false,
        must_change_password: false,
        username,
        message: 'Invalid username or password.'
      };
    }

    case 'auth_change_credentials': {
      const { currentPassword, newUsername, newPassword } = args || {};

      const auth = readJsonSafe(AUTH_FILE, {});

      const currentMatches = await verifyPasswordAsync(auth, currentPassword);
      if (!currentMatches) {
        return {
          success: false,
          message: 'Current password incorrect.'
        };
      }

      if (
        typeof newPassword !== 'string' ||
        newPassword.length < 12 ||
        Buffer.byteLength(newPassword, 'utf8') > 1024
      ) {
        return {
          success: false,
          message: 'New password must contain 12 to 1024 UTF-8 bytes.'
        };
      }

      const username = String(newUsername || '').trim();

      if (!username || username.length < 3 || username.length > 64 || /[\x00-\x1f\x7f]/.test(username)) {
        return {
          success: false,
          message: 'Username must contain 3 to 64 characters and no control characters.'
        };
      }

      const hashed = await hashPasswordAsync(newPassword);

      auth.username = username;
      auth.password_hash = hashed.password_hash;
      auth.password_salt = hashed.password_salt;
      auth.must_change_password = false;

      delete auth.password;

      if (!writeJsonSafe(AUTH_FILE, auth)) {
        return {
          success: false,
          message: 'Unable to save new credentials.'
        };
      }

      const candidatePaths = [
        path.join(DATA_DIR, 'initial-admin-credentials.txt'),
        '/var/lib/sshdesktop/initial-admin-credentials.txt'
      ];
      for (const p of candidatePaths) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }

      // Revoke every other login token after a credential change. Keep only
      // the authenticated session that performed the change.
      for (const [activeToken] of activeSessions.entries()) {
        if (!currentSession?.token || activeToken !== currentSession.token) {
          destroySession(activeToken);
        }
      }
      const preservedHash = currentSession?.token ? hashToken(currentSession.token) : null;
      for (const [storedHash] of hashedSessions.entries()) {
        if (!preservedHash || storedHash !== preservedHash) hashedSessions.delete(storedHash);
      }
      if (currentSession?.token) {
        currentSession.username = username;
        activeSessions.set(currentSession.token, currentSession);
      }
      persistSessions();

      return {
        success: true,
        must_change_password: false,
        username,
        message: 'Credentials updated successfully.'
      };
    }

    case 'auth_logout': {
      const token = extractSessionToken(null, { args });
      if (token) destroySession(token);
      if (currentSession?.token) destroySession(currentSession.token);
      appendAuditEvent({ event: 'auth_logout', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return true;
    }

    case 'auth_totp_setup': {
      const auth = readJsonSafe(AUTH_FILE, {});
      const secret = base32Encode(crypto.randomBytes(20));
      const user = encodeURIComponent(auth.username || 'admin');
      return {
        secret,
        otpauth_url: `otpauth://totp/SSHDesktop:${user}?secret=${secret}&issuer=SSHDesktop&digits=6&period=30`,
        totp_enabled: Boolean(auth.totp_enabled),
      };
    }

    case 'auth_totp_enable': {
      const secret = String(args?.secret || '').trim();
      const code = String(args?.code || '').trim();
      if (!verifyTotpCode(secret, code)) {
        const err = new Error('Invalid 6-digit TOTP verification code for this setup key.');
        err.statusCode = 400;
        throw err;
      }
      const auth = readJsonSafe(AUTH_FILE, {});
      auth.totp_enabled = true;
      auth.totp_secret = secret;
      if (!writeJsonSafe(AUTH_FILE, auth)) {
        throw new Error('Failed to persist TOTP configuration.');
      }
      appendAuditEvent({ event: 'auth_totp_enable', username: currentSession?.username || auth.username || '', ip: clientIp, status: 'ok' });
      return true;
    }

    case 'auth_totp_disable': {
      const password = String(args?.password || '');
      const code = String(args?.code || '').trim();
      const auth = readJsonSafe(AUTH_FILE, {});
      const passwordOk = await verifyPasswordAsync(auth, password);
      if (!passwordOk) {
        const err = new Error('Current password is incorrect.');
        err.statusCode = 401;
        throw err;
      }
      if (auth.totp_enabled && auth.totp_secret && !verifyTotpCode(auth.totp_secret, code)) {
        const err = new Error('Invalid 6-digit TOTP code.');
        err.statusCode = 401;
        throw err;
      }
      auth.totp_enabled = false;
      delete auth.totp_secret;
      if (!writeJsonSafe(AUTH_FILE, auth)) {
        throw new Error('Failed to persist TOTP configuration.');
      }
      appendAuditEvent({ event: 'auth_totp_disable', username: currentSession?.username || auth.username || '', ip: clientIp, status: 'ok' });
      return true;
    }

    case 'tokens_list': {
      return loadTokensRaw().map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        prefix: t.prefix,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt || null,
        revoked: Boolean(t.revoked),
      }));
    }

    case 'tokens_create': {
      const cleanName = String(args?.name || '').trim();
      if (!cleanName || cleanName.length > 64) {
        throw new Error('Token name must be 1 to 64 characters.');
      }
      const cleanRole = validateSafeToken(String(args?.role || 'read_only').trim().toLowerCase(), /^(?:admin|operator|read_only)$/, 'role');
      const daysRaw = args?.expiresInDays ?? args?.expires_in_days;
      let expiresAt = null;
      if (daysRaw !== undefined && daysRaw !== null && Number(daysRaw) > 0) {
        const days = validateInt(Number(daysRaw), 1, 3650, 'expiresInDays');
        expiresAt = new Date(Date.now() + days * 86400 * 1000).toISOString();
      }
      const rawSecret = `sshdesktop_tok_${crypto.randomBytes(24).toString('hex')}`;
      const tokenHash = crypto.createHash('sha256').update(rawSecret, 'utf8').digest('hex');
      const id = crypto.randomUUID();
      const prefix = rawSecret.slice(0, 20);
      const record = {
        id,
        name: cleanName,
        role: cleanRole,
        tokenHash,
        prefix,
        createdAt: new Date().toISOString(),
        expiresAt,
        revoked: false,
      };
      const list = loadTokensRaw();
      list.push(record);
      if (!saveTokensRaw(list)) {
        throw new Error('Failed to save API token.');
      }
      appendAuditEvent({ event: 'tokens_create', username: currentSession?.username || 'admin', ip: clientIp, tokenId: id, role: cleanRole, status: 'ok' });
      return {
        id,
        name: cleanName,
        role: cleanRole,
        prefix,
        token: rawSecret,
        expiresAt,
      };
    }

    case 'tokens_revoke': {
      const id = String(args?.id || '').trim();
      if (!id) throw new Error('Token ID is required.');
      const list = loadTokensRaw();
      let found = false;
      for (const t of list) {
        if (t.id === id) {
          t.revoked = true;
          found = true;
        }
      }
      if (found) {
        saveTokensRaw(list);
        appendAuditEvent({ event: 'tokens_revoke', username: currentSession?.username || 'admin', ip: clientIp, tokenId: id, status: 'ok' });
      }
      return found;
    }

    case 'vault_rotate_key': {
      const outcome = vaultRotateKey();
      appendAuditEvent({
        event: 'vault_rotate_key',
        username: currentSession?.username || 'admin',
        ip: clientIp,
        entriesReencrypted: outcome.entriesReencrypted,
        status: 'ok',
      });
      return outcome;
    }

    case 'team_list': {
      const list = readJsonSafe(TEAM_FILE, []);
      return (Array.isArray(list) ? list : []).map(u => ({
        username: u.username,
        role: u.role,
        disabled: Boolean(u.disabled),
        created_at: u.created_at || 0,
        last_login_at: u.last_login_at || null,
      }));
    }

    case 'team_add': {
      const uname = validateSafeToken(String(args?.username || '').trim(), /^[a-zA-Z0-9._-]{3,64}$/, 'username');
      const pw = String(args?.password || '');
      if (pw.length < 12 || Buffer.byteLength(pw, 'utf8') > 4096) {
        throw new Error('Team member password must be at least 12 characters.');
      }
      const role = validateSafeToken(String(args?.role || 'read_only').toLowerCase(), /^(?:admin|operator|read_only)$/, 'role');
      const primaryAuth = readJsonSafe(AUTH_FILE, {});
      if (String(primaryAuth.username || '').toLowerCase() === uname.toLowerCase()) {
        throw new Error('Username conflicts with primary administrator account.');
      }
      const list = Array.isArray(readJsonSafe(TEAM_FILE, [])) ? readJsonSafe(TEAM_FILE, []) : [];
      if (list.some(u => String(u.username || '').toLowerCase() === uname.toLowerCase())) {
        throw new Error('Team member already exists.');
      }
      const hashed = await hashPasswordAsync(pw);
      const record = {
        username: uname,
        role,
        password_hash: hashed.password_hash,
        password_salt: hashed.password_salt,
        disabled: false,
        created_at: Math.floor(Date.now() / 1000),
        last_login_at: null,
      };
      list.push(record);
      if (!writeJsonSafe(TEAM_FILE, list)) throw new Error('Failed saving team list');
      appendAuditEvent({ event: 'team_add', username: currentSession?.username || 'admin', target: uname, role, status: 'ok' });
      return { username: record.username, role: record.role, disabled: false, created_at: record.created_at, last_login_at: null };
    }

    case 'team_set_role': {
      const uname = String(args?.username || '').trim();
      const role = validateSafeToken(String(args?.role || '').toLowerCase(), /^(?:admin|operator|read_only)$/, 'role');
      const list = Array.isArray(readJsonSafe(TEAM_FILE, [])) ? readJsonSafe(TEAM_FILE, []) : [];
      const target = list.find(u => String(u.username || '').toLowerCase() === uname.toLowerCase());
      if (!target) return false;
      target.role = role;
      if (args?.disabled !== undefined) target.disabled = Boolean(args.disabled);
      writeJsonSafe(TEAM_FILE, list);
      appendAuditEvent({ event: 'team_set_role', username: currentSession?.username || 'admin', target: target.username, role, status: 'ok' });
      return true;
    }

    case 'team_remove': {
      const uname = String(args?.username || '').trim();
      const list = Array.isArray(readJsonSafe(TEAM_FILE, [])) ? readJsonSafe(TEAM_FILE, []) : [];
      const next = list.filter(u => String(u.username || '').toLowerCase() !== uname.toLowerCase());
      if (next.length === list.length) return false;
      writeJsonSafe(TEAM_FILE, next);
      appendAuditEvent({ event: 'team_remove', username: currentSession?.username || 'admin', target: uname, status: 'ok' });
      return true;
    }

    case 'sso_get_config': {
      return readJsonSafe(SSO_FILE, {
        enabled: false,
        provider_name: 'OIDC Identity Provider',
        issuer_url: '',
        client_id: '',
        redirect_uri: '',
        default_role: 'read_only',
      });
    }

    case 'sso_set_config': {
      const cfg = args?.config || args || {};
      const enabled = Boolean(cfg.enabled);
      const issuerUrl = String(cfg.issuer_url || cfg.issuerUrl || '').trim();
      if (enabled && !issuerUrl.startsWith('https://')) {
        throw new Error('SSO OIDC Issuer URL must use https:// when enabled.');
      }
      const defaultRole = validateSafeToken(String(cfg.default_role || cfg.defaultRole || 'read_only').toLowerCase(), /^(?:admin|operator|read_only)$/, 'default_role');
      const next = {
        enabled,
        provider_name: String(cfg.provider_name || cfg.providerName || 'OIDC Identity Provider').trim().slice(0, 64),
        issuer_url: issuerUrl,
        client_id: String(cfg.client_id || cfg.clientId || '').trim().slice(0, 256),
        redirect_uri: String(cfg.redirect_uri || cfg.redirectUri || '').trim().slice(0, 512),
        default_role: defaultRole,
      };
      if (!writeJsonSafe(SSO_FILE, next)) throw new Error('Failed persisting SSO config.');
      appendAuditEvent({ event: 'sso_set_config', username: currentSession?.username || 'admin', target: issuerUrl, status: 'ok' });
      return next;
    }

    case 'approval_request': {
      const action = String(args?.action || '').trim();
      const target = String(args?.target || '').trim();
      if (!action || action.length > 64 || !target || target.length > 256) {
        throw new Error('Invalid approval action or target.');
      }
      const list = Array.isArray(readJsonSafe(APPROVALS_FILE, [])) ? readJsonSafe(APPROVALS_FILE, []) : [];
      const rec = {
        id: crypto.randomUUID(),
        action,
        target,
        reason: String(args?.reason || '').trim().slice(0, 256),
        requested_by: currentSession?.username || 'user',
        status: 'pending',
        decided_by: null,
        created_at: new Date().toISOString(),
        decided_at: null,
      };
      list.push(rec);
      writeJsonSafe(APPROVALS_FILE, list.slice(-500));
      appendAuditEvent({ event: 'approval_request', username: rec.requested_by, target, action, status: 'pending' });
      return rec;
    }

    case 'approval_list': {
      const list = readJsonSafe(APPROVALS_FILE, []);
      return Array.isArray(list) ? [...list].reverse() : [];
    }

    case 'approval_decide': {
      const id = String(args?.id || '').trim();
      const decision = validateSafeToken(String(args?.decision || '').toLowerCase(), /^(?:approved|rejected)$/, 'decision');
      const list = Array.isArray(readJsonSafe(APPROVALS_FILE, [])) ? readJsonSafe(APPROVALS_FILE, []) : [];
      const item = list.find(x => x.id === id);
      if (!item) return null;
      item.status = decision;
      item.decided_by = currentSession?.username || 'admin';
      item.decided_at = new Date().toISOString();
      writeJsonSafe(APPROVALS_FILE, list);
      appendAuditEvent({ event: 'approval_decide', username: item.decided_by, target: item.target, action: item.action, status: decision });
      return item;
    }

    case 'recordings_list': {
      const idxPath = path.join(RECORDINGS_DIR, 'index.json');
      const list = readJsonSafe(idxPath, []);
      return Array.isArray(list) ? [...list].reverse() : [];
    }

    case 'recordings_save': {
      const contentCast = String(args?.content_cast || args?.contentCast || '');
      if (!contentCast || Buffer.byteLength(contentCast, 'utf8') > 10 * 1024 * 1024) {
        throw new Error('Session recording empty or exceeds 10 MiB limit.');
      }
      if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true, mode: 0o700 });
      const id = crypto.randomUUID();
      const castPath = path.join(RECORDINGS_DIR, `${id}.cast`);
      fs.writeFileSync(castPath, contentCast, { encoding: 'utf8', mode: 0o600 });
      const meta = {
        id,
        title: String(args?.title || 'SSH Terminal Recording').trim().slice(0, 128),
        host: String(args?.host || 'unknown').trim().slice(0, 128),
        bytes: Buffer.byteLength(contentCast, 'utf8'),
        created_at: new Date().toISOString(),
      };
      const idxPath = path.join(RECORDINGS_DIR, 'index.json');
      const idx = Array.isArray(readJsonSafe(idxPath, [])) ? readJsonSafe(idxPath, []) : [];
      idx.push(meta);
      writeJsonSafe(idxPath, idx.slice(-200));
      appendAuditEvent({ event: 'recordings_save', username: currentSession?.username || 'user', target: meta.host, bytes: meta.bytes, status: 'ok' });
      return meta;
    }

    case 'recordings_get': {
      const id = validateSafeToken(String(args?.id || '').trim(), /^[a-zA-Z0-9-]{8,64}$/, 'recording id');
      const castPath = path.join(RECORDINGS_DIR, `${id}.cast`);
      if (!fs.existsSync(castPath)) throw new Error('Recording not found.');
      return fs.readFileSync(castPath, 'utf8');
    }

    case 'ssh_rotate_server_key': {
      if (!entry) throw new Error('No active SSH connection.');
      const rawName = String(args?.filename || `id_ed25519_rot_${Date.now()}`).trim();
      const safeName = validateSafeToken(rawName, /^[a-zA-Z0-9._-]{1,64}$/, 'filename');
      const privPath = path.join(KEYS_DIR, safeName);
      const pubPath = `${privPath}.pub`;
      const comment = String(args?.comment || 'sshdesktop-rotated').replace(/[\r\n\0]/g, '').slice(0, 128);
      const passphrase = String(args?.passphrase || '');
      child_process.execFileSync('ssh-keygen', ['-t', 'ed25519', '-C', comment, '-N', passphrase, '-f', privPath], { stdio: 'pipe', timeout: 15000 });
      try { fs.chmodSync(privPath, 0o600); } catch {}
      const pubContent = fs.readFileSync(pubPath, 'utf8').trim();
      let fp = '';
      try { fp = child_process.execFileSync('ssh-keygen', ['-lf', pubPath], { encoding: 'utf8' }).trim().split(/\s+/)[1] || ''; } catch {}
      const installCmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF -- ${shellQuote(pubContent)} ~/.ssh/authorized_keys || printf '%s\\n' ${shellQuote(pubContent)} >> ~/.ssh/authorized_keys)`;
      const instRes = await runRemoteExec(entry.client, installCmd);
      if (instRes.exit_code !== 0) throw new Error(instRes.stderr || 'Failed to install rotated SSH public key');
      const oldPub = String(args?.old_public_key || args?.oldPublicKey || '').trim();
      if (oldPub && oldPub !== pubContent && !/[\r\n\0]/.test(oldPub)) {
        await runRemoteExec(entry.client, `if [ -f ~/.ssh/authorized_keys ]; then grep -vxF -- ${shellQuote(oldPub)} ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys; fi`);
      }
      appendAuditEvent({ event: 'ssh_rotate_server_key', username: currentSession?.username || 'admin', target: safeName, status: 'ok' });
      return { private_key_path: privPath, public_key_path: pubPath, public_key_content: pubContent, fingerprint_sha256: fp };
    }

    case 'audit_get_logs': {
      const limit = validateInt(args?.limit ?? 200, 1, 2000, 'limit');
      if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
      try {
        const lines = fs.readFileSync(AUDIT_LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map(l => {
          try { return JSON.parse(l); } catch { return { raw: l }; }
        });
      } catch {
        return [];
      }
    }

    case 'audit_verify_chain': {
      return verifyAuditChain();
    }

    case 'policy_get_mode': {
      return getSecurityPolicy();
    }

    case 'policy_set_mode': {
      const nextRole = validateSafeToken(args?.role || 'admin', /^(?:admin|operator|read_only)$/, 'role');
      const blockMeta = args?.blockMetadataEgress !== undefined ? Boolean(args.blockMetadataEgress) : getSecurityPolicy().blockMetadataEgress;
      const updated = {
        role: nextRole,
        blockMetadataEgress: blockMeta,
        updatedAt: new Date().toISOString(),
        updatedBy: currentSession?.username || 'admin',
      };
      if (!writeJsonSafe(POLICY_FILE, updated)) {
        throw new Error('Failed to persist security policy.');
      }
      appendAuditEvent({ event: 'policy_set_mode', username: updated.updatedBy, ip: clientIp, role: nextRole, status: 'ok' });
      return updated;
    }

    case 'runtime_capabilities': {
      return {
        runtime: 'web',
        version: VERSION,
        features: {
          desktop_notifications: false,
          native_webview_window: false,
          putty_launch: false,
          keyring_vault: true,
          vault_rotation: true,
          socks5_auth: true,
          local_fs: process.env.SSHDESKTOP_ENABLE_LOCAL_FS === 'true',
          audit_log: true,
          rbac_policy: true,
          config_backup: true,
          mfa_totp: true,
          scoped_api_tokens: true,
          team_management: true,
          command_approvals: true,
          session_recording: true,
          ssh_key_rotation: true,
          oidc_sso: true,
        },
        db_engines: {
          postgresql: false,
          mysql: false,
          mariadb: false,
          sqlite: false,
          mssql: false,
          mongodb: false,
          redis: false,
          oracle: false,
          dynamodb: false,
          cosmos: false,
          cassandra: false,
          db2: false,
        }
      };
    }

    case 'backup_export_config': {
      const conns = readJsonSafe(CONNECTIONS_FILE, []);
      const sanitizedConns = Array.isArray(conns)
        ? conns.map(({ password: _p, passphrase: _pp, private_key_content: _pk, ...meta }) => meta)
        : [];
      const settings = readJsonSafe(SETTINGS_FILE, {});
      const policy = getSecurityPolicy();
      appendAuditEvent({ event: 'backup_export_config', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return {
        schema: 'sshdesktop-config-v1',
        exportedAt: new Date().toISOString(),
        version: VERSION,
        runtime: 'web',
        connections: sanitizedConns,
        settings,
        policy,
      };
    }

    case 'backup_import_config': {
      const payload = args?.bundle;
      if (!payload || payload.schema !== 'sshdesktop-config-v1') {
        throw new Error('Invalid backup bundle schema.');
      }
      if (payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)) {
        writeJsonSafe(SETTINGS_FILE, payload.settings);
      }
      if (Array.isArray(payload.connections)) {
        const existing = readJsonSafe(CONNECTIONS_FILE, []);
        const existingMap = new Map(Array.isArray(existing) ? existing.map(c => [c.id, c]) : []);
        const merged = payload.connections
          .filter(c => c && typeof c.id === 'string' && typeof c.host === 'string')
          .map(c => ({
            ...c,
            // Preserve existing secret references if present; never import plaintext passwords unless explicitly entered
            password: existingMap.get(c.id)?.password,
            passphrase: existingMap.get(c.id)?.passphrase,
          }));
        writeJsonSafe(CONNECTIONS_FILE, merged);
      }
      appendAuditEvent({ event: 'backup_import_config', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return { imported: true };
    }

    // ==========================================
    // 2. SSH Connection Management
    // ==========================================
    case 'ssh_connect': {
      const { config } = args || {};
      if (!config) throw new Error('Missing SSH connection config');
      const targetId = config.id || `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const client = new Client();

      return new Promise((resolve, reject) => {
        let connected = false;
        const connectConfig = buildSshClientConfig(config, targetId);

        client.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
          const pwd = config.password || '';
          finish(prompts.map(() => pwd));
        });

        client.on('ready', async () => {
          connected = true;
          let sftpInstance = null;
          try { sftpInstance = await getSftp(client); } catch (e) {
            console.warn(`SFTP init notice for ${targetId}:`, e.message);
          }
          activeConnections.set(targetId, {
            client,
            sftp: sftpInstance,
            config,
            connectedAt: Date.now()
          });
          resolve(targetId);
        });

        client.on('error', (err) => {
          if (!connected) reject(new Error(`SSH connection failed: ${err.message}`));
        });

        client.on('close', () => {
          activeConnections.delete(targetId);
        });

        client.connect(connectConfig);
      });
    }

    case 'ssh_disconnect': {
      if (activeSocksServers.has(connId)) {
        try { activeSocksServers.get(connId).server.close(); } catch {}
        activeSocksServers.delete(connId);
      }
      for (const [tid, t] of activeTunnels.entries()) {
        if (t.info.conn_id === connId) {
          try { t.server.close(); } catch {}
          activeTunnels.delete(tid);
        }
      }
      if (entry) {
        try { entry.client.end(); } catch {}
        activeConnections.delete(connId);
      }
      return undefined;
    }

    case 'ssh_start_socks5': {
      if (!entry) throw new Error('No active SSH connection');
      const preferred = args?.preferredPort ? Number(args.preferredPort) : 1080;
      const sockUser = args?.username ? String(args.username) : '';
      const sockPass = args?.password ? String(args.password) : '';
      const requireAuth = Boolean(args?.requireAuth);
      if ((sockUser && !sockPass) || (!sockUser && sockPass)) {
        throw new Error('Both username and password are required when configuring SOCKS5 authentication.');
      }
      if (requireAuth && !sockUser) {
        throw new Error('SOCKS5 authentication was requested without credentials.');
      }
      const socksAuth = sockUser ? { username: sockUser, password: sockPass } : null;

      if (activeSocksServers.has(connId)) {
        return activeSocksServers.get(connId).port;
      }

      try {
        const { server, port } = await startSocks5Proxy(entry.client, preferred, socksAuth);
        activeSocksServers.set(connId, { server, port, authEnabled: Boolean(socksAuth) });
        console.log(`[SSH Desktop SOCKS5] Dynamic proxy active on 127.0.0.1:${port} for connection ${connId} (auth=${Boolean(socksAuth)})`);
        return port;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          const { server, port } = await startSocks5Proxy(entry.client, 0, socksAuth);
          activeSocksServers.set(connId, { server, port, authEnabled: Boolean(socksAuth) });
          console.log(`[SSH Desktop SOCKS5] Dynamic proxy active on 127.0.0.1:${port} (fallback, auth=${Boolean(socksAuth)})`);
          return port;
        }
        throw err;
      }
    }

    case 'ssh_stop_socks5': {
      if (activeSocksServers.has(connId)) {
        const socks = activeSocksServers.get(connId);
        try { socks.server.close(); } catch {}
        activeSocksServers.delete(connId);
      }
      return undefined;
    }

    case 'ssh_start_tunnel': {
      if (!entry || !entry.client) throw new Error('No active SSH connection');
      const localPort = parseInt(args?.local_port || args?.localPort || 0, 10);
      const remotePort = parseInt(args?.remote_port || args?.remotePort || 0, 10);
      const remoteHost = args?.remote_host || args?.remoteHost || '127.0.0.1';
      const tunnelType = String(args?.tunnel_type || args?.tunnelType || 'local').toLowerCase();

      if (tunnelType === 'dynamic' || tunnelType === 'socks' || tunnelType === 'socks5') {
        return await handleInvokeCommand('ssh_start_socks5', { ...args, preferredPort: localPort || 1080 }, currentSession, clientIp);
      }

      const tunnelId = `tun-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const server = net.createServer((socket) => {
        socket.on('error', () => { try { socket.destroy(); } catch {} });
        entry.client.forwardOut('127.0.0.1', socket.remotePort || 0, remoteHost, remotePort, (err, stream) => {
          if (err) {
            try { socket.destroy(); } catch {}
            return;
          }
          stream.on('error', () => { try { socket.destroy(); } catch {} });
          socket.pipe(stream).pipe(socket);
        });
      });

      return new Promise((resolve, reject) => {
        server.on('error', (err) => reject(err));
        server.listen(localPort, '127.0.0.1', () => {
          const assignedPort = server.address().port;
          activeTunnels.set(tunnelId, {
            server,
            info: {
              tunnel_id: tunnelId,
              conn_id: connId,
              local_port: assignedPort,
              remote_host: remoteHost,
              remote_port: remotePort,
              created_at: Date.now()
            }
          });
          resolve(assignedPort);
        });
      });
    }

    case 'ssh_stop_tunnel': {
      const tid = args?.tunnel_id || args?.tunnelId;
      if (tid && activeTunnels.has(tid)) {
        try { activeTunnels.get(tid).server.close(); } catch {}
        activeTunnels.delete(tid);
      }
      return true;
    }

    case 'ssh_list_tunnels': {
      const list = [];
      for (const t of activeTunnels.values()) {
        list.push(t.info);
      }
      return list;
    }

    case 'send_desktop_notification': {
      const err = new Error('UNSUPPORTED_IN_WEB_MODE: Native desktop notifications are not available in web server mode.');
      err.code = 'UNSUPPORTED_IN_WEB_MODE';
      err.statusCode = 501;
      throw err;
    }

    case 'ssh_get_socks5': {
      if (activeSocksServers.has(connId)) {
        return activeSocksServers.get(connId).port;
      }
      return null;
    }

    case 'open_browser_window':
    case 'close_browser_window':
    case 'focus_browser_window': {
      const err = new Error(`UNSUPPORTED_IN_WEB_MODE: Native WebView command '${cmd}' is only available in the desktop app.`);
      err.code = 'UNSUPPORTED_IN_WEB_MODE';
      err.statusCode = 501;
      throw err;
    }

    case 'ssh_launch_putty': {
      const err = new Error('UNSUPPORTED_IN_WEB_MODE: Launching local PuTTY is not supported in web server mode.');
      err.code = 'UNSUPPORTED_IN_WEB_MODE';
      err.statusCode = 501;
      throw err;
    }

    case 'ssh_test_connection': {
      const { config } = args || {};
      if (!config) return false;
      const client = new Client();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { client.end(); } catch {}
          resolve(false);
        }, 12000);
        client.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
          const pwd = config.password || '';
          finish(prompts.map(() => pwd));
        });
        client.on('ready', () => {
          clearTimeout(timer);
          try { client.end(); } catch {}
          resolve(true);
        });
        client.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        const connectConfig = buildSshClientConfig(config, 'test');
        try { client.connect(connectConfig); } catch { resolve(false); }
      });
    }

    case 'ssh_list_connections': {
      const list = [];
      for (const [id, val] of activeConnections.entries()) {
        list.push({
          id,
          host: val.config?.host,
          port: val.config?.port,
          username: val.config?.username,
          connected_at: val.connectedAt
        });
      }
      return list;
    }

    case 'ssh_get_user_privilege': {
      if (!entry) {
        const localUser = process.env.USER || process.env.LOGNAME || (typeof os.userInfo === 'function' ? os.userInfo().username : 'root') || 'root';
        const localHome = os.homedir() || (localUser === 'root' ? '/root' : `/home/${localUser}`);
        const isRoot = localUser === 'root' || (typeof process.getuid === 'function' && process.getuid() === 0);
        return {
          username: localUser,
          uid: isRoot ? 0 : 1000,
          gid: isRoot ? 0 : 1000,
          home_dir: localHome,
          is_root: isRoot,
          has_sudo: isRoot,
          sudo_type: isRoot ? 'root' : 'none',
          groups: [localUser]
        };
      }
      const script = "id -u; id -un; id -Gn; echo \"$HOME\"; sudo -n true 2>/dev/null && echo 'SUDO_OK' || echo 'SUDO_NO'";
      const res = await runRemoteExec(entry.client, script, 8000);
      const lines = res.stdout.trim().split('\n').map(s => s.trim());
      const uid = parseInt(lines[0] || '0', 10);
      const username = lines[1] || entry?.config?.username || 'root';
      const groups = (lines[2] || '').split(' ').filter(Boolean);
      const detectedHome = lines[3] || (uid === 0 || username === 'root' ? '/root' : `/home/${username}`);
      const isRoot = uid === 0 || username === 'root';

      let hasSudo = isRoot;
      let sudoType = isRoot ? 'root' : 'none';

      if (isRoot) {
        hasSudo = true;
        sudoType = 'root';
      } else if (lines[4] === 'SUDO_OK') {
        hasSudo = true;
        sudoType = 'passwordless';
      } else {
        // Test password sudo if session has password (via stdin, never CLI arguments)
        const pwd = entry?.config?.password;
        if (pwd && typeof pwd === 'string' && pwd.length > 0 && !pwd.includes('\n') && !pwd.includes('\r')) {
          const testPwdCmd = `sudo -S -k -p '' true 2>&1`;
          const pwdRes = await runRemoteExecWithStdin(entry.client, testPwdCmd, `${pwd}\n`, 8000);
          if (pwdRes.exit_code === 0) {
            hasSudo = true;
            sudoType = 'password';
          }
        }

        // If not verified via password test yet, check if member of standard sudo groups
        if (!hasSudo) {
          const isSudoMember = groups.some(g => {
            const lower = g.toLowerCase();
            return lower === 'sudo' || lower === 'wheel' || lower === 'admin';
          });
          if (isSudoMember) {
            hasSudo = true;
            sudoType = 'password';
          }
        }
      }

      const info = {
        username,
        uid: isRoot ? 0 : uid,
        gid: isRoot ? 0 : uid,
        home_dir: detectedHome,
        is_root: isRoot,
        has_sudo: hasSudo,
        sudo_type: sudoType,
        groups
      };

      entry.privilege = info;
      return info;
    }

    // ==========================================
    // 3. Remote Command Execution
    // ==========================================
    case 'ssh_exec': {
      const { command } = args || {};
      const cmdStr = (command || '').trim();
      if (!entry || !entry.client) {
        return {
          stdout: '',
          stderr: 'No active SSH connection available. Please connect to a server first.',
          exit_code: -1,
          duration_ms: 0
        };
      }
      const needsPriv = cmdStr.startsWith('sudo ') || cmdStr.includes(' sudo ') || cmdStr.includes('| sudo ');
      if (needsPriv && entry) {
        return await runRemotePrivExec(entry, cmdStr);
      }
      const directRes = await runRemoteExec(entry?.client, cmdStr);
      const isPermDenial = directRes.exit_code !== 0 && (
        (directRes.stdout + '\n' + directRes.stderr).includes('Interactive authentication required') ||
        (directRes.stdout + '\n' + directRes.stderr).includes('Permission denied') ||
        (directRes.stdout + '\n' + directRes.stderr).includes('Access denied') ||
        (directRes.stdout + '\n' + directRes.stderr).includes('Operation not permitted') ||
        (directRes.stdout + '\n' + directRes.stderr).includes('must be root') ||
        (directRes.stdout + '\n' + directRes.stderr).includes('You need to be root')
      );
      if (isPermDenial && entry) {
        const privRes = await runRemotePrivExec(entry, cmdStr);
        if (privRes.exit_code === 0 || privRes.stdout.trim().length > 0) {
          return privRes;
        }
      }
      return directRes;
    }

    // ==========================================
    // 4. System Monitor & Telemetry
    // ==========================================
    case 'system_get_stats': {
      if (!entry) {
        // Fallback local stats when no remote host is selected yet
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const load = os.loadavg();
        return {
          cpu_percent: [0.0],
          cpu_user: 0.0,
          cpu_system: 0.0,
          cpu_idle: 100.0,
          ram_total: totalMem,
          ram_used: usedMem,
          ram_free: freeMem,
          ram_cached: 0,
          swap_total: 0,
          swap_used: 0,
          load_avg: [load[0], load[1], load[2]],
          uptime_seconds: Math.floor(os.uptime()),
          hostname: os.hostname(),
          os_name: os.type(),
          os_version: os.release(),
          kernel: os.version() || 'Linux',
          arch: os.arch(),
          cpu_model: os.cpus()[0]?.model || 'Generic CPU',
          cpu_cores: os.cpus().length || 1
        };
      }

      const probeCmd = `
STAT1=$(grep '^cpu ' /proc/stat 2>/dev/null)
sleep 0.2
STAT2=$(grep '^cpu ' /proc/stat 2>/dev/null)
echo "===CPUDELTA==="
echo "$STAT1"
echo "$STAT2"
echo "===LOAD==="
cat /proc/loadavg 2>/dev/null || uptime 2>/dev/null || echo "0 0 0"
echo "===UPTIME==="
cat /proc/uptime 2>/dev/null || echo "0"
echo "===MEM==="
cat /proc/meminfo 2>/dev/null || free -b 2>/dev/null
echo "===CPUINFO==="
nproc 2>/dev/null || grep -c '^processor' /proc/cpuinfo 2>/dev/null || echo "1"
grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 | sed -e 's/^[ \\t]*//' || echo "Generic CPU"
echo "===UNAME==="
uname -n 2>/dev/null || echo "linux-server"
uname -r 2>/dev/null || echo "Linux"
uname -m 2>/dev/null || echo "x86_64"
echo "===OS==="
grep -E '^(NAME|VERSION|PRETTY_NAME)=' /etc/os-release 2>/dev/null || echo "NAME=Linux"
echo "===END==="
`;
      const res = await runRemoteExec(entry.client, probeCmd, 10000);
      const lines = res.stdout.split('\n');
      const sections = {};
      let curSec = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('===') && trimmed.endsWith('===') && trimmed.length > 6) {
          curSec = trimmed.substring(3, trimmed.length - 3);
          sections[curSec] = [];
          continue;
        }
        if (curSec) {
          sections[curSec].push(line);
        }
      }

      // Calculate CPU % from delta
      let cpuPercent = [0.0];
      let cpuUser = 0.0;
      let cpuSystem = 0.0;
      let cpuIdle = 100.0;

      if (sections['CPUDELTA'] && sections['CPUDELTA'].length >= 2) {
        const parseCpu = (str) => str.trim().split(/\s+/).slice(1).map(Number);
        const v1 = parseCpu(sections['CPUDELTA'][0] || '');
        const v2 = parseCpu(sections['CPUDELTA'][1] || '');
        if (v1.length >= 4 && v2.length >= 4) {
          const tot1 = v1.reduce((a, b) => a + b, 0);
          const tot2 = v2.reduce((a, b) => a + b, 0);
          const dTot = tot2 - tot1;
          if (dTot > 0) {
            const u1 = v1[0] + (v1[1] || 0);
            const u2 = v2[0] + (v2[1] || 0);
            const s1 = (v1[2] || 0) + (v1[5] || 0) + (v1[6] || 0);
            const s2 = (v2[2] || 0) + (v2[5] || 0) + (v2[6] || 0);
            const i1 = (v1[3] || 0) + (v1[4] || 0);
            const i2 = (v2[3] || 0) + (v2[4] || 0);

            cpuUser = Math.min(100, Math.max(0, ((u2 - u1) / dTot) * 100));
            cpuSystem = Math.min(100, Math.max(0, ((s2 - s1) / dTot) * 100));
            const usage = Math.min(100, Math.max(0, ((dTot - (i2 - i1)) / dTot) * 100));
            cpuIdle = Math.min(100, Math.max(0, 100 - usage));
            cpuPercent = [parseFloat(usage.toFixed(1))];
          }
        }
      }

      // Load average
      let loadAvg = [0.0, 0.0, 0.0];
      if (sections['LOAD'] && sections['LOAD'][0]) {
        const parts = sections['LOAD'][0].trim().split(/\s+/);
        loadAvg = [parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0];
      }

      // Uptime
      let uptime = 0;
      if (sections['UPTIME'] && sections['UPTIME'][0]) {
        uptime = Math.floor(parseFloat(sections['UPTIME'][0].split(' ')[0]) || 0);
      }

      // Memory info
      let ramTotal = 0, ramFree = 0, ramAvail = 0, ramCached = 0, swapTotal = 0, swapFree = 0;
      if (sections['MEM']) {
        for (const m of sections['MEM']) {
          const [k, v] = m.split(':');
          if (!k || !v) continue;
          const val = parseInt(v.trim().split(' ')[0], 10) * 1024;
          if (k.includes('MemTotal')) ramTotal = val;
          if (k.includes('MemFree')) ramFree = val;
          if (k.includes('MemAvailable')) ramAvail = val;
          if (k.includes('Cached') && !k.includes('SwapCached')) ramCached = val;
          if (k.includes('SwapTotal')) swapTotal = val;
          if (k.includes('SwapFree')) swapFree = val;
        }
      }
      const ramUsed = Math.max(0, ramTotal - (ramAvail || ramFree));
      const swapUsed = Math.max(0, swapTotal - swapFree);

      // CPU info
      const cores = parseInt(sections['CPUINFO']?.[0] || '1', 10) || 1;
      const model = sections['CPUINFO']?.[1]?.trim() || 'Generic CPU';

      // Uname
      const hostname = sections['UNAME']?.[0]?.trim() || 'linux-server';
      const kernel = sections['UNAME']?.[1]?.trim() || 'Linux';
      const arch = sections['UNAME']?.[2]?.trim() || 'x86_64';

      // OS Name
      let osName = 'Linux';
      let osVersion = '';
      if (sections['OS']) {
        for (const o of sections['OS']) {
          if (o.startsWith('PRETTY_NAME=')) osName = o.split('=')[1].replace(/"/g, '');
          if (o.startsWith('VERSION=')) osVersion = o.split('=')[1].replace(/"/g, '');
        }
      }

      return {
        cpu_percent: cpuPercent,
        cpu_user: parseFloat(cpuUser.toFixed(1)),
        cpu_system: parseFloat(cpuSystem.toFixed(1)),
        cpu_idle: parseFloat(cpuIdle.toFixed(1)),
        ram_total: ramTotal,
        ram_used: ramUsed,
        ram_free: ramAvail || ramFree,
        ram_cached: ramCached,
        swap_total: swapTotal,
        swap_used: swapUsed,
        load_avg: loadAvg,
        uptime_seconds: uptime,
        hostname,
        os_name: osName,
        os_version: osVersion,
        kernel,
        arch,
        cpu_model: model,
        cpu_cores: cores
      };
    }

    case 'system_get_disks':
    case 'disk_usage': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'df -B1 -P -x tmpfs -x devtmpfs -x squashfs 2>/dev/null', 8000);
      const disks = [];
      const lines = res.stdout.trim().split('\n').slice(1);
      for (const line of lines) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 6) {
          disks.push({
            filesystem: p[0],
            total: parseInt(p[1], 10) || 0,
            used: parseInt(p[2], 10) || 0,
            available: parseInt(p[3], 10) || 0,
            percent: parseFloat((p[4] || '0').replace('%', '')) || 0,
            mount_point: p[5]
          });
        }
      }
      return disks;
    }

    case 'system_get_network': {
      if (!entry) return [];
      const probeScript = `
ip -o link show 2>/dev/null
echo '---ADDR---'
ip -o addr show 2>/dev/null
echo '---NETDEV---'
cat /proc/net/dev 2>/dev/null
echo '---PUBLIC_IP---'
curl -4s --connect-timeout 2 https://api.ipify.org 2>/dev/null || curl -4s --connect-timeout 2 https://ifconfig.me 2>/dev/null || curl -4s --connect-timeout 2 https://icanhazip.com 2>/dev/null || echo ''
`;
      const res = await runRemoteExec(entry.client, probeScript, 8000);
      const parts = res.stdout.split(/---(?:ADDR|NETDEV|PUBLIC_IP)---/);
      const linkSection = parts[0] || '';
      const addrSection = parts[1] || '';
      const devSection = parts[2] || '';
      let detectedPublicIp = (parts[3] || '').trim().split('\n')[0].trim();

      // If remote curl didn't return public IP, check if host is an external IP
      if (!detectedPublicIp && entry.config?.host) {
        const host = String(entry.config.host).trim();
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && !host.startsWith('127.') && !host.startsWith('10.') && !host.startsWith('192.168.')) {
          detectedPublicIp = host;
        }
      }

      // 1. Parse link info (MAC, State, MTU)
      const linkMap = {};
      for (const line of linkSection.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const nameMatch = trimmed.match(/^\d+:\s+([^:@\s]+)/);
        if (!nameMatch) continue;
        const iface = nameMatch[1];

        // Real MAC address
        let mac = '—';
        const macMatch = trimmed.match(/link\/(?:ether|loopback|ieee802\.11)\s+([0-9a-fA-F:]{17})/);
        if (macMatch) {
          mac = macMatch[1].toUpperCase();
        }

        // Real State
        let state = 'UNKNOWN';
        const stateMatch = trimmed.match(/\sstate\s+([A-Z_]+)/);
        if (stateMatch) {
          state = stateMatch[1];
        } else if (trimmed.includes('<UP') || trimmed.includes(',UP,') || trimmed.includes(',UP>')) {
          state = 'UP';
        }

        // Real MTU
        let mtu = 1500;
        const mtuMatch = trimmed.match(/\smtu\s+(\d+)/);
        if (mtuMatch) mtu = parseInt(mtuMatch[1], 10);

        linkMap[iface] = { mac, state, mtu };
      }

      // 2. Parse IPv4 and IPv6 addresses
      const ipv4Map = {};
      const ipv6Map = {};
      for (const line of addrSection.split('\n')) {
        const t = line.trim().split(/\s+/);
        if (t.length >= 4) {
          const iface = (t[1] || '').replace(':', '');
          const proto = t[2];
          const cidr = t[3];
          if (proto === 'inet' && !ipv4Map[iface]) {
            ipv4Map[iface] = cidr;
          } else if (proto === 'inet6' && (!ipv6Map[iface] || ipv6Map[iface].startsWith('fe80::'))) {
            ipv6Map[iface] = cidr;
          }
        }
      }

      // 3. Parse /proc/net/dev for RX and TX bytes
      const ifaces = [];
      const seen = new Set();

      if (devSection) {
        for (const line of devSection.split('\n')) {
          if (!line.includes(':')) continue;
          const [namePart, dataPart] = line.split(':');
          const name = namePart.trim();
          seen.add(name);
          const d = dataPart.trim().split(/\s+/);
          const linkInfo = linkMap[name] || {};
          const ipv4Cidr = ipv4Map[name] || (name === 'lo' ? '127.0.0.1/8' : '—');
          const ipv4Only = ipv4Cidr.split('/')[0];
          const ipv6 = ipv6Map[name] || (name === 'lo' ? '::1/128' : '—');

          ifaces.push({
            name,
            ip: ipv4Only,
            ipv4: ipv4Cidr,
            ipv6,
            mac: linkInfo.mac || (name === 'lo' ? '00:00:00:00:00:00' : '—'),
            state: linkInfo.state || (name === 'lo' ? 'UP' : 'UNKNOWN'),
            mtu: linkInfo.mtu || (name === 'lo' ? 65536 : 1500),
            rx_bytes: parseInt(d[0], 10) || 0,
            tx_bytes: parseInt(d[8], 10) || 0,
            public_ip: detectedPublicIp || ''
          });
        }
      }

      // Include any link devices that had no netdev line
      for (const [name, linkInfo] of Object.entries(linkMap)) {
        if (!seen.has(name)) {
          const ipv4Cidr = ipv4Map[name] || '—';
          ifaces.push({
            name,
            ip: ipv4Cidr.split('/')[0],
            ipv4: ipv4Cidr,
            ipv6: ipv6Map[name] || '—',
            mac: linkInfo.mac || '—',
            state: linkInfo.state || 'UNKNOWN',
            mtu: linkInfo.mtu || 1500,
            rx_bytes: 0,
            tx_bytes: 0,
            public_ip: detectedPublicIp || ''
          });
        }
      }

      return ifaces;
    }

    // ==========================================
    // 5. Process Manager
    // ==========================================
    case 'process_list': {
      if (!entry) return [];
      const res = await runRemoteExec(
        entry.client,
        'ps -eo user:20,pid,ppid,pcpu,pmem,vsz,rss,stat,time,start_time,nlwp,args --sort=-%cpu --no-header 2>/dev/null | head -n 120',
        8000
      );
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 11) {
          const pid = parseInt(p[1], 10) || 0;
          if (pid > 0) {
            list.push({
              user: p[0],
              pid,
              ppid: parseInt(p[2], 10) || 0,
              cpu_percent: parseFloat(p[3]) || 0,
              mem_percent: parseFloat(p[4]) || 0,
              vsz: (parseInt(p[5], 10) || 0) * 1024,
              rss: (parseInt(p[6], 10) || 0) * 1024,
              status: p[7],
              cpu_time: p[8],
              start_time: p[9],
              threads: parseInt(p[10], 10) || 1,
              command: p.slice(11).join(' '),
              name: p[11].split('/').pop().replace(/^-/, '')
            });
          }
        }
      }
      return list;
    }

    case 'process_kill': {
      if (!entry) return;
      const pid = validateInt(args?.pid, 2, 4194304, 'PID');
      const rawSig = args?.signal ?? 9;
      const sig = typeof rawSig === 'number'
        ? validateInt(rawSig, 1, 64, 'signal')
        : validateSafeToken(rawSig, /^(?:[1-9]|[1-5]\d|6[0-4]|SIG[A-Z0-9]+|[A-Z0-9]+)$/, 'signal');
      const expRaw = String(args?.expectedName || args?.expected_name || '').trim();
      const expBase = expRaw ? expRaw.split('/').pop()?.trim() : '';
      let cmd = `kill -${sig} ${pid}`;
      if (expBase && expBase.length <= 128 && !/[\x00-\x1f\x7f]/.test(expBase)) {
        const qExp = shellQuote(expBase);
        cmd = `ACTUAL_COMM=$(ps -p ${pid} -o comm= 2>/dev/null | head -n1 | xargs); ` +
          `if [ -z "$ACTUAL_COMM" ]; then echo 'PROCESS_IDENTITY_MISMATCH: PID ${pid} is no longer running.' >&2; exit 6; fi; ` +
          `if [ "$ACTUAL_COMM" != ${qExp} ] && ! echo "$ACTUAL_COMM" | grep -qF -- ${qExp}; then ` +
          `echo "PROCESS_IDENTITY_MISMATCH: PID ${pid} now belongs to '$ACTUAL_COMM' (expected ${expBase})." >&2; exit 6; fi && kill -${sig} ${pid}`;
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) {
        throw new Error(res.stderr || res.stdout || `Failed to signal PID ${pid}`);
      }
      appendAuditEvent({ event: 'process_kill', username: currentSession?.username || '', ip: clientIp, target: `pid:${pid}`, signal: String(sig), status: 'ok' });
      return;
    }

    case 'process_renice': {
      if (!entry) return;
      const pid = validateInt(args?.pid, 1, 4194304, 'PID');
      const prio = validateInt(args?.priority ?? 0, -20, 20, 'priority');
      await runRemotePrivExec(entry, `renice ${prio} -p ${pid}`);
      return;
    }

    // ==========================================
    // 6. Systemd Services
    // ==========================================
    case 'service_list': {
      if (!entry) return [];
      const res = await runRemoteExec(
        entry.client,
        "systemctl daemon-reload 2>/dev/null; systemctl list-units --type=service --all --no-pager --plain 2>/dev/null; echo '---FILES---'; systemctl list-unit-files --type=service --all --no-pager --plain 2>/dev/null",
        15000
      );
      const [unitsOut, filesOut] = res.stdout.split('---FILES---');
      const filesMap = new Map();

      if (filesOut) {
        for (const l of filesOut.split('\n')) {
          const p = l.trim().split(/\s+/);
          if (p.length >= 2 && p[0].endsWith('.service')) {
            const isEnabled = p[1] === 'enabled' || p[1] === 'static' || p[1] === 'enabled-runtime';
            filesMap.set(p[0], { enabled: isEnabled, state: p[1] });
          }
        }
      }

      const services = [];
      const seen = new Set();

      if (unitsOut) {
        for (const l of unitsOut.split('\n')) {
          const trimmed = l.trim();
          if (!trimmed || trimmed.startsWith('LOAD') || trimmed.startsWith('To show') || trimmed.startsWith('Legend:') || trimmed.startsWith('loaded units listed')) continue;
          let p = trimmed.split(/\s+/);
          if (p[0] === '●' || p[0] === '*') {
            p = p.slice(1);
          }
          if (p.length >= 4 && p[0].endsWith('.service')) {
            const name = p[0];
            seen.add(name);
            const fileInfo = filesMap.get(name);
            services.push({
              name,
              load_state: p[1],
              active_state: p[2],
              sub_state: p[3],
              description: p.length > 4 ? p.slice(4).join(' ') : name,
              enabled: fileInfo ? fileInfo.enabled : false
            });
          }
        }
      }

      // Add installed unit files that are not yet loaded in systemd memory (e.g. newly installed packages)
      for (const [name, fileInfo] of filesMap.entries()) {
        if (!seen.has(name) && !name.includes('@.') && fileInfo.state !== 'alias') {
          seen.add(name);
          services.push({
            name,
            load_state: 'loaded',
            active_state: 'inactive',
            sub_state: 'dead',
            description: name.replace(/\.service$/, ''),
            enabled: fileInfo.enabled
          });
        }
      }

      services.sort((a, b) => a.name.localeCompare(b.name));
      return services;
    }

    case 'service_action': {
      if (!entry) return '';
      const { action, name, serviceName } = args || {};
      const allowedActions = ['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask'];
      const safeAction = String(action || '').toLowerCase().trim();
      if (!allowedActions.includes(safeAction)) throw new Error('Invalid service action');
      const target = validateSafeToken(name || serviceName, /^[A-Za-z0-9@._:-]+$/, 'service name');
      const res = await runRemotePrivExec(entry, `systemctl ${safeAction} ${shellQuote(target)} 2>&1`);
      return res.stdout || res.stderr || 'Success';
    }

    case 'service_status': {
      if (!entry) return '';
      const target = validateSafeToken(args?.name || args?.serviceName, /^[A-Za-z0-9@._:-]+$/, 'service name');
      const res = await runRemoteExec(entry.client, `systemctl status ${shellQuote(target)} --no-pager 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'service_logs': {
      if (!entry) return '';
      const target = validateSafeToken(args?.name || args?.serviceName, /^[A-Za-z0-9@._:-]+$/, 'service name');
      const lines = validateInt(args?.lines ?? 100, 1, 10000, 'lines');
      const res = await runRemoteExec(entry.client, `journalctl -u ${shellQuote(target)} -n ${lines} --no-pager 2>&1`);
      return res.stdout || res.stderr;
    }

    // ==========================================
    // 7. System Logs
    // ==========================================
    case 'logs_journal': {
      if (!entry) return '';
      const lines = validateInt(args?.lines ?? 100, 1, 10000, 'lines');
      const unit = args?.unit ? `-u ${shellQuote(validateSafeToken(args.unit, /^[A-Za-z0-9@._:-]+$/, 'unit'))}` : '';
      const res = await runRemoteExec(entry.client, `journalctl --no-pager -n ${lines} ${unit} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'logs_file': {
      if (!entry) return '';
      const lines = validateInt(args?.lines ?? 100, 1, 10000, 'lines');
      if (!args?.path || typeof args.path !== 'string') throw new Error('Invalid log file path');
      const res = await runRemoteExec(entry.client, `tail -n ${lines} -- ${shellQuote(args.path)} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'logs_dmesg': {
      if (!entry) return '';
      const lines = validateInt(args?.lines ?? 100, 1, 10000, 'lines');
      const res = await runRemoteExec(entry.client, `dmesg -T 2>/dev/null | tail -n ${lines}`);
      return res.stdout || res.stderr;
    }

    // ==========================================
    // 8. Network & Listening Ports
    // ==========================================
    case 'network_ports': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'ss -tunlp 2>/dev/null || netstat -tunlp 2>/dev/null', 8000);
      const list = [];
      for (const line of res.stdout.split('\n').slice(1)) {
        const p = line.trim().split(/\s+/);
        if (p.length < 4) continue;
        const proto = p[0].toUpperCase().includes('UDP') ? 'UDP' : 'TCP';
        const local = p.find(c => c.includes(':'));
        if (!local) continue;
        const colIdx = local.lastIndexOf(':');
        const port = parseInt(local.substring(colIdx + 1), 10);
        if (!port) continue;
        const addr = local.substring(0, colIdx).replace(/[\[\]]/g, '');

        let pid = null;
        let procName = null;
        const procMatch = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
        if (procMatch) {
          procName = procMatch[1];
          pid = parseInt(procMatch[2], 10);
        }

        list.push({
          protocol: proto,
          local_addr: addr,
          local_port: port,
          pid,
          process_name: procName
        });
      }
      return list;
    }

    case 'network_connections': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'ss -tunp 2>/dev/null || netstat -tunp 2>/dev/null', 8000);
      const list = [];
      for (const line of res.stdout.split('\n').slice(1)) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 5) {
          list.push({
            protocol: p[0].toUpperCase(),
            local_addr: p[3] || '',
            remote_addr: p[4] || '',
            state: p[1] || 'ESTABLISHED',
            pid: null
          });
        }
      }
      return list;
    }

    case 'network_ping': {
      if (!entry) return '';
      const host = validateSafeToken(args?.host, /^[A-Za-z0-9._:-]+$/, 'host');
      const res = await runRemoteExec(entry.client, `ping -c 4 -- ${shellQuote(host)} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'network_dns_lookup': {
      if (!entry) return '';
      const host = validateSafeToken(args?.host, /^[A-Za-z0-9._:-]+$/, 'host');
      const qHost = shellQuote(host);
      const res = await runRemoteExec(entry.client, `nslookup -- ${qHost} 2>&1 || host -- ${qHost} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'network_kill_port': {
      if (!entry) return '';
      const port = validateInt(args?.port, 1, 65535, 'port');
      const res = await runRemotePrivExec(entry, `fuser -k ${port}/tcp 2>/dev/null || (lsof -i :${port} -t | xargs -r kill -9)`);
      return res.stdout || 'Port killed';
    }

    // ==========================================
    // 9. Firewall
    // ==========================================
    case 'firewall_detect_backend': {
      if (!entry) return 'none';
      const res = await runRemoteExec(
        entry.client,
        "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi"
      );
      return res.stdout.trim().toLowerCase() || 'none';
    }

    case 'firewall_status': {
      if (!entry) {
        return {
          backend: 'none',
          installed: false,
          active: false,
          ufw_installed: false,
          ufw_active: false,
          firewalld_installed: false,
          firewalld_active: false,
          default_incoming: 'deny',
          default_outgoing: 'allow',
          default_routed: 'deny',
          active_zone: null,
          all_zones: [],
          raw_status: ''
        };
      }
      const res = await runRemotePrivExec(entry, 'ufw status verbose 2>&1 || firewall-cmd --state 2>&1');
      const out = res.stdout.toLowerCase();
      const isActive = out.includes('status: active') || out.includes('running');
      return {
        backend: out.includes('ufw') ? 'ufw' : 'firewalld',
        installed: true,
        active: isActive,
        ufw_installed: out.includes('ufw'),
        ufw_active: isActive,
        firewalld_installed: out.includes('firewall-cmd'),
        firewalld_active: false,
        default_incoming: 'deny',
        default_outgoing: 'allow',
        default_routed: 'deny',
        active_zone: null,
        all_zones: [],
        raw_status: res.stdout
      };
    }

    case 'firewall_rules': {
      if (!entry) return [];
      const res = await runRemotePrivExec(entry, 'ufw status numbered 2>/dev/null || iptables -L -n --line-numbers 2>/dev/null');
      const rules = [];
      for (const line of res.stdout.split('\n')) {
        const m = line.match(/^\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT)?\s*(.*)$/i);
        if (m) {
          rules.push({
            id: `rule-${m[1]}`,
            number: parseInt(m[1], 10),
            to_port: m[2],
            action: m[3].toUpperCase(),
            direction: m[4] ? m[4].toUpperCase() : 'IN',
            from_ip: m[5]?.trim() || 'Anywhere',
            protocol: m[2].includes('udp') ? 'udp' : 'tcp',
            comment: ''
          });
        }
      }
      return rules;
    }

    case 'firewall_add_rule': {
      if (!entry) return '';
      const port = validateInt(args?.port || args?.to_port, 1, 65535, 'port');
      const proto = validateSafeToken(args?.protocol || 'tcp', /^(?:tcp|udp|any)$/i, 'protocol').toLowerCase();
      const action = validateSafeToken(args?.action || 'allow', /^(?:allow|deny|reject|limit)$/i, 'action').toLowerCase();
      const targetSpec = proto === 'any' ? String(port) : `${port}/${proto}`;
      const res = await runRemotePrivExec(entry, `ufw ${action} ${targetSpec} 2>&1`);
      return res.stdout || 'Rule added';
    }

    case 'firewall_delete_rule': {
      if (!entry) return '';
      const num = validateInt(args?.number, 1, 100000, 'rule number');
      const res = await runRemotePrivExec(entry, `ufw --force delete ${num} 2>&1`);
      return res.stdout || 'Rule deleted';
    }

    case 'firewall_toggle': {
      if (!entry) return '';
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = (detectRes.stdout || '').trim().toLowerCase();
      const enable = Boolean(args?.enable);
      let cmd = '';
      if (fw.includes('ufw')) {
        cmd = enable ? 'ufw --force enable 2>&1 && ufw status | head -n 1' : 'ufw disable 2>&1 && ufw status | head -n 1';
      } else if (fw.includes('firewalld')) {
        cmd = enable ? 'systemctl enable --now firewalld 2>&1 && firewall-cmd --state 2>&1' : 'systemctl stop firewalld 2>&1 && (firewall-cmd --state 2>&1 || echo "not running")';
      } else if (fw.includes('nftables')) {
        cmd = enable ? 'systemctl enable --now nftables 2>&1 && systemctl is-active nftables 2>&1 && nft list tables 2>&1' : 'systemctl stop nftables 2>&1 && (systemctl is-active nftables 2>&1 || true)';
      } else if (fw.includes('iptables')) {
        cmd = enable
          ? 'if systemctl list-unit-files iptables.service >/dev/null 2>&1; then systemctl enable --now iptables 2>&1 && systemctl is-active iptables 2>&1; elif systemctl list-unit-files netfilter-persistent.service >/dev/null 2>&1; then systemctl enable --now netfilter-persistent 2>&1 && systemctl is-active netfilter-persistent 2>&1; else echo "Raw iptables has no unified service daemon." >&2; exit 1; fi'
          : 'if systemctl list-unit-files iptables.service >/dev/null 2>&1; then systemctl stop iptables 2>&1 && (systemctl is-active iptables 2>&1 || true); elif systemctl list-unit-files netfilter-persistent.service >/dev/null 2>&1; then systemctl stop netfilter-persistent 2>&1 && (systemctl is-active netfilter-persistent 2>&1 || true); else echo "Raw iptables cannot be safely disabled via service stop." >&2; exit 1; fi';
      } else {
        throw new Error('No supported firewall backend (ufw, firewalld, nftables, iptables) is installed.');
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to toggle firewall');
      const lowOut = String(res.stdout || '').toLowerCase();
      const verified =
        (fw.includes('ufw') && (enable ? lowOut.includes('status: active') : lowOut.includes('inactive'))) ||
        (fw.includes('firewalld') && (enable ? (lowOut.includes('running') && !lowOut.includes('not running')) : lowOut.includes('not running'))) ||
        ((fw.includes('nftables') || fw.includes('iptables')) && (enable ? lowOut.split(/\r?\n/).some(l => l.trim() === 'active') : !lowOut.split(/\r?\n/).some(l => l.trim() === 'active')));
      if (!verified) {
        throw new Error(`Firewall '${fw}' toggle did not verify expected ${enable ? 'active' : 'inactive'} state: ${res.stdout}`);
      }
      appendAuditEvent({ event: 'firewall_toggle', username: currentSession?.username || '', ip: clientIp, backend: fw, enable, status: 'ok' });
      return res.stdout || 'Firewall toggled';
    }

    case 'firewall_reload': {
      if (!entry) return '';
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = (detectRes.stdout || '').trim().toLowerCase();
      let cmd = '';
      if (fw.includes('firewalld')) cmd = 'firewall-cmd --reload 2>&1 && firewall-cmd --state 2>&1';
      else if (fw.includes('ufw')) cmd = 'ufw reload 2>&1 && ufw status | head -n 1';
      else if (fw.includes('nftables')) cmd = 'nft -c -f /etc/nftables.conf 2>&1 && systemctl reload nftables 2>&1 && systemctl is-active nftables 2>&1';
      else if (fw.includes('iptables')) cmd = 'if command -v netfilter-persistent >/dev/null 2>&1; then netfilter-persistent reload 2>&1; elif systemctl list-unit-files iptables.service >/dev/null 2>&1; then systemctl reload iptables 2>&1; else echo "No persistent iptables reload helper found." >&2; exit 1; fi';
      else throw new Error('No supported firewall backend is installed on this host.');
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to reload firewall');
      appendAuditEvent({ event: 'firewall_reload', username: currentSession?.username || '', ip: clientIp, backend: fw, status: 'ok' });
      return res.stdout || 'Reloaded';
    }

    // ==========================================
    // 10. Package Manager & Advanced Firewall
    // ==========================================
    case 'firewall_add_rule_advanced': {
      if (!entry) return '';
      const payload = args?.payload || args || {};
      const port = validateInt(payload.port || payload.to_port, 1, 65535, 'port');
      const proto = validateSafeToken(payload.protocol || 'tcp', /^(?:tcp|udp|any)$/i, 'protocol').toLowerCase();
      const action = validateSafeToken(payload.action || 'allow', /^(?:allow|deny|reject|limit)$/i, 'action').toLowerCase();
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = payload.backend ? validateSafeToken(payload.backend, /^(?:ufw|firewalld|iptables|nftables)$/i, 'backend').toLowerCase() : (detectRes.stdout || '').trim().toLowerCase();
      let cmd = '';
      if (fw.includes('ufw')) {
        cmd = `${proto === 'any' ? `ufw ${action} ${port}` : `ufw ${action} ${port}/${proto}`} 2>&1 && ufw status | head -n 15 2>&1`;
      } else if (fw.includes('firewalld')) {
        if (action !== 'allow') throw new Error(`firewalld port rule helper only supports 'allow'; use rich rules for '${action}'.`);
        cmd = proto === 'any'
          ? `firewall-cmd --permanent --add-port=${port}/tcp 2>&1 && firewall-cmd --permanent --add-port=${port}/udp 2>&1 && firewall-cmd --reload 2>&1 && firewall-cmd --list-ports 2>&1`
          : `firewall-cmd --permanent --add-port=${port}/${proto} 2>&1 && firewall-cmd --reload 2>&1 && firewall-cmd --list-ports 2>&1`;
      } else if (fw.includes('iptables')) {
        const target = action === 'allow' ? 'ACCEPT' : action === 'reject' ? 'REJECT' : 'DROP';
        const ipProto = proto === 'any' ? 'tcp' : proto;
        cmd = `iptables -A INPUT -p ${ipProto} --dport ${port} -j ${target} 2>&1 && iptables -L INPUT -n --line-numbers | head -n 15 2>&1`;
      } else {
        throw new Error(`Adding rules is not supported on backend '${fw}' in web mode.`);
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to add firewall rule');
      appendAuditEvent({ event: 'firewall_add_rule', username: currentSession?.username || '', ip: clientIp, backend: fw, port, proto, action, status: 'ok' });
      return res.stdout || 'Rule added';
    }

    case 'firewall_delete_rule_advanced': {
      if (!entry) return '';
      const ruleNum = args?.rule_number || args?.ruleNumber;
      const rawPort = args?.port;
      const proto = validateSafeToken(args?.protocol || 'tcp', /^(?:tcp|udp|any)$/i, 'protocol').toLowerCase();
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = args?.backend ? validateSafeToken(args.backend, /^(?:ufw|firewalld|iptables|nftables)$/i, 'backend').toLowerCase() : (detectRes.stdout || '').trim().toLowerCase();
      let cmd = '';
      if (fw.includes('ufw')) {
        const num = validateInt(ruleNum, 1, 100000, 'rule number');
        cmd = `echo y | ufw delete ${num} 2>&1 && ufw status | head -n 15 2>&1`;
      } else if (fw.includes('firewalld')) {
        const port = validateInt(rawPort, 1, 65535, 'port');
        cmd = proto === 'any'
          ? `c1=0; firewall-cmd --permanent --remove-port=${port}/tcp 2>&1 || c1=$?; c2=0; firewall-cmd --permanent --remove-port=${port}/udp 2>&1 || c2=$?; [ $c1 -eq 0 ] || [ $c2 -eq 0 ] || exit 1; firewall-cmd --reload 2>&1 && firewall-cmd --list-ports 2>&1`
          : `firewall-cmd --permanent --remove-port=${port}/${proto} 2>&1 && firewall-cmd --reload 2>&1 && firewall-cmd --list-ports 2>&1`;
      } else if (fw.includes('iptables')) {
        const num = validateInt(ruleNum, 1, 100000, 'rule number');
        cmd = `iptables -D INPUT ${num} 2>&1 && iptables -L INPUT -n --line-numbers | head -n 15 2>&1`;
      } else {
        throw new Error(`Deleting rules is not supported on backend '${fw}' in web mode.`);
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to delete firewall rule');
      appendAuditEvent({ event: 'firewall_delete_rule', username: currentSession?.username || '', ip: clientIp, backend: fw, ruleNum, status: 'ok' });
      return res.stdout || 'Rule deleted';
    }

    case 'firewall_install': {
      if (!entry) return '';
      const pm = await detectPkgManager(entry.client);
      const tool = (args?.tool || 'ufw').toLowerCase();
      let cmd = 'apt-get update && apt-get install -y ufw';
      if (pm === 'dnf') cmd = tool.includes('firewalld') ? 'dnf install -y firewalld' : 'dnf install -y ufw || dnf install -y iptables-services';
      else if (pm === 'yum') cmd = tool.includes('firewalld') ? 'yum install -y firewalld' : 'yum install -y ufw';
      else if (pm === 'pacman') cmd = 'pacman -Sy --noconfirm ufw iptables';
      const res = await runRemotePrivExec(entry, `${cmd} 2>&1`, 120000);
      return res.stdout || 'Installed';
    }

    case 'firewall_set_default_policy': {
      if (!entry) return '';
      const dir = validateSafeToken(args?.direction || 'incoming', /^(?:incoming|outgoing|routed)$/i, 'direction').toLowerCase();
      const pol = validateSafeToken(args?.policy || 'deny', /^(?:allow|deny|reject)$/i, 'policy').toLowerCase();
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = (detectRes.stdout || '').trim().toLowerCase();
      const sshPort = Number(entry?.config?.port) || 22;
      let cmd = '';
      if (fw.includes('ufw')) {
        cmd = dir === 'incoming' && (pol === 'deny' || pol === 'reject')
          ? `ufw allow ${sshPort}/tcp 2>&1 && ufw default ${pol} ${dir} 2>&1`
          : `ufw default ${pol} ${dir} 2>&1`;
      } else if (fw.includes('iptables')) {
        if (pol === 'reject') throw new Error('iptables chain default policy supports only ACCEPT or DROP.');
        const chain = dir === 'incoming' ? 'INPUT' : dir === 'outgoing' ? 'OUTPUT' : 'FORWARD';
        const target = pol === 'allow' ? 'ACCEPT' : 'DROP';
        cmd = dir === 'incoming' && pol === 'deny'
          ? `iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>&1; iptables -C INPUT -i lo -j ACCEPT 2>/dev/null || iptables -I INPUT 2 -i lo -j ACCEPT 2>&1; iptables -C INPUT -p tcp --dport ${sshPort} -j ACCEPT 2>/dev/null || iptables -I INPUT 3 -p tcp --dport ${sshPort} -j ACCEPT 2>&1; iptables -P INPUT DROP 2>&1`
          : `iptables -P ${chain} ${target} 2>&1`;
      } else {
        throw new Error(`Default policy switching is not supported on backend '${fw}'.`);
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to set default policy');
      appendAuditEvent({ event: 'firewall_set_default_policy', username: currentSession?.username || '', ip: clientIp, backend: fw, dir, pol, status: 'ok' });
      return res.stdout || 'Policy set';
    }

    case 'firewall_reset': {
      if (!entry) return '';
      const detectRes = await runRemoteExec(entry.client, "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v nft >/dev/null 2>&1; then echo 'nftables'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi");
      const fw = (detectRes.stdout || '').trim().toLowerCase();
      const sshPort = Number(entry?.config?.port) || 22;
      let cmd = '';
      if (fw.includes('ufw')) {
        cmd = `echo y | ufw reset 2>&1 && ufw allow ${sshPort}/tcp 2>&1`;
      } else if (fw.includes('firewalld')) {
        cmd = 'firewall-cmd --complete-reload 2>&1';
      } else {
        throw new Error(`Refusing blind firewall reset on '${fw}' backend to protect active SSH access.`);
      }
      const res = await runRemotePrivExec(entry, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to reset firewall');
      appendAuditEvent({ event: 'firewall_reset', username: currentSession?.username || '', ip: clientIp, backend: fw, sshPort, status: 'ok' });
      return res.stdout || 'Reset';
    }

    case 'package_detect_manager': {
      if (!entry || !entry.client) return 'apt';
      return await detectPkgManager(entry.client);
    }

    case 'package_list': {
      if (!entry) return [];
      const pm = await detectPkgManager(entry.client);
      if (pm === 'dnf' || pm === 'yum' || pm === 'zypper') {
        const res = await runRemoteExec(
          entry.client,
          "rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{ARCH}\t%{SUMMARY}\n' 2>/dev/null | head -n 3000",
          25000
        );
        const list = [];
        for (const line of res.stdout.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 2 && parts[0].trim()) {
            list.push({
              name: parts[0].trim(),
              version: parts[1].trim(),
              size: formatBytes(parseInt(parts[2], 10) || 0),
              arch: parts[3] ? parts[3].trim() : 'x86_64',
              description: parts[4] ? parts[4].trim() : parts[0].trim(),
              status: 'installed'
            });
          }
        }
        return list;
      } else if (pm === 'pacman') {
        const res = await runRemoteExec(
          entry.client,
          `pacman -Q 2>/dev/null | awk '{print $1"\\t"$2"\\t0\\tall\\tpacman package"}' | head -n 3000`,
          20000
        );
        const list = [];
        for (const line of res.stdout.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 2 && parts[0].trim()) {
            list.push({
              name: parts[0].trim(),
              version: parts[1].trim(),
              size: '—',
              arch: 'all',
              description: 'pacman package',
              status: 'installed'
            });
          }
        }
        return list;
      } else if (pm === 'apk') {
        const res = await runRemoteExec(
          entry.client,
          `apk info -v 2>/dev/null | awk -F'-' '{print $1"\\t"$2"\\t0\\tall\\talpine package"}' | head -n 3000`,
          20000
        );
        const list = [];
        for (const line of res.stdout.split('\n')) {
          const parts = line.split('\t');
          if (parts.length >= 2 && parts[0].trim()) {
            list.push({
              name: parts[0].trim(),
              version: parts[1].trim(),
              size: '—',
              arch: 'all',
              description: 'alpine package',
              status: 'installed'
            });
          }
        }
        return list;
      } else {
        const queryFmt = "dpkg-query -W -f='" + String.fromCharCode(36) + "{Package}\t" + String.fromCharCode(36) + "{Version}\t" + String.fromCharCode(36) + "{Installed-Size}\t" + String.fromCharCode(36) + "{Architecture}\t" + String.fromCharCode(36) + "{binary:Summary}\n' 2>/dev/null | head -n 3000";
        const res = await runRemoteExec(
          entry.client,
          queryFmt,
          25000
        );
        const list = [];
        for (const line of res.stdout.split('\n')) {
          const [name, version, size, arch, description] = line.split('\t');
          if (name && version) {
            list.push({
              name: name.trim(),
              version: version.trim(),
              size: formatBytes((parseInt(size, 10) || 0) * 1024),
              arch: (arch || 'x86_64').trim(),
              description: (description || '').trim(),
              status: 'installed'
            });
          }
        }
        return list;
      }
    }

    case 'package_search': {
      if (!entry) return [];
      const q = (args?.query || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (!q) return [];
      const pm = await detectPkgManager(entry.client);
      let res;
      if (pm === 'dnf') {
        res = await runRemoteExec(entry.client, `dnf search "${q}" 2>/dev/null | grep -v '^=\\|^Last' | head -n 60`, 20000);
      } else if (pm === 'yum') {
        res = await runRemoteExec(entry.client, `yum search "${q}" 2>/dev/null | head -n 60`, 20000);
      } else if (pm === 'pacman') {
        res = await runRemoteExec(entry.client, `pacman -Ss "${q}" 2>/dev/null | head -n 60`, 20000);
      } else {
        res = await runRemoteExec(entry.client, `apt-cache search "${q}" 2>/dev/null | head -n 60`, 15000);
      }

      const list = [];
      for (const line of res.stdout.split('\n')) {
        if (line.includes(' - ')) {
          const parts = line.split(' - ');
          list.push({
            name: parts[0].trim(),
            version: 'latest',
            size: '—',
            arch: 'any',
            description: parts.slice(1).join(' - ').trim(),
            status: 'available'
          });
        } else if (line.includes(':')) {
          const parts = line.split(':');
          list.push({
            name: parts[0].trim().replace(/\.(noarch|x86_64)$/, ''),
            version: 'latest',
            size: '—',
            arch: 'any',
            description: parts.slice(1).join(':').trim(),
            status: 'available'
          });
        }
      }
      return list;
    }

    case 'package_install': {
      if (!entry) return '';
      const pm = await detectPkgManager(entry.client);
      const pkg = args?.name;
      if (!pkg || typeof pkg !== 'string') throw new Error('Invalid package name');

      const { installCmd, post } = buildInstallCommand(pm, pkg);
      let cmd = installCmd;
      if (post) {
        cmd = `${installCmd} && (systemctl daemon-reload 2>/dev/null || true) && (${post})`;
      } else {
        cmd = `${installCmd} && (systemctl daemon-reload 2>/dev/null || true)`;
      }

      const res = await runRemotePrivExec(entry, cmd, 180000);
      if (res.exit_code !== 0 && !res.stdout.includes('Complete!') && !res.stdout.includes('already installed') && !res.stdout.includes('Nothing to do')) {
        throw new Error(res.stderr || res.stdout || `Failed to install package '${pkg}'`);
      }
      return res.stdout || res.stderr;
    }

    case 'package_remove': {
      if (!entry) return '';
      const pm = await detectPkgManager(entry.client);
      const pkg = args?.name;
      if (!pkg || typeof pkg !== 'string') throw new Error('Invalid package name');
      const safePkg = pkg.replace(/'/g, "'\\''");
      const lower = pkg.toLowerCase();
      const isMysql = lower === 'mysql-server' || lower === 'mysql' || lower === 'mariadb-server' || lower === 'mariadb' || lower === 'mariadb105-server';

      let cmd = '';
      if (pm === 'dnf') {
        cmd = isMysql
          ? 'dnf remove -y mysql-server mariadb-server mariadb105-server mariadb 2>&1'
          : `dnf remove -y '${safePkg}' 2>&1`;
      } else if (pm === 'yum') {
        cmd = isMysql
          ? 'yum remove -y mysql-server mariadb-server mariadb 2>&1'
          : `yum remove -y '${safePkg}' 2>&1`;
      } else if (pm === 'pacman') {
        cmd = isMysql
          ? 'pacman -R --noconfirm mariadb mariadb-clients mysql 2>&1'
          : `pacman -R --noconfirm '${safePkg}' 2>&1`;
      } else if (pm === 'zypper') {
        cmd = `zypper --non-interactive rm '${safePkg}' 2>&1`;
      } else if (pm === 'apk') {
        cmd = `apk del '${safePkg}' 2>&1`;
      } else {
        cmd = isMysql
          ? 'DEBIAN_FRONTEND=noninteractive apt-get remove -y mysql-server default-mysql-server mariadb-server 2>&1'
          : `DEBIAN_FRONTEND=noninteractive apt-get remove -y '${safePkg}' 2>&1`;
      }
      cmd += ' && (systemctl daemon-reload 2>/dev/null || true)';

      const res = await runRemotePrivExec(entry, cmd, 120000);
      if (res.exit_code !== 0) {
        throw new Error(res.stderr || res.stdout || `Failed to remove package '${pkg}'`);
      }
      return res.stdout || res.stderr;
    }

    case 'package_preview': {
      if (!entry) return '';
      const pkg = validateSafeToken(args?.name, /^[a-zA-Z0-9.+_:@=-]{1,128}$/, 'package name');
      const action = validateSafeToken(String(args?.action || 'install').toLowerCase(), /^(?:install|remove)$/, 'action');
      const pm = await detectPkgManager(entry.client);
      const qPkg = shellQuote(pkg);
      let cmd = '';
      if (pm === 'apt') cmd = `DEBIAN_FRONTEND=noninteractive apt-get -s ${action} ${qPkg} 2>&1`;
      else if (pm === 'dnf') cmd = `dnf ${action} --assumeno ${qPkg} 2>&1 || true`;
      else if (pm === 'yum') cmd = `yum ${action} --assumeno ${qPkg} 2>&1 || true`;
      else if (pm === 'pacman') cmd = action === 'install' ? `pacman -Sp --print-format '%n %v %s' ${qPkg} 2>&1` : `pacman -Rsp --print-format '%n %v %s' ${qPkg} 2>&1`;
      else if (pm === 'zypper') cmd = `zypper --non-interactive ${action === 'install' ? 'install' : 'rm'} --dry-run ${qPkg} 2>&1`;
      else if (pm === 'apk') cmd = `apk ${action === 'install' ? 'add' : 'del'} --simulate ${qPkg} 2>&1`;
      else throw new Error(`Dependency simulation preview unsupported for '${pm}'`);

      const res = await runRemotePrivExec(entry, cmd, 60000);
      return res.stdout || res.stderr || `No additional dependency changes reported for ${pkg}.`;
    }

    case 'package_update': {
      if (!entry) return '';
      const pm = await detectPkgManager(entry.client);
      let cmd = 'apt-get update -y 2>&1';
      if (pm === 'dnf') cmd = 'dnf check-update 2>&1';
      else if (pm === 'yum') cmd = 'yum check-update 2>&1';
      else if (pm === 'pacman') cmd = 'pacman -Sy 2>&1';

      const res = await runRemotePrivExec(entry, cmd, 180000);
      return res.stdout || res.stderr || 'Repository caches updated.';
    }

    case 'package_upgradable': {
      if (!entry) return [];
      const pm = await detectPkgManager(entry.client);
      if (pm === 'dnf' || pm === 'yum') {
        const res = await runRemoteExec(entry.client, 'dnf check-update -q 2>/dev/null | head -n 100');
        const list = [];
        for (const line of res.stdout.split('\n')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2 && !parts[0].startsWith('=')) {
            list.push({
              name: parts[0].split('.')[0],
              version: parts[1],
              size: '—',
              arch: 'any',
              description: 'Upgradable package',
              status: 'upgradable'
            });
          }
        }
        return list;
      }
      const res = await runRemoteExec(entry.client, 'apt list --upgradable 2>/dev/null | head -n 100');
      const list = [];
      for (const line of res.stdout.split('\n').slice(1)) {
        const p = line.split('/');
        if (p.length >= 2) {
          list.push({
            name: p[0],
            version: p[1]?.split(' ')[1] || 'update',
            size: '—',
            arch: 'any',
            description: 'Upgradable package',
            status: 'upgradable'
          });
        }
      }
      return list;
    }

    // 11. User & Group Management
    // ==========================================
    case 'user_list': {
      if (!entry) return [];
      const res = await runRemotePrivExec(entry, "getent passwd 2>/dev/null; echo '---GROUPS---'; getent group 2>/dev/null; echo '---SHADOW---'; cat /etc/shadow 2>/dev/null || true");
      const [passwdSec, rest] = res.stdout.split('---GROUPS---');
      const [groupSec, shadowSec] = (rest || '').split('---SHADOW---');

      const userGroups = {};
      if (groupSec) {
        for (const l of groupSec.split('\n')) {
          const parts = l.trim().split(':');
          if (parts.length >= 4) {
            const grp = parts[0];
            const members = parts[3].split(',').filter(Boolean);
            for (const m of members) {
              if (!userGroups[m]) userGroups[m] = [];
              userGroups[m].push(grp);
            }
          }
        }
      }

      const lockedSet = new Set();
      if (shadowSec) {
        for (const l of shadowSec.split('\n')) {
          const p = l.split(':');
          if (p[1] && (p[1].startsWith('!') || p[1].startsWith('*'))) {
            lockedSet.add(p[0]);
          }
        }
      }

      const users = [];
      if (passwdSec) {
        for (const l of passwdSec.split('\n')) {
          const p = l.trim().split(':');
          if (p.length >= 7) {
            const uname = p[0];
            users.push({
              username: uname,
              uid: parseInt(p[2], 10) || 0,
              gid: parseInt(p[3], 10) || 0,
              home: p[5],
              shell: p[6],
              groups: userGroups[uname] || [],
              locked: lockedSet.has(uname)
            });
          }
        }
      }
      return users;
    }

    case 'user_add': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      const password = args?.password;
      const sh = args?.shell ? String(args.shell).trim() : '/bin/bash';
      if (password && (typeof password !== 'string' || password.includes('\n') || password.includes('\r'))) {
        throw new Error('Invalid password: control characters not allowed');
      }
      const addRes = await runRemotePrivExec(entry, `useradd -m -s ${shellQuote(sh)} -- ${shellQuote(username)}`);
      if (addRes.exit_code !== 0) throw new Error(addRes.stderr || addRes.stdout || 'Failed to add user');
      if (password) {
        const pwdRes = await runRemotePrivExec(entry, 'chpasswd', 60000, `${username}:${password}\n`);
        if (pwdRes.exit_code !== 0) {
          await runRemotePrivExec(entry, `userdel -r -- ${shellQuote(username)}`);
          throw new Error(pwdRes.stderr || pwdRes.stdout || 'Failed to set password; rolled back user creation');
        }
      }
      if (Array.isArray(args?.groups) && args.groups.length > 0) {
        const validGroups = args.groups.map(g => validateSafeToken(g, /^[a-zA-Z0-9._-]+$/, 'group')).join(',');
        await runRemotePrivExec(entry, `usermod -aG ${shellQuote(validGroups)} -- ${shellQuote(username)}`);
      }
      return;
    }

    case 'user_set_password': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      const password = String(args?.password ?? '');
      if (!password || password.includes('\n') || password.includes('\r')) {
        throw new Error('Invalid password');
      }
      await runRemotePrivExec(entry, 'chpasswd', 60000, `${username}:${password}\n`);
      return;
    }

    case 'user_toggle_sudo': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      const qUser = shellQuote(username);
      if (args?.grant) {
        await runRemotePrivExec(entry, `usermod -aG sudo -- ${qUser} 2>/dev/null || usermod -aG wheel -- ${qUser} 2>/dev/null`);
      } else {
        await runRemotePrivExec(entry, `gpasswd -d ${qUser} sudo 2>/dev/null || gpasswd -d ${qUser} wheel 2>/dev/null`);
      }
      return;
    }

    case 'user_delete': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      if (['root', 'daemon', 'bin', 'sys', 'sync', 'nobody', 'sshd'].includes(username)) {
        throw new Error(`Refusing to delete protected system user '${username}'.`);
      }
      if (entry?.config?.username && String(entry.config.username).trim() === username) {
        throw new Error(`Refusing to delete currently authenticated SSH user '${username}'.`);
      }
      const qUser = shellQuote(username);
      const uidCheck = `TARGET_UID=$(id -u ${qUser} 2>/dev/null) || { echo 'User not found' >&2; exit 2; }; UID_MIN=$(awk '/^UID_MIN[[:space:]]+/ {print $2; exit}' /etc/login.defs 2>/dev/null); UID_MIN=\${UID_MIN:-1000}; if [ "$TARGET_UID" -eq 0 ] || [ "$TARGET_UID" -lt "$UID_MIN" ]; then echo "Refusing to delete system/service account (UID $TARGET_UID < $UID_MIN)." >&2; exit 3; fi`;
      const rm = args?.removeHome ? '-r' : '';
      const res = await runRemotePrivExec(entry, `${uidCheck} && userdel ${rm} -- ${qUser} 2>&1`);
      if (res.exit_code !== 0) {
        throw new Error(res.stderr || res.stdout || 'Failed to delete user');
      }
      appendAuditEvent({ event: 'user_delete', username: currentSession?.username || '', ip: clientIp, targetUser: username, removeHome: Boolean(args?.removeHome), status: 'ok' });
      return;
    }

    case 'user_lock': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      await runRemotePrivExec(entry, `usermod -L -- ${shellQuote(username)}`);
      return;
    }

    case 'user_modify': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      const qUser = shellQuote(username);
      if (args?.shell) await runRemotePrivExec(entry, `usermod -s ${shellQuote(args.shell)} -- ${qUser}`);
      if (args?.home) await runRemotePrivExec(entry, `usermod -d ${shellQuote(args.home)} -m -- ${qUser}`);
      return true;
    }

    case 'group_add_user': {
      if (!entry) return;
      const group = validateSafeToken(args?.group, /^[a-zA-Z0-9._-]+$/, 'group');
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      await runRemotePrivExec(entry, `usermod -aG ${shellQuote(group)} -- ${shellQuote(username)}`);
      return true;
    }

    case 'group_remove_user': {
      if (!entry) return;
      const group = validateSafeToken(args?.group, /^[a-zA-Z0-9._-]+$/, 'group');
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      await runRemotePrivExec(entry, `gpasswd -d ${shellQuote(username)} ${shellQuote(group)}`);
      return true;
    }

    case 'user_unlock': {
      if (!entry) return;
      const username = validateSafeToken(args?.username, /^[a-zA-Z_][a-zA-Z0-9._-]{0,31}$/, 'username');
      await runRemotePrivExec(entry, `usermod -U -- ${shellQuote(username)}`);
      return;
    }

    case 'group_list': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'getent group 2>/dev/null');
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const p = line.trim().split(':');
        if (p.length >= 4) {
          list.push({
            name: p[0],
            gid: parseInt(p[2], 10) || 0,
            members: p[3].split(',').filter(Boolean)
          });
        }
      }
      return list;
    }

    case 'group_add': {
      if (!entry) return;
      const group = validateSafeToken(args?.name, /^[a-zA-Z0-9._-]+$/, 'group');
      await runRemotePrivExec(entry, `groupadd -- ${shellQuote(group)}`);
      return;
    }

    case 'group_delete': {
      if (!entry) return;
      const group = validateSafeToken(args?.name, /^[a-zA-Z0-9._-]+$/, 'group');
      await runRemotePrivExec(entry, `groupdel -- ${shellQuote(group)}`);
      return;
    }

    case 'who_is_logged_in': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, 'who 2>/dev/null || w -h 2>/dev/null');
      return res.stdout;
    }

    case 'last_logins': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, 'last -n 20 2>/dev/null');
      return res.stdout;
    }

    // ==========================================
    // 12. Cron Job Scheduler
    // ==========================================
    case 'cron_list':
    case 'cron_list_all': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'crontab -l 2>/dev/null');
      const list = [];
      let lineNum = 0;
      for (const line of res.stdout.split('\n')) {
        lineNum++;
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const p = trimmed.split(/\s+/);
        if (p.length >= 6) {
          list.push({
            schedule: p.slice(0, 5).join(' '),
            command: p.slice(5).join(' '),
            user: 'current',
            line_number: lineNum
          });
        }
      }
      return list;
    }

    case 'cron_add': {
      if (!entry) return;
      const schedule = String(args?.schedule ?? '').trim();
      const command = String(args?.command ?? '').trim();
      if (!schedule || !command || /[\r\n\0]/.test(schedule) || /[\r\n\0]/.test(command)) {
        throw new Error('Invalid cron schedule or command');
      }
      const updateCmd = `(crontab -l 2>/dev/null; printf '%s\\n' ${shellQuote(`${schedule} ${command}`)}) | crontab -`;
      const wrapped = `LOCK_FILE="/tmp/.sshdesktop_cron_$(id -u).lock"; BAK_FILE="$HOME/.sshdesktop_crontab.bak"; ` +
        `run_u() { (crontab -l 2>/dev/null > "$BAK_FILE" || true); ${updateCmd}; }; ` +
        `if command -v flock >/dev/null 2>&1; then (flock -w 5 9 || { echo 'CRON_LOCK_TIMEOUT' >&2; exit 4; }; run_u) 9>"$LOCK_FILE"; else run_u; fi`;
      const res = await runRemoteExec(entry.client, wrapped);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to add cron entry');
      appendAuditEvent({ event: 'cron_add', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return;
    }

    case 'cron_remove': {
      if (!entry) return;
      const cmdToRemove = (args?.command || '').trim();
      if (!cmdToRemove || /[\r\n\0]/.test(cmdToRemove)) throw new Error('Invalid cron pattern');
      const updateCmd = `crontab -l 2>/dev/null | grep -vF -- ${shellQuote(cmdToRemove)} | crontab -`;
      const wrapped = `LOCK_FILE="/tmp/.sshdesktop_cron_$(id -u).lock"; BAK_FILE="$HOME/.sshdesktop_crontab.bak"; ` +
        `run_u() { (crontab -l 2>/dev/null > "$BAK_FILE" || true); ${updateCmd}; }; ` +
        `if command -v flock >/dev/null 2>&1; then (flock -w 5 9 || { echo 'CRON_LOCK_TIMEOUT' >&2; exit 4; }; run_u) 9>"$LOCK_FILE"; else run_u; fi`;
      const res = await runRemoteExec(entry.client, wrapped);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to remove cron entry');
      appendAuditEvent({ event: 'cron_remove', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return;
    }

    case 'cron_rollback': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, 'BAK="$HOME/.sshdesktop_crontab.bak"; if [ ! -f "$BAK" ]; then echo "No crontab backup snapshot found." >&2; exit 2; fi; crontab "$BAK" && echo "Crontab restored from previous snapshot."');
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to restore crontab snapshot');
      appendAuditEvent({ event: 'cron_rollback', username: currentSession?.username || '', ip: clientIp, status: 'ok' });
      return res.stdout.trim();
    }

    // ==========================================
    // 13. Docker Container Management
    // ==========================================
    case 'docker_containers': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, "docker ps -a --format '{{json .}}' 2>/dev/null");
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const c = JSON.parse(trimmed);
          list.push({
            id: c.ID || '',
            name: c.Names || '',
            image: c.Image || '',
            status: c.Status || '',
            state: c.State || '',
            ports: c.Ports || '',
            created: c.CreatedAt || '',
            cpu_percent: 0,
            mem_usage: ''
          });
        } catch {}
      }
      return list;
    }

    case 'docker_action': {
      if (!entry) return '';
      const action = validateSafeToken(args?.action, /^(?:start|stop|restart|pause|unpause|rm|kill|unpause)$/i, 'docker action').toLowerCase();
      const cid = validateSafeToken(args?.containerId, /^[A-Za-z0-9_.:-]+$/, 'container ID');
      let res = await runRemoteExec(entry.client, `docker ${action} -- ${shellQuote(cid)} 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker ${action} -- ${shellQuote(cid)} 2>&1`);
      }
      return res.stdout || res.stderr || 'Action executed';
    }

    case 'docker_logs': {
      if (!entry) return '';
      const lines = validateInt(args?.lines ?? 100, 1, 10000, 'lines');
      const cid = validateSafeToken(args?.containerId, /^[A-Za-z0-9_.:-]+$/, 'container ID');
      let res = await runRemoteExec(entry.client, `docker logs --tail ${lines} -- ${shellQuote(cid)} 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker logs --tail ${lines} -- ${shellQuote(cid)} 2>&1`);
      }
      return res.stdout || res.stderr;
    }

    case 'docker_images': {
      if (!entry) return [];
      let res = await runRemoteExec(entry.client, "docker images --format '{{json .}}' 2>/dev/null");
      if (!res.stdout.trim()) {
        res = await runRemotePrivExec(entry, "docker images --format '{{json .}}' 2>/dev/null");
      }
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const img = JSON.parse(trimmed);
          list.push({
            id: img.ID || '',
            repository: img.Repository || '',
            tag: img.Tag || '',
            size: img.Size || '',
            created: img.CreatedAt || ''
          });
        } catch {}
      }
      return list;
    }

    case 'docker_exec': {
      if (!entry) return '';
      const cid = validateSafeToken(args?.containerId, /^[A-Za-z0-9_.:-]+$/, 'container ID');
      const command = String(args?.command || '').trim();
      if (!command) throw new Error('Missing container command');
      let res = await runRemoteExec(entry.client, `docker exec -- ${shellQuote(cid)} sh -c ${shellQuote(command)} 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker exec -- ${shellQuote(cid)} sh -c ${shellQuote(command)} 2>&1`);
      }
      return res.stdout || res.stderr;
    }

    case 'docker_stats': {
      if (!entry) return [];
      let res = await runRemoteExec(entry.client, "docker stats --no-stream --format '{{json .}}' 2>/dev/null");
      if (!res.stdout.trim()) {
        res = await runRemotePrivExec(entry, "docker stats --no-stream --format '{{json .}}' 2>/dev/null");
      }
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try { list.push(JSON.parse(trimmed)); } catch {}
      }
      return list;
    }

    case 'docker_image_remove': {
      if (!entry) return '';
      const imgId = validateSafeToken(args?.imageId, /^[A-Za-z0-9_.:\-\/@]+$/, 'image ID');
      let res = await runRemoteExec(entry.client, `docker rmi -- ${shellQuote(imgId)} 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker rmi -- ${shellQuote(imgId)} 2>&1`);
      }
      return res.stdout || res.stderr;
    }

    // ==========================================
    // 14. Advanced Disk Management
    // ==========================================
    case 'disk_list': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'lsblk -J -b -o NAME,KNAME,PATH,SIZE,TYPE,FSTYPE,LABEL,UUID,MOUNTPOINT,MODEL,RO,PTTYPE,PARTTYPE 2>/dev/null');
      try {
        const parsed = JSON.parse(res.stdout);
        const mapDevice = (dev) => ({
          name: dev.name,
          kname: dev.kname || dev.name,
          path: dev.path || `/dev/${dev.name}`,
          size: formatBytes(dev.size || 0),
          size_bytes: dev.size || 0,
          type_name: dev.type || 'disk',
          fstype: dev.fstype || null,
          label: dev.label || null,
          uuid: dev.uuid || null,
          mountpoint: dev.mountpoint || null,
          model: dev.model || null,
          ro: !!dev.ro,
          pttype: dev.pttype || null,
          parttype: dev.parttype || null,
          children: dev.children ? dev.children.map(mapDevice) : null,
          is_system: dev.mountpoint === '/' || dev.mountpoint === '/boot'
        });
        return (parsed.blockdevices || []).map(mapDevice);
      } catch {
        return [];
      }
    }

    case 'disk_smart': {
      if (!entry) return '';
      const device = validateSafeToken(args?.device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const res = await runRemotePrivExec(entry, `smartctl -a -- ${shellQuote(device)} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'disk_largest_dirs': {
      if (!entry) return '';
      const targetPath = String(args?.path || '/').trim();
      const res = await runRemoteExec(entry.client, `du -h --max-depth=1 -- ${shellQuote(targetPath)} 2>/dev/null | sort -hr | head -n 20`);
      return res.stdout;
    }

    case 'disk_mount': {
      if (!entry) return '';
      const device = String(args?.device || '').trim();
      const mp = String(args?.mountPoint || '').trim();
      if (!device || !mp) throw new Error('Invalid mount parameters');
      const opt = args?.options ? `-o ${shellQuote(validateSafeToken(args.options, /^[A-Za-z0-9,_=.-]+$/, 'mount options'))}` : '';
      const res = await runRemotePrivExec(entry, `mount ${opt} -- ${shellQuote(device)} ${shellQuote(mp)} 2>&1`);
      return res.stdout || 'Mounted';
    }

    case 'disk_unmount': {
      if (!entry) return '';
      const f = args?.force ? '-f' : '';
      const l = args?.lazy ? '-l' : '';
      const target = String(args?.target || '').trim();
      if (!target) throw new Error('Invalid unmount target');
      const res = await runRemotePrivExec(entry, `umount ${f} ${l} -- ${shellQuote(target)} 2>&1`);
      return res.stdout || 'Unmounted';
    }

    case 'disk_remount': {
      if (!entry) return '';
      const opts = validateSafeToken(args?.options || 'defaults', /^[A-Za-z0-9,_=.-]+$/, 'mount options');
      const mp = String(args?.mountPoint || '').trim();
      if (!mp) throw new Error('Invalid mount point');
      const res = await runRemotePrivExec(entry, `mount -o ${shellQuote(`remount,${opts}`)} -- ${shellQuote(mp)} 2>&1`);
      return res.stdout || 'Remounted';
    }

    case 'disk_get_fstab': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, 'cat /etc/fstab 2>/dev/null');
      const entries = [];
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 4) {
          entries.push({
            spec: parts[0],
            file: parts[1],
            vfstype: parts[2],
            mntops: parts[3],
            freq: parseInt(parts[4], 10) || 0,
            passno: parseInt(parts[5], 10) || 0,
          });
        }
      }
      return entries;
    }

    case 'disk_create_label': {
      if (!entry) return '';
      const { device, labelType = 'gpt' } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safeLabel = validateSafeToken(labelType, /^(?:gpt|msdos|bsd|loop|mac|sun)$/i, 'label type').toLowerCase();
      const qDev = shellQuote(safeDev);
      const guard = `set -e; [ -b ${qDev} ]; DEV_REAL=$(readlink -f -- ${qDev}); NODES=$(lsblk -nrpo NAME "$DEV_REAL"); SWAP_NODES=$(swapon --noheadings --raw --show=NAME 2>/dev/null || true); for N in $NODES; do findmnt -rn -S "$N" >/dev/null 2>&1 && { echo "Refusing: $N is mounted" >&2; exit 31; }; for S in $SWAP_NODES; do [ "$(readlink -f -- "$S" 2>/dev/null)" = "$(readlink -f -- "$N" 2>/dev/null)" ] && { echo "Refusing: $N is active swap" >&2; exit 32; }; done; done; command -v parted >/dev/null 2>&1 || { echo "Missing required dependency 'parted'." >&2; exit 127; }`;
      const res = await runRemotePrivExec(entry, `${guard}; parted -s -- ${qDev} mklabel ${safeLabel} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to create partition table');
      appendAuditEvent({ event: 'disk_create_label', username: currentSession?.username || '', ip: clientIp, device: safeDev, labelType: safeLabel, status: 'ok' });
      return res.stdout || 'Label created';
    }

    case 'disk_create_partition': {
      if (!entry) return '';
      const { device, partType = 'primary', start = '1MiB', end = '100%' } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safePart = validateSafeToken(partType, /^(?:primary|logical|extended)$/i, 'partition type').toLowerCase();
      const safeStart = validateSafeToken(start, /^[A-Za-z0-9.%+-]+$/, 'start boundary');
      const safeEnd = validateSafeToken(end, /^[A-Za-z0-9.%+-]+$/, 'end boundary');
      const qDev = shellQuote(safeDev);
      const guard = `set -e; [ -b ${qDev} ]; DEV_REAL=$(readlink -f -- ${qDev}); NODES=$(lsblk -nrpo NAME "$DEV_REAL"); SWAP_NODES=$(swapon --noheadings --raw --show=NAME 2>/dev/null || true); for N in $NODES; do findmnt -rn -S "$N" >/dev/null 2>&1 && { echo "Refusing: $N is mounted" >&2; exit 31; }; for S in $SWAP_NODES; do [ "$(readlink -f -- "$S" 2>/dev/null)" = "$(readlink -f -- "$N" 2>/dev/null)" ] && { echo "Refusing: $N is active swap" >&2; exit 32; }; done; done; command -v parted >/dev/null 2>&1 || { echo "Missing required dependency 'parted'." >&2; exit 127; }`;
      const res = await runRemotePrivExec(entry, `${guard}; parted -s -- ${qDev} mkpart ${safePart} ${shellQuote(safeStart)} ${shellQuote(safeEnd)} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to create partition');
      appendAuditEvent({ event: 'disk_create_partition', username: currentSession?.username || '', ip: clientIp, device: safeDev, status: 'ok' });
      return res.stdout || 'Partition created';
    }

    case 'disk_delete_partition': {
      if (!entry) return '';
      const { device, partNumber } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safeNum = validateInt(partNumber, 1, 128, 'partition number');
      const qDev = shellQuote(safeDev);
      const guard = `set -e; [ -b ${qDev} ]; DEV_REAL=$(readlink -f -- ${qDev}); NODES=$(lsblk -nrpo NAME "$DEV_REAL"); SWAP_NODES=$(swapon --noheadings --raw --show=NAME 2>/dev/null || true); for N in $NODES; do findmnt -rn -S "$N" >/dev/null 2>&1 && { echo "Refusing: $N is mounted" >&2; exit 31; }; for S in $SWAP_NODES; do [ "$(readlink -f -- "$S" 2>/dev/null)" = "$(readlink -f -- "$N" 2>/dev/null)" ] && { echo "Refusing: $N is active swap" >&2; exit 32; }; done; done; command -v parted >/dev/null 2>&1 || { echo "Missing required dependency 'parted'." >&2; exit 127; }`;
      const res = await runRemotePrivExec(entry, `${guard}; parted -s -- ${qDev} rm ${safeNum} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to delete partition');
      appendAuditEvent({ event: 'disk_delete_partition', username: currentSession?.username || '', ip: clientIp, device: safeDev, partNumber: safeNum, status: 'ok' });
      return res.stdout || 'Partition deleted';
    }

    case 'disk_resize_partition': {
      if (!entry) return '';
      const { device, partNumber, newEnd = '100%' } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safeNum = validateInt(partNumber, 1, 128, 'partition number');
      const safeEnd = validateSafeToken(newEnd, /^[A-Za-z0-9.%+-]+$/, 'end boundary');
      const qDev = shellQuote(safeDev);
      const guard = `set -e; [ -b ${qDev} ]; command -v parted >/dev/null 2>&1 || { echo "Missing required dependency 'parted'." >&2; exit 127; }`;
      const res = await runRemotePrivExec(entry, `${guard}; parted -s -- ${qDev} resizepart ${safeNum} ${shellQuote(safeEnd)} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to resize partition');
      appendAuditEvent({ event: 'disk_resize_partition', username: currentSession?.username || '', ip: clientIp, device: safeDev, partNumber: safeNum, status: 'ok' });
      return res.stdout || 'Partition resized';
    }

    case 'disk_set_partition_flag': {
      if (!entry) return '';
      const { device, partNumber, flag, stateOn } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safeNum = validateInt(partNumber, 1, 128, 'partition number');
      const safeFlag = validateSafeToken(flag, /^[a-z_]+$/, 'partition flag');
      const stateStr = stateOn ? 'on' : 'off';
      const res = await runRemotePrivExec(entry, `command -v parted >/dev/null 2>&1 || { echo "Missing required dependency 'parted'." >&2; exit 127; }; parted -s -- ${shellQuote(safeDev)} set ${safeNum} ${safeFlag} ${stateStr} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to set partition flag');
      return res.stdout || 'Flag updated';
    }

    case 'disk_format_filesystem': {
      if (!entry) return '';
      const { device, fstype = 'ext4', label, quick } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const safeFs = validateSafeToken(fstype, /^[a-z0-9._-]+$/i, 'filesystem type');
      const lblOpt = label ? `-L ${shellQuote(String(label).slice(0, 32))}` : '';
      const qOpt = quick ? '-F' : '';
      const qDev = shellQuote(safeDev);
      const guard = `set -e; [ -b ${qDev} ]; DEV_REAL=$(readlink -f -- ${qDev}); NODES=$(lsblk -nrpo NAME "$DEV_REAL"); SWAP_NODES=$(swapon --noheadings --raw --show=NAME 2>/dev/null || true); for N in $NODES; do findmnt -rn -S "$N" >/dev/null 2>&1 && { echo "Refusing format: $N is mounted" >&2; exit 31; }; for S in $SWAP_NODES; do [ "$(readlink -f -- "$S" 2>/dev/null)" = "$(readlink -f -- "$N" 2>/dev/null)" ] && { echo "Refusing format: $N is active swap" >&2; exit 32; }; done; done`;
      const res = await runRemotePrivExec(entry, `${guard}; mkfs -t ${safeFs} ${lblOpt} ${qOpt} -- ${qDev} 2>&1`);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to format filesystem');
      appendAuditEvent({ event: 'disk_format_filesystem', username: currentSession?.username || '', ip: clientIp, device: safeDev, fstype: safeFs, status: 'ok' });
      return res.stdout || 'Formatted';
    }

    case 'disk_set_label': {
      if (!entry) return '';
      const { device, fstype, label } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const cleanLabel = String(label ?? '').replace(/[\0\r\n]/g, '').slice(0, 32);
      const qDev = shellQuote(safeDev);
      const qLabel = shellQuote(cleanLabel);
      let cmd = `e2label -- ${qDev} ${qLabel} 2>&1`;
      if (String(fstype || '').toLowerCase() === 'xfs') cmd = `xfs_admin -L ${qLabel} -- ${qDev} 2>&1`;
      const res = await runRemotePrivExec(entry, cmd);
      return res.stdout || 'Label set';
    }

    case 'disk_check_filesystem': {
      if (!entry) return '';
      const { device, repair } = args || {};
      const safeDev = validateSafeToken(device, /^\/dev\/[A-Za-z0-9._\/-]+$/, 'device path');
      const opt = repair ? '-y' : '-n';
      const res = await runRemotePrivExec(entry, `fsck ${opt} -- ${shellQuote(safeDev)} 2>&1`);
      return res.stdout || res.stderr || 'Check completed';
    }

    case 'disk_get_swap_info': {
      if (!entry) {
        return { total_bytes: 0, used_bytes: 0, free_bytes: 0, total_formatted: '0 B', used_formatted: '0 B', free_formatted: '0 B', is_enabled: false };
      }
      const res = await runRemoteExec(entry.client, 'cat /proc/swaps 2>/dev/null; cat /proc/meminfo 2>/dev/null');
      let total = 0, free = 0;
      for (const line of res.stdout.split('\n')) {
        if (line.includes('SwapTotal:')) total = parseInt(line.split(':')[1], 10) * 1024;
        if (line.includes('SwapFree:')) free = parseInt(line.split(':')[1], 10) * 1024;
      }
      const used = Math.max(0, total - free);
      return {
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        total_formatted: formatBytes(total),
        used_formatted: formatBytes(used),
        free_formatted: formatBytes(free),
        is_enabled: total > 0
      };
    }

    case 'disk_get_tmp_info': {
      if (!entry) {
        return { mount_point: '/tmp', filesystem: 'tmpfs', is_tmpfs: true, total_bytes: 0, used_bytes: 0, avail_bytes: 0, size_formatted: '0 B', used_formatted: '0 B', avail_formatted: '0 B', percent: 0 };
      }
      const res = await runRemoteExec(entry.client, 'df -B1 /tmp 2>/dev/null');
      const lines = res.stdout.trim().split('\n');
      if (lines.length >= 2) {
        const p = lines[1].trim().split(/\s+/);
        const total = parseInt(p[1], 10) || 0;
        const used = parseInt(p[2], 10) || 0;
        const avail = parseInt(p[3], 10) || 0;
        return {
          mount_point: '/tmp',
          filesystem: p[0],
          is_tmpfs: p[0].includes('tmpfs'),
          total_bytes: total,
          used_bytes: used,
          avail_bytes: avail,
          size_formatted: formatBytes(total),
          used_formatted: formatBytes(used),
          avail_formatted: formatBytes(avail),
          percent: parseFloat((p[4] || '0').replace('%', '')) || 0
        };
      }
      return { mount_point: '/tmp', filesystem: 'tmpfs', is_tmpfs: true, total_bytes: 0, used_bytes: 0, avail_bytes: 0, size_formatted: '0 B', used_formatted: '0 B', avail_formatted: '0 B', percent: 0 };
    }

    case 'disk_manage_swap': {
      if (!entry) throw new Error('No active SSH connection');
      const act = String(args?.action || '').trim().toLowerCase();
      const rawMb = args?.size_mb ?? args?.sizeMb ?? 2048;
      const targetMb = Number(rawMb);
      if (act === 'set_size' && (!Number.isInteger(targetMb) || (targetMb !== 0 && (targetMb < 64 || targetMb > 65536)))) {
        throw new Error('Invalid swap size: must be 0 (remove) or an integer between 64 and 65536 MiB');
      }

      let script = '';
      if (act === 'disable') {
        script = 'swapoff -a 2>/dev/null || true\necho "Swap successfully disabled."';
      } else if (act === 'enable') {
        script = 'if [ -f /swapfile ]; then swapon /swapfile 2>/dev/null || swapon -a; else swapon -a; fi\necho "Swap successfully enabled."';
      } else if (act === 'set_size') {
        if (targetMb === 0) {
          script = "swapoff -a 2>/dev/null || true\nrm -f /swapfile\nsed -i '\\#^/swapfile[[:space:]]#d' /etc/fstab 2>/dev/null || true\necho \"Swapfile successfully removed.\"";
        } else {
          script = `set -e\nTARGET_MB=${targetMb}\nswapoff -a 2>/dev/null || true\nif ! fallocate -l "\${TARGET_MB}M" /swapfile 2>/dev/null; then\n  dd if=/dev/zero of=/swapfile bs=1M count="$TARGET_MB" status=none\nfi\nchmod 600 /swapfile\nmkswap /swapfile\nswapon /swapfile\nif ! grep -qEs '^[[:space:]]*/swapfile[[:space:]]' /etc/fstab; then\n  printf '\\n/swapfile none swap sw 0 0\\n' >> /etc/fstab\nfi\necho "Successfully configured swap space to ${targetMb} MB (/swapfile active)."`;
        }
      } else {
        throw new Error(`Unknown swap action '${act}'`);
      }

      const res = await runRemotePrivExec(entry, script, 90000);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Swap management failed');
      return res.stdout.trim();
    }

    case 'disk_manage_tmp': {
      if (!entry) throw new Error('No active SSH connection');
      const size = validateSafeToken(String(args?.size || '').trim().toUpperCase(), /^\d+(?:\.\d+)?[KMGT%]?$/, '/tmp size');
      const persist = Boolean(args?.persist);
      const qSize = shellQuote(size);

      let script = `set -e\nSIZE=${qSize}\nif findmnt -n -o FSTYPE /tmp 2>/dev/null | grep -qi "tmpfs"; then\n  mount -o remount,size="$SIZE" /tmp\nelse\n  mount -t tmpfs -o size="$SIZE",mode=1777 tmpfs /tmp\nfi\n`;
      if (persist) {
        script += `if grep -qEs '^[[:space:]]*[^#].*[[:space:]]/tmp[[:space:]]' /etc/fstab; then\n  sed -i -E "s|^([[:space:]]*[^#].*[[:space:]]/tmp[[:space:]].*)|tmpfs /tmp tmpfs defaults,noatime,mode=1777,size=$SIZE 0 0|" /etc/fstab\nelse\n  printf "\\ntmpfs /tmp tmpfs defaults,noatime,mode=1777,size=%s 0 0\\n" "$SIZE" >> /etc/fstab\nfi\n`;
      }
      script += `echo "Successfully configured /tmp space to $SIZE"`;

      const res = await runRemotePrivExec(entry, script, 30000);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Tmp space configuration failed');
      return res.stdout.trim();
    }

    // ==========================================
    // 15. SFTP File Suite
    // ==========================================
    case 'sftp_list_dir': {
      const target = args?.path || '/root';
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        try {
          const dirents = fs.readdirSync(target, { withFileTypes: true });
          const results = [];
          for (const d of dirents) {
            if (results.length >= 10000) break;
            try {
              const full = path.join(target, d.name);
              const st = fs.statSync(full);
              const isDir = d.isDirectory();
              const isLink = d.isSymbolicLink();
              results.push({
                name: d.name,
                path: full.replace(/\\/g, '/'),
                is_dir: isDir,
                is_file: !isDir && !isLink,
                is_symlink: isLink,
                size: st.size,
                size_formatted: formatBytes(st.size),
                permissions: formatPermissions(st.mode),
                modified: Math.floor(st.mtimeMs),
                modified_formatted: new Date(st.mtimeMs).toLocaleString(),
                owner: 'root',
                group: 'root'
              });
            } catch {}
          }
          results.sort((a, b) => (a.is_dir && !b.is_dir ? -1 : !a.is_dir && b.is_dir ? 1 : a.name.localeCompare(b.name)));
          return results;
        } catch {
          return [];
        }
      }
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        sftp.readdir(target, (err, list) => {
          if (err) return reject(new Error(`sftp_list_dir failed on '${target}': ${err.message}`));
          const results = (list || []).slice(0, 10000).map(item => {
            const isDir = (item.attrs.mode & 0o040000) !== 0;
            const isLink = (item.attrs.mode & 0o120000) === 0o120000;
            const size = item.attrs.size || 0;
            const mtime = item.attrs.mtime ? item.attrs.mtime * 1000 : Date.now();
            return {
              name: item.filename,
              path: path.posix.join(target, item.filename),
              is_dir: isDir,
              is_file: !isDir && !isLink,
              is_symlink: isLink,
              size,
              size_formatted: formatBytes(size),
              permissions: formatPermissions(item.attrs.mode),
              modified: mtime,
              modified_formatted: new Date(mtime).toLocaleString(),
              owner: item.attrs.uid !== undefined ? String(item.attrs.uid) : '',
              group: item.attrs.gid !== undefined ? String(item.attrs.gid) : ''
            };
          });
          results.sort((a, b) => (a.is_dir && !b.is_dir ? -1 : !a.is_dir && b.is_dir ? 1 : a.name.localeCompare(b.name)));
          resolve(results);
        });
      });
    }

    case 'sftp_read_text_file': {
      const targetPath = String(args?.path || '').trim();
      if (!targetPath) throw new Error('Missing file path');
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        return fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
      }
      const MAX_SFTP_READ = 48 * 1024 * 1024;
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(targetPath);
        const chunks = [];
        let total = 0;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { stream.destroy(); } catch {}
          reject(new Error('SFTP text read timed out after 30s'));
        }, 30000);
        stream.on('data', chunk => {
          if (settled) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_SFTP_READ) {
            settled = true;
            clearTimeout(timer);
            try { stream.destroy(); } catch {}
            return reject(new Error('Remote file exceeds 48 MiB read limit'));
          }
          chunks.push(buf);
        });
        stream.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(Buffer.concat(chunks, total).toString('utf8'));
        });
        stream.on('error', err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    case 'sftp_read_file_base64': {
      const targetPath = String(args?.path || '').trim();
      if (!targetPath) throw new Error('Missing file path');
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        return fs.existsSync(targetPath) ? fs.readFileSync(targetPath).toString('base64') : '';
      }
      const MAX_SFTP_READ = 48 * 1024 * 1024;
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(targetPath);
        const chunks = [];
        let total = 0;
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try { stream.destroy(); } catch {}
          reject(new Error('SFTP binary read timed out after 30s'));
        }, 30000);
        stream.on('data', chunk => {
          if (settled) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > MAX_SFTP_READ) {
            settled = true;
            clearTimeout(timer);
            try { stream.destroy(); } catch {}
            return reject(new Error('Remote file exceeds 48 MiB read limit'));
          }
          chunks.push(buf);
        });
        stream.on('end', () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(Buffer.concat(chunks, total).toString('base64'));
        });
        stream.on('error', err => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(err);
        });
      });
    }

    case 'sftp_write_text_file': {
      const targetPath = String(args?.path || '').trim();
      if (!targetPath) throw new Error('Missing destination path');
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        fs.writeFileSync(targetPath, args?.content || '', { encoding: 'utf8', mode: 0o600 });
        return true;
      }
      const textContent = String(args?.content ?? '');
      const expectedHash = String(args?.expectedHash || args?.expected_hash || '').trim().toLowerCase();
      if (expectedHash && /^[a-f0-9]{64}$/.test(expectedHash)) {
        const hashCheck = await runRemoteExec(entry.client, `(sha256sum ${shellQuote(targetPath)} 2>/dev/null || shasum -a 256 ${shellQuote(targetPath)} 2>/dev/null) | awk '{print $1}'`);
        const remoteHash = (hashCheck.stdout || '').trim().toLowerCase();
        if (remoteHash && remoteHash !== expectedHash) {
          throw new Error('CONFLICT_DETECTED: Remote file changed on disk since it was opened.');
        }
      }
      const buf = Buffer.from(textContent, 'utf8');
      if (buf.length > 48 * 1024 * 1024) throw new Error('Upload exceeds 48 MiB limit');
      try {
        let sftp = entry.sftp || await getSftp(entry.client);
        const dirName = path.posix.dirname(targetPath);
        const baseName = path.posix.basename(targetPath);
        const atomicTmp = `${dirName}/.${baseName}.sshdesktop_${crypto.randomBytes(6).toString('hex')}.tmp`;
        await new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(atomicTmp, { flags: 'w' });
          stream.on('close', () => resolve());
          stream.on('error', err => reject(err));
          stream.end(buf);
        });
        await new Promise((resolve, reject) => {
          sftp.rename(atomicTmp, targetPath, (err) => {
            if (err) {
              // Some SFTP servers don't overwrite on rename; unlink+rename or clean up temp
              sftp.unlink(atomicTmp, () => {});
              reject(err);
            } else {
              resolve();
            }
          });
        });
        appendAuditEvent({ event: 'sftp_write', target: targetPath, bytes: buf.length, status: 'ok' });
        return true;
      } catch (err) {
        const b64 = buf.toString('base64');
        const tmpFile = `/tmp/.sshdesktop_up_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const qTmp = shellQuote(tmpFile);
        const qDst = shellQuote(targetPath);
        const tmpRes = await runRemoteExecWithStdin(entry.client, `umask 077 && (base64 -d || base64 -D) > ${qTmp}`, b64, 60000);
        if (tmpRes.exit_code === 0) {
          const mvCmd = `if [ -f ${qDst} ] && [ ! -L ${qDst} ]; then chmod $(stat -c '%a' ${qDst} 2>/dev/null || echo 600) ${qTmp} 2>/dev/null || chmod 600 ${qTmp}; else chmod 600 ${qTmp}; fi && mv -f -- ${qTmp} ${qDst}`;
          const mvRes = await runRemotePrivExec(entry, mvCmd);
          if (mvRes.exit_code === 0) {
            appendAuditEvent({ event: 'sftp_write_priv', target: targetPath, bytes: buf.length, status: 'ok' });
            return true;
          }
          await runRemoteExec(entry.client, `rm -f -- ${qTmp}`);
        }
        throw err;
      }
    }

    case 'sftp_write_file': {
      const targetPath = String(args?.path || '').trim();
      if (!targetPath) throw new Error('Missing destination path');
      const buf = Array.isArray(args?.content) ? Buffer.from(args.content) : Buffer.from(args?.content || '');
      if (buf.length > 48 * 1024 * 1024) throw new Error('Upload exceeds 48 MiB limit');
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        fs.writeFileSync(targetPath, buf, { mode: 0o600 });
        return true;
      }
      try {
        let sftp = entry.sftp || await getSftp(entry.client);
        await new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(targetPath, { flags: 'w' });
          stream.on('close', () => resolve());
          stream.on('error', err => reject(err));
          stream.end(buf);
        });
        appendAuditEvent({ event: 'sftp_write', target: targetPath, bytes: buf.length, status: 'ok' });
        return true;
      } catch (err) {
        const b64 = buf.toString('base64');
        const tmpFile = `/tmp/.sshdesktop_up_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
        const qTmp = shellQuote(tmpFile);
        const qDst = shellQuote(targetPath);
        const tmpRes = await runRemoteExecWithStdin(entry.client, `umask 077 && (base64 -d || base64 -D) > ${qTmp}`, b64, 60000);
        if (tmpRes.exit_code === 0) {
          const mvCmd = `if [ -f ${qDst} ] && [ ! -L ${qDst} ]; then chmod $(stat -c '%a' ${qDst} 2>/dev/null || echo 600) ${qTmp} 2>/dev/null || chmod 600 ${qTmp}; else chmod 600 ${qTmp}; fi && mv -f -- ${qTmp} ${qDst}`;
          const mvRes = await runRemotePrivExec(entry, mvCmd);
          if (mvRes.exit_code === 0) {
            appendAuditEvent({ event: 'sftp_write_priv', target: targetPath, bytes: buf.length, status: 'ok' });
            return true;
          }
          await runRemoteExec(entry.client, `rm -f -- ${qTmp}`);
        }
        throw err;
      }
    }

    case 'sftp_mkdir': {
      if (!entry) return;
      const qPath = shellQuote(args?.path);
      const res = await runRemoteExec(entry.client, `mkdir -p -- ${qPath} 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `mkdir -p -- ${qPath}`);
      }
      return;
    }

    case 'sftp_delete': {
      if (!entry) return;
      const target = String(args?.path || '').trim();
      if (!target || target === '/') throw new Error('Refusing unsafe delete target');
      const qPath = shellQuote(target);
      const res = await runRemoteExec(entry.client, `rm -rf -- ${qPath} 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `rm -rf -- ${qPath}`);
      }
      return;
    }

    case 'sftp_rename': {
      if (!entry) return;
      const qOld = shellQuote(args?.oldPath);
      const qNew = shellQuote(args?.newPath);
      const res = await runRemoteExec(entry.client, `mv -- ${qOld} ${qNew} 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `mv -- ${qOld} ${qNew}`);
      }
      return;
    }

    case 'sftp_chmod': {
      if (!entry) return;
      const octal = (Number(args?.mode) & 0o777).toString(8);
      const qPath = shellQuote(args?.path);
      const res = await runRemoteExec(entry.client, `chmod ${octal} -- ${qPath} 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `chmod ${octal} -- ${qPath}`);
      }
      return;
    }

    case 'sftp_chown': {
      if (!entry) return;
      const owner = validateSafeToken(args?.owner, /^[a-zA-Z0-9._-]+$/, 'owner');
      const group = args?.group ? validateSafeToken(args.group, /^[a-zA-Z0-9._-]+$/, 'group') : '';
      const ownership = group ? `${owner}:${group}` : owner;
      const qPath = shellQuote(args?.path);
      const res = await runRemoteExec(entry.client, `chown -- ${shellQuote(ownership)} ${qPath} 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `chown -- ${shellQuote(ownership)} ${qPath}`);
      }
      return;
    }

    case 'sftp_stat': {
      if (!entry) return null;
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        sftp.stat(args?.path, (err, stats) => {
          if (err) return reject(err);
          resolve({
            size: stats.size,
            size_formatted: formatBytes(stats.size),
            is_dir: (stats.mode & 0o040000) !== 0,
            modified: stats.mtime * 1000,
            permissions: formatPermissions(stats.mode)
          });
        });
      });
    }

    case 'sftp_create_zip_pure': {
      if (!entry) throw new Error('No active SSH connection');
      const baseDir = args?.base_dir || args?.baseDir || '/';
      const items = Array.isArray(args?.items) ? args.items : [];
      const outputFilename = args?.output_filename || args?.outputFilename || 'archive.zip';
      if (items.length === 0) throw new Error('No items selected to archive');

      const cleanDir = (!baseDir || baseDir === '/') ? '/' : baseDir.replace(/\/+$/, '');
      const escapedDir = cleanDir.replace(/'/g, "'\\''");
      const escapedOut = outputFilename.replace(/'/g, "'\\''");
      const escapedItems = items.map(it => `'${String(it).replace(/'/g, "'\\''")}'`).join(' ');

      const lower = outputFilename.toLowerCase();
      let cmd = '';
      if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        cmd = `cd '${escapedDir}' && tar -czvf '${escapedOut}' ${escapedItems}`;
      } else if (lower.endsWith('.tar.bz2')) {
        cmd = `cd '${escapedDir}' && tar -cjvf '${escapedOut}' ${escapedItems}`;
      } else if (lower.endsWith('.tar.xz')) {
        cmd = `cd '${escapedDir}' && tar -cJvf '${escapedOut}' ${escapedItems}`;
      } else if (lower.endsWith('.tar')) {
        cmd = `cd '${escapedDir}' && tar -cvf '${escapedOut}' ${escapedItems}`;
      } else if (lower.endsWith('.zip')) {
        cmd = `cd '${escapedDir}' && (command -v zip >/dev/null 2>&1 && zip -r '${escapedOut}' ${escapedItems} || python3 -m zipfile -c '${escapedOut}' ${escapedItems})`;
      } else {
        cmd = `cd '${escapedDir}' && tar -czvf '${escapedOut}' ${escapedItems}`;
      }

      const res = await runRemotePrivExec(entry, cmd, 120000);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Archive creation failed');
      return `${cleanDir}/${outputFilename}`;
    }

    case 'sftp_extract_archive_pure': {
      if (!entry) throw new Error('No active SSH connection');
      const archivePath = args?.archive_path || args?.archivePath || '';
      const destDir = args?.dest_dir || args?.destDir || '/';
      if (!archivePath) throw new Error('Missing archive path');

      const cleanDest = (!destDir || destDir === '/') ? '/' : destDir.replace(/\/+$/, '');
      const escapedArch = archivePath.replace(/'/g, "'\\''");
      const escapedDest = cleanDest.replace(/'/g, "'\\''");
      const lower = archivePath.toLowerCase();

      // Pre-validate archive entries against ZipSlip / tar path traversal & absolute paths
      const listCmd = lower.endsWith('.zip')
        ? `(command -v unzip >/dev/null 2>&1 && unzip -Z1 '${escapedArch}' || python3 -c "import sys,zipfile;print('\\n'.join(zipfile.ZipFile(sys.argv[1]).namelist()))" '${escapedArch}')`
        : `tar -tf '${escapedArch}'`;
      const listRes = await runRemotePrivExec(entry, listCmd, 60000);
      if (listRes.exit_code !== 0) throw new Error('Unable to inspect archive contents before extraction');
      for (const member of listRes.stdout.split('\n')) {
        const trimmed = member.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('/') || trimmed.split('/').includes('..')) {
          throw new Error(`Unsafe archive entry rejected (path traversal): ${trimmed}`);
        }
      }

      let cmd = '';
      if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        cmd = `mkdir -p '${escapedDest}' && tar --no-same-owner --no-same-permissions -xzvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar.bz2')) {
        cmd = `mkdir -p '${escapedDest}' && tar --no-same-owner --no-same-permissions -xjvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar.xz')) {
        cmd = `mkdir -p '${escapedDest}' && tar --no-same-owner --no-same-permissions -xJvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar')) {
        cmd = `mkdir -p '${escapedDest}' && tar --no-same-owner --no-same-permissions -xvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.zip')) {
        cmd = `mkdir -p '${escapedDest}' && (command -v unzip >/dev/null 2>&1 && unzip -o '${escapedArch}' -d '${escapedDest}' || python3 -m zipfile -e '${escapedArch}' '${escapedDest}')`;
      } else {
        cmd = `mkdir -p '${escapedDest}' && tar --no-same-owner --no-same-permissions -xvf '${escapedArch}' -C '${escapedDest}'`;
      }

      const res = await runRemotePrivExec(entry, cmd, 120000);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Archive extraction failed');
      appendAuditEvent({ event: 'sftp_extract', target: archivePath, dest: cleanDest, status: 'ok' });
      return cleanDest;
    }

    case 'sftp_folder_size': {
      if (!entry) return '—';
      const res = await runRemoteExec(entry.client, `du -sh -- ${shellQuote(args?.path)} 2>/dev/null | cut -f1`);
      return res.stdout.trim() || '—';
    }

    // ==========================================
    // 16. Terminal PTY Engine
    // ==========================================
    case 'terminal_create': {
      const { rows = 24, cols = 80, terminalId } = args || {};
      const termId = terminalId || `term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_SHELL !== 'true') {
          throw new Error('No active SSH connection available. Local host shell execution is disabled.');
        }
        // Local interactive shell fallback
        return new Promise((resolve) => {
          const shellCmd = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
          const proc = child_process.spawn(shellCmd, [], {
            env: { ...process.env, TERM: 'xterm-256color' }
          });
          activeTerminals.set(termId, {
            stream: {
              write: (d) => proc.stdin && proc.stdin.write(d),
              once: (event, callback) => proc.stdin && proc.stdin.once(event, callback),
              end: () => proc.kill(),
              setWindow: () => {}
            },
            connId: 'local',
            buffer: ''
          });
          pendingTerminalResizes.delete(termId);
          proc.stdout.on('data', chunk => {
            const text = chunk.toString('utf8');
            sendTerminalOutput(termId, text);
          });
          proc.stderr.on('data', chunk => {
            const text = chunk.toString('utf8');
            sendTerminalOutput(termId, text);
          });
          proc.on('close', () => {
            activeTerminals.delete(termId);
            pendingTerminalResizes.delete(termId);
            const ws = activeWsClients.get(termId);
            if (ws) {
              try { ws.close(); } catch {}
              activeWsClients.delete(termId);
            }
          });
          resolve(termId);
        });
      }

      return new Promise((resolve, reject) => {
        const pending = pendingTerminalResizes.get(termId);
        pendingTerminalResizes.delete(termId);
        const actualCols = pending?.cols || cols || 80;
        const actualRows = pending?.rows || rows || 24;

        entry.client.shell({ term: 'xterm-256color', rows: actualRows, cols: actualCols }, (err, stream) => {
          if (err) return reject(new Error(`Terminal spawn failed: ${err.message}`));
          activeTerminals.set(termId, { stream, connId, buffer: '' });
          if (pending && typeof stream.setWindow === 'function') {
            try { stream.setWindow(pending.rows, pending.cols, 0, 0); } catch {}
          }

          stream.on('data', chunk => {
            const text = chunk.toString('utf8');
            sendTerminalOutput(termId, text);
          });

          stream.on('close', () => {
            activeTerminals.delete(termId);
            pendingTerminalResizes.delete(termId);
            const ws = activeWsClients.get(termId);
            if (ws) {
              try { ws.close(); } catch {}
              activeWsClients.delete(termId);
            }
          });

          resolve(termId);
        });
      });
    }

    case 'terminal_write': {
      const { terminalId, data } = args || {};
      const session = activeTerminals.get(terminalId);
      if (session && session.stream) {
        if (Array.isArray(data)) session.stream.write(Buffer.from(data));
        else if (typeof data === 'string') session.stream.write(data);
      }
      return undefined;
    }

    case 'terminal_resize': {
      const { terminalId, rows, cols } = args || {};
      if (terminalId && rows && cols) {
        pendingTerminalResizes.set(terminalId, { rows, cols });
      }
      const session = activeTerminals.get(terminalId);
      if (session && session.stream && typeof session.stream.setWindow === 'function') {
        try {
          session.stream.setWindow(rows || 24, cols || 80, 0, 0);
        } catch {}
      }
      return undefined;
    }

    case 'terminal_close': {
      const session = activeTerminals.get(args?.terminalId);
      if (session) {
        try { session.stream.end(); } catch {}
        activeTerminals.delete(args?.terminalId);
      }
      return undefined;
    }

    // ==========================================
    // 17. Local Profile & Settings Persistence
    // ==========================================
    case 'store_list_connections': {
      return readJsonSafe(CONNECTIONS_FILE, []);
    }

    case 'store_upload_key': {
      const { key, id, name } = args || {};
      const targetId = id || name || `key_${Date.now()}`;
      const savedPath = ensureKeyFile(targetId, key);
      return {
        success: Boolean(savedPath),
        path: savedPath,
        message: savedPath ? 'Private key saved successfully' : 'Failed to save private key'
      };
    }

    case 'store_save_connection': {
      const { connection } = args || {};
      if (!connection) return null;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const sanitized = { ...connection };
      if (!sanitized.id) sanitized.id = `conn-${Date.now()}`;

      // Securely store private key PEM file with 0600 permissions
      const rawKey = sanitized.private_key || sanitized.privateKey || sanitized.privateKeyPath || sanitized.private_key_path;
      if (rawKey && typeof rawKey === 'string' && rawKey.trim()) {
        const savedPath = ensureKeyFile(sanitized.id, rawKey);
        if (savedPath) {
          sanitized.privateKeyPath = savedPath;
          sanitized.private_key_path = savedPath;
        }
      }
      delete sanitized.private_key;
      delete sanitized.privateKey;

      const idx = list.findIndex(c => c.id === sanitized.id);
      if (idx >= 0) list[idx] = sanitized;
      else list.push(sanitized);
      writeJsonSafe(CONNECTIONS_FILE, list);
      return sanitized.id;
    }

    case 'store_delete_connection': {
      const connId = args?.id;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const conn = list.find(c => c.id === connId);
      if (conn) {
        const keyPath = conn.privateKeyPath || conn.private_key_path;
        if (keyPath && typeof keyPath === 'string' && keyPath.startsWith(KEYS_DIR) && fs.existsSync(keyPath)) {
          try { fs.unlinkSync(keyPath); } catch {}
        }
      }
      writeJsonSafe(CONNECTIONS_FILE, list.filter(c => c.id !== connId));
      return true;
    }

    case 'store_update_connection': {
      const conn = args?.connection || args;
      if (!conn || !conn.id) return false;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const idx = list.findIndex(c => c.id === conn.id);
      if (idx === -1) return false;
      const sanitized = { ...list[idx], ...conn };
      const rawKey = sanitized.private_key || sanitized.privateKey;
      if (rawKey && typeof rawKey === 'string' && rawKey.trim()) {
        const savedPath = ensureKeyFile(sanitized.id, rawKey);
        if (savedPath) {
          sanitized.privateKeyPath = savedPath;
          sanitized.private_key_path = savedPath;
        }
      }
      delete sanitized.private_key;
      delete sanitized.privateKey;
      list[idx] = sanitized;
      writeJsonSafe(CONNECTIONS_FILE, list);
      return true;
    }

    case 'settings_get': {
      return readJsonSafe(SETTINGS_FILE, { theme: 'catppuccin-mocha', accentColor: 'blue', fontSize: 14 });
    }

    case 'settings_save': {
      if (args?.settings) writeJsonSafe(SETTINGS_FILE, args.settings);
      return;
    }

    case 'store_secret_save': {
      const validKey = validateVaultKeyName(args?.key);
      const val = String(args?.value ?? '');
      if (Buffer.byteLength(val, 'utf8') > 64 * 1024) {
        throw new Error('Secret value exceeds the 64 KiB limit.');
      }
      const vault = readJsonSafe(VAULT_FILE, {});
      if (!val) {
        delete vault[validKey];
      } else {
        vault[validKey] = vaultEncryptValue(val);
      }
      if (!writeJsonSafe(VAULT_FILE, vault)) {
        throw new Error('Failed to persist encrypted credential vault.');
      }
      return true;
    }

    case 'store_secret_load': {
      const validKey = validateVaultKeyName(args?.key);
      const vault = readJsonSafe(VAULT_FILE, {});
      if (!vault[validKey]) return null;
      return vaultDecryptValue(vault[validKey]);
    }

    case 'store_secret_delete': {
      const validKey = validateVaultKeyName(args?.key);
      const vault = readJsonSafe(VAULT_FILE, {});
      if (validKey in vault) {
        delete vault[validKey];
        writeJsonSafe(VAULT_FILE, vault);
      }
      return true;
    }

    // ==========================================
    // 18. API Studio & HTTP Client
    // ==========================================
    case 'network_interfaces': {
      return await handleInvokeCommand('system_get_network', args, currentSession, clientIp);
    }

    case 'browser_proxy_fetch': {
      const rawUrl = args?.url;
      if (!rawUrl) throw new Error('Missing URL');
      let parsedUrl;
      try {
        parsedUrl = new URL(String(rawUrl));
      } catch {
        throw new Error('Invalid URL');
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are supported');
      }
      const hostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const isInternal = hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.') ||
        hostname.startsWith('169.254.') || hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) || hostname === '0.0.0.0' || hostname.endsWith('.internal') || hostname.endsWith('.local');
      if (isInternal) {
        throw new Error('Direct host fetch to internal or loopback addresses is disabled; use the SSH browser gateway.');
      }
      const MAX_PROXY_BYTES = 10 * 1024 * 1024;
      try {
        const resp = await fetch(parsedUrl.toString(), {
          redirect: 'manual',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const status = resp.status;
        const final_url = resp.url || parsedUrl.toString();
        const contentType = resp.headers.get('content-type') || 'text/html';
        let body = '';
        if (resp.body && typeof resp.body.getReader === 'function') {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let received = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value ? value.length : 0;
            if (received > MAX_PROXY_BYTES) {
              try { reader.cancel(); } catch {}
              throw new Error('Proxy response exceeded 10 MiB limit');
            }
            if (value) body += decoder.decode(value, { stream: true });
          }
        } else {
          body = await resp.text();
          if (Buffer.byteLength(body, 'utf8') > MAX_PROXY_BYTES) {
            body = body.slice(0, MAX_PROXY_BYTES);
          }
        }

        if (contentType.includes('text/html')) {
          const baseTag = `<base href="${escapeHtml(final_url)}" />\n`;
          const headMatch = body.match(/<head\b[^>]*>/i);
          if (headMatch && headMatch.index !== undefined) {
            const insertIdx = headMatch.index + headMatch[0].length;
            body = body.slice(0, insertIdx) + `\n${baseTag}` + body.slice(insertIdx);
          } else {
            const htmlMatch = body.match(/<html\b[^>]*>/i);
            if (htmlMatch && htmlMatch.index !== undefined) {
              const insertIdx = htmlMatch.index + htmlMatch[0].length;
              body = body.slice(0, insertIdx) + `\n<head>${baseTag}</head>` + body.slice(insertIdx);
            } else {
              body = baseTag + body;
            }
          }
        }

        return {
          status,
          content_type: contentType,
          body,
          final_url
        };
      } catch (err) {
        return {
          status: 500,
          content_type: 'text/html',
          body: `<html><body><h3>Proxy request to '${escapeHtml(rawUrl)}' failed: ${escapeHtml(err.message)}</h3></body></html>`,
          final_url: String(rawUrl)
        };
      }
    }

    case 'network_bandwidth_stats': {
      if (!entry || !entry.client) {
        return {
          interfaces: [],
          total_rx_bytes: 0,
          total_tx_bytes: 0,
          total_rx_speed_bps: 0,
          total_tx_speed_bps: 0,
          total_rx_packets: 0,
          total_tx_packets: 0,
          timestamp: Date.now()
        };
      }
      const probeScript = `
D1=$(cat /proc/net/dev 2>/dev/null)
sleep 0.4
D2=$(cat /proc/net/dev 2>/dev/null)
echo "===DEV1==="
echo "$D1"
echo "===DEV2==="
echo "$D2"
echo "===ADDR==="
ip -o addr show 2>/dev/null || ifconfig 2>/dev/null || true
echo "===SYSNET==="
for iface in /sys/class/net/*; do
  [ -d "$iface" ] || continue
  bn=$(basename "$iface")
  oper=$(cat "$iface/operstate" 2>/dev/null || echo "unknown")
  mtu=$(cat "$iface/mtu" 2>/dev/null || echo "0")
  spd=$(cat "$iface/speed" 2>/dev/null || echo "0")
  mac=$(cat "$iface/address" 2>/dev/null || echo "-")
  echo "$bn|$oper|$mtu|$spd|$mac"
done
`;
      const res = await runRemoteExec(entry.client, probeScript, 10000);
      const out = res.stdout;
      const dev1Raw = (out.split('===DEV1===')[1] || '').split('===DEV2===')[0] || '';
      const dev2Raw = (out.split('===DEV2===')[1] || '').split('===ADDR===')[0] || '';
      const addrRaw = (out.split('===ADDR===')[1] || '').split('===SYSNET===')[0] || '';
      const sysRaw = out.split('===SYSNET===')[1] || '';

      const ifaceIps = {};
      for (const line of addrRaw.split('\n')) {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length >= 4 && (tokens[2] === 'inet' || tokens[2] === 'inet6')) {
          const iface = tokens[1].replace(/:$/, '');
          const ip = tokens[3].split('/')[0];
          if (!ifaceIps[iface]) ifaceIps[iface] = ip;
        }
      }

      const ifaceSys = {};
      for (const line of sysRaw.split('\n')) {
        const parts = line.split('|');
        if (parts.length >= 5) {
          const bn = parts[0].trim();
          ifaceSys[bn] = {
            operstate: parts[1].trim(),
            mtu: parseInt(parts[2], 10) || 0,
            speed_mbit: parseInt(parts[3], 10) || 0,
            mac: parts[4].trim()
          };
        }
      }

      const dev1Bytes = {};
      for (const line of dev1Raw.split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 10 && p[0].includes(':')) {
          const name = p[0].replace(/:$/, '');
          const rx = parseInt(p[1], 10) || 0;
          const tx = parseInt(p[9], 10) || 0;
          dev1Bytes[name] = { rx, tx };
        }
      }

      const interfaces = [];
      let totalRxBytes = 0;
      let totalTxBytes = 0;
      let totalRxSpeed = 0;
      let totalTxSpeed = 0;
      let totalRxPackets = 0;
      let totalTxPackets = 0;

      for (const line of dev2Raw.split('\n')) {
        const p = line.trim().split(/\s+/);
        if (p.length >= 10 && p[0].includes(':')) {
          const name = p[0].replace(/:$/, '');
          const rxBytes = parseInt(p[1], 10) || 0;
          const rxPackets = parseInt(p[2], 10) || 0;
          const rxErrors = parseInt(p[3], 10) || 0;
          const rxDrops = parseInt(p[4], 10) || 0;

          const txBytes = parseInt(p[9], 10) || 0;
          const txPackets = parseInt(p[10], 10) || 0;
          const txErrors = parseInt(p[11], 10) || 0;
          const txDrops = parseInt(p[12], 10) || 0;

          const prev = dev1Bytes[name] || { rx: rxBytes, tx: txBytes };
          const rxSpeedBps = Math.max(0, (rxBytes - prev.rx) / 0.4);
          const txSpeedBps = Math.max(0, (txBytes - prev.tx) / 0.4);

          const sys = ifaceSys[name] || {};
          const isUp = (sys.operstate || '').toLowerCase() === 'up';

          totalRxBytes += rxBytes;
          totalTxBytes += txBytes;
          totalRxSpeed += rxSpeedBps;
          totalTxSpeed += txSpeedBps;
          totalRxPackets += rxPackets;
          totalTxPackets += txPackets;

          interfaces.push({
            name,
            ip: ifaceIps[name] || '-',
            mac: sys.mac || '-',
            is_up: isUp,
            operstate: sys.operstate || 'unknown',
            mtu: sys.mtu || 1500,
            speed_mbit: sys.speed_mbit || 0,
            rx_bytes: rxBytes,
            tx_bytes: txBytes,
            rx_packets: rxPackets,
            tx_packets: txPackets,
            rx_errors: rxErrors,
            tx_errors: txErrors,
            rx_drops: rxDrops,
            tx_drops: txDrops,
            rx_speed_bps: rxSpeedBps,
            tx_speed_bps: txSpeedBps
          });
        }
      }

      return {
        interfaces,
        total_rx_bytes: totalRxBytes,
        total_tx_bytes: totalTxBytes,
        total_rx_speed_bps: totalRxSpeed,
        total_tx_speed_bps: totalTxSpeed,
        total_rx_packets: totalRxPackets,
        total_tx_packets: totalTxPackets,
        timestamp: Date.now()
      };
    }

    case 'api_send_request': {
      const { req } = args || {};
      if (!req || !req.url) throw new Error('Missing URL');
      if (!req.url.startsWith('http://') && !req.url.startsWith('https://')) {
        throw new Error("Invalid URL scheme: only 'http://' and 'https://' are supported");
      }
      const startTime = Date.now();
      const MAX_API_RESPONSE = 10 * 1024 * 1024; // 10 MB limit

      // Safe POSIX shell argument escaper (prevents command substitution $() and backticks)
      const shellEscape = (val) => `'${String(val || '').replace(/'/g, "'\\''")}'`;

      // Route through SSH when requested and SSH session is available (strict: no direct network fallback)
      if (req.use_ssh_tunnel) {
        if (!entry || !entry.client) {
          throw new Error('SSH connection not available for tunneled API request');
        }
        const method = (req.method || 'GET').toUpperCase();
        if (!/^[A-Z]+$/.test(method)) throw new Error('Invalid HTTP method');
        const targetUrl = req.url;
        let curlCmd = `curl -s -S -i -X ${method} ${shellEscape(targetUrl)}`;
        if (Array.isArray(req.headers)) {
          for (const h of req.headers) {
            if (h.enabled && h.key) {
              curlCmd += ` -H ${shellEscape(`${h.key}: ${h.value ?? ''}`)}`;
            }
          }
        }
        if (req.body_type && req.body_type !== 'none' && req.raw_body) {
          const b64 = Buffer.from(req.raw_body).toString('base64');
          curlCmd = `echo ${shellEscape(b64)} | base64 -d | ${curlCmd} --data-binary @-`;
        }

        const res = await runRemoteExec(entry.client, curlCmd, 30000);
        if (res.exit_code === 0 || res.stdout.includes('HTTP/')) {
          const rawOut = res.stdout;
          const blocks = rawOut.split(/\r?\n\r?\n/);
          let headerPart = '';
          let bodyPart = '';
          let lastHeaderIdx = -1;
          for (let i = 0; i < blocks.length; i++) {
            if (/^HTTP\/\S+\s+\d+/i.test(blocks[i].trim())) {
              lastHeaderIdx = i;
            }
          }
          if (lastHeaderIdx !== -1) {
            headerPart = blocks[lastHeaderIdx];
            bodyPart = blocks.slice(lastHeaderIdx + 1).join('\n\n');
          } else {
            bodyPart = rawOut;
          }

          if (bodyPart.length > MAX_API_RESPONSE) {
            bodyPart = bodyPart.slice(0, MAX_API_RESPONSE) + '\n[Response truncated: 10 MB limit exceeded]';
          }

          const headerLines = headerPart.split(/\r?\n/);
          const statusLine = headerLines[0] || 'HTTP/1.1 200 OK';
          const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d+)\s*(.*)/i);
          const status = statusMatch ? parseInt(statusMatch[1], 10) : 200;
          const statusText = statusMatch ? statusMatch[2] : 'OK';

          const resHeaders = {};
          for (let i = 1; i < headerLines.length; i++) {
            const colonIdx = headerLines[i].indexOf(':');
            if (colonIdx > 0) {
              const k = headerLines[i].slice(0, colonIdx).trim().toLowerCase();
              const v = headerLines[i].slice(colonIdx + 1).trim();
              resHeaders[k] = v;
            }
          }

          let isJson = false;
          try { JSON.parse(bodyPart); isJson = true; } catch {}

          return {
            status,
            status_text: statusText,
            headers: resHeaders,
            body: bodyPart,
            is_json: isJson,
            is_binary: false,
            size_bytes: Buffer.byteLength(bodyPart, 'utf8'),
            duration_ms: Date.now() - startTime,
            tunnel_used: true,
            tunneled_target: `${entry.config?.name || entry.config?.host || 'server'} (via SSH remote curl)`,
            effective_url: targetUrl
          };
        } else {
          throw new Error(res.stderr || `Remote curl execution failed with exit code ${res.exit_code}`);
        }
      }

      // Direct HTTP fetch execution with bounded response size
      try {
        const fetchHeaders = {};
        if (Array.isArray(req.headers)) {
          for (const h of req.headers) {
            if (h.enabled && h.key) fetchHeaders[h.key] = h.value;
          }
        }
        const fetchOptions = { method: req.method || 'GET', headers: fetchHeaders };
        if (req.body_type && req.body_type !== 'none' && req.raw_body) {
          fetchOptions.body = req.raw_body;
        }
        const response = await fetch(req.url, fetchOptions);
        let bodyText = '';
        if (response.body && typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          let received = 0;
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value ? value.length : 0;
            if (received > MAX_API_RESPONSE) {
              if (value) bodyText += decoder.decode(value, { stream: false });
              bodyText += '\n[Response truncated: maximum 10 MB limit exceeded]';
              try { reader.cancel(); } catch {}
              break;
            }
            if (value) bodyText += decoder.decode(value, { stream: true });
          }
        } else {
          const full = await response.text();
          bodyText = full.length > MAX_API_RESPONSE ? full.slice(0, MAX_API_RESPONSE) + '\n[Response truncated]' : full;
        }
        const resHeaders = {};
        response.headers.forEach((v, k) => { resHeaders[k] = v; });

        let isJson = false;
        try { JSON.parse(bodyText); isJson = true; } catch {}

        return {
          status: response.status,
          status_text: response.statusText,
          headers: resHeaders,
          body: bodyText,
          is_json: isJson,
          is_binary: false,
          size_bytes: Buffer.byteLength(bodyText, 'utf8'),
          duration_ms: Date.now() - startTime,
          tunnel_used: false,
          effective_url: response.url || req.url
        };
      } catch (err) {
        return {
          status: 0,
          status_text: 'Fetch Error',
          headers: {},
          body: `Error: ${err.message}`,
          is_json: false,
          is_binary: false,
          size_bytes: 0,
          duration_ms: Date.now() - startTime,
          tunnel_used: false,
          effective_url: req.url
        };
      }
    }

    case 'db_get_capabilities': {
      return {
        engine: 'web-unavailable',
        server_version: '',
        supports_transactions: false,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: false,
        supports_views: false,
        supports_indexes: false,
        supports_roles: false,
        supports_explain: false,
        supports_export: false,
        note: 'Direct DB drivers execute in Desktop (Tauri) mode; web server mode provides SSH tunnels and vaulted connection profiles.',
      };
    }

    case 'sftp_read_file': {
      const targetPath = String(args?.path || '').trim();
      if (!targetPath) throw new Error('Missing remote path');
      if (!entry || !entry.client) {
        if (process.env.SSHDESKTOP_ENABLE_LOCAL_FS !== 'true') {
          throw new Error('No active SSH connection. Local host filesystem access is disabled by policy.');
        }
        const buf = fs.readFileSync(targetPath);
        if (buf.length > 48 * 1024 * 1024) throw new Error('File exceeds 48 MiB limit');
        return Array.from(buf);
      }
      const sftp = entry.sftp || await getSftp(entry.client);
      const buf = await new Promise((resolve, reject) => {
        sftp.readFile(targetPath, (err, data) => {
          if (err) reject(err);
          else resolve(data);
        });
      });
      if (buf.length > 48 * 1024 * 1024) throw new Error('File exceeds 48 MiB limit');
      return Array.from(buf);
    }

    case 'ssh_verify_host_key': {
      const host = validateSafeToken(String(args?.host || '').trim(), /^[a-zA-Z0-9._:-]{1,253}$/, 'host');
      const port = validateInt(args?.port ?? 22, 1, 65535, 'port');
      const khPath = path.join(DATA_DIR, 'known_hosts');
      try {
        const scanned = child_process.execFileSync('ssh-keyscan', ['-p', String(port), '-T', '5', host], {
          encoding: 'utf8',
          timeout: 8000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        const firstLine = scanned.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#'));
        if (!firstLine) {
          return { status: 'failed', message: `No SSH host key returned by ${host}:${port}.` };
        }
        const parts = firstLine.split(/\s+/);
        const keyType = parts[1] || 'unknown';
        const keyB64 = parts[2] || '';
        const existing = fs.existsSync(khPath) ? fs.readFileSync(khPath, 'utf8') : '';
        return evaluateKnownHostsContent(existing, host, port, keyType, keyB64);
      } catch (err) {
        return { status: 'error', message: `Host key scan failed: ${err.message}` };
      }
    }

    case 'ssh_trust_host_key': {
      const host = validateSafeToken(String(args?.host || '').trim(), /^[a-zA-Z0-9._:-]{1,253}$/, 'host');
      const port = validateInt(args?.port ?? 22, 1, 65535, 'port');
      const keyType = validateSafeToken(String(args?.keyType || args?.key_type || '').trim(), /^[a-zA-Z0-9._@-]{3,64}$/, 'keyType');
      const pubB64 = validateSafeToken(String(args?.publicKeyB64 || args?.public_key_b64 || '').trim(), /^[A-Za-z0-9+/=]{16,4096}$/, 'publicKeyB64');
      const khPath = path.join(DATA_DIR, 'known_hosts');
      const hostToken = port === 22 ? host : `[${host}]:${port}`;
      const existing = fs.existsSync(khPath) ? fs.readFileSync(khPath, 'utf8').split(/\r?\n/) : [];
      const filtered = existing.filter(l => {
        const t = l.trim();
        if (!t || t.startsWith('#') || t.startsWith('@revoked') || t.startsWith('@cert-authority')) return true;
        return !(t.split(/\s+/)[0]?.split(',').includes(hostToken));
      });
      filtered.push(`${hostToken} ${keyType} ${pubB64}`);
      fs.writeFileSync(khPath, filtered.filter(Boolean).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
      appendAuditEvent({ event: 'ssh_trust_host_key', host: hostToken, keyType, status: 'ok' });
      return;
    }

    case 'ssh_generate_key_pair': {
      const rawName = String(args?.filename || `id_ed25519_${Date.now()}`).trim();
      const safeName = validateSafeToken(rawName, /^[a-zA-Z0-9._-]{1,64}$/, 'filename');
      const privPath = path.join(KEYS_DIR, safeName);
      const pubPath = `${privPath}.pub`;
      if (fs.existsSync(privPath)) {
        throw new Error(`Key '${safeName}' already exists.`);
      }
      const comment = String(args?.comment || 'ssh-desktop').replace(/[\r\n\0]/g, '').slice(0, 128);
      const passphrase = String(args?.passphrase || '');
      child_process.execFileSync('ssh-keygen', ['-t', 'ed25519', '-C', comment, '-N', passphrase, '-f', privPath], {
        stdio: 'pipe',
        timeout: 15000,
      });
      try { fs.chmodSync(privPath, 0o600); } catch {}
      const pubContent = fs.existsSync(pubPath) ? fs.readFileSync(pubPath, 'utf8').trim() : '';
      let fp = '';
      try {
        fp = child_process.execFileSync('ssh-keygen', ['-lf', pubPath], { encoding: 'utf8' }).trim().split(/\s+/)[1] || '';
      } catch {}
      return {
        private_key_path: privPath,
        public_key_path: pubPath,
        public_key_content: pubContent,
        fingerprint_sha256: fp,
      };
    }

    case 'ssh_list_local_keys': {
      if (!fs.existsSync(KEYS_DIR)) return [];
      const entries = fs.readdirSync(KEYS_DIR);
      return entries
        .filter(name => !name.endsWith('.pub') && !name.startsWith('.'))
        .map(name => {
          const full = path.join(KEYS_DIR, name);
          const hasPub = fs.existsSync(`${full}.pub`);
          return {
            filename: name,
            full_path: full,
            has_public: hasPub,
            key_type: name.includes('rsa') ? 'rsa' : 'ed25519',
          };
        });
    }

    case 'ssh_install_public_key': {
      if (!entry) throw new Error('No active SSH connection.');
      const pubKey = String(args?.publicKey || args?.public_key || '').trim();
      if (!pubKey || /[\r\n\0]/.test(pubKey) || !/^(?:ssh-|ecdsa-|sk-)/.test(pubKey)) {
        throw new Error('Invalid SSH public key format.');
      }
      const cmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && ` +
        `(grep -qxF -- ${shellQuote(pubKey)} ~/.ssh/authorized_keys || printf '%s\\n' ${shellQuote(pubKey)} >> ~/.ssh/authorized_keys)`;
      const res = await runRemoteExec(entry.client, cmd);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Failed to install public key');
      return 'Public key installed in ~/.ssh/authorized_keys';
    }

    case 'ssh_config_get_path': {
      return path.join(os.homedir(), '.ssh', 'config');
    }

    case 'ssh_config_read_hosts': {
      const cfgPath = path.join(os.homedir(), '.ssh', 'config');
      if (!fs.existsSync(cfgPath)) return [];
      const raw = fs.readFileSync(cfgPath, 'utf8');
      const hosts = [];
      let current = null;
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const m = trimmed.match(/^([A-Za-z]+)\s+(.+)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'host') {
          if (current) hosts.push(current);
          current = { host: val };
        } else if (current) {
          if (key === 'hostname') current.hostname = val;
          else if (key === 'user') current.user = val;
          else if (key === 'port') current.port = parseInt(val, 10) || 22;
          else if (key === 'identityfile') current.identity_file = val;
          else if (key === 'proxyjump') current.proxy_jump = val;
        }
      }
      if (current) hosts.push(current);
      return hosts;
    }

    case 'ssh_config_save_host': {
      const hostObj = args?.host || {};
      const alias = validateSafeToken(String(hostObj.host || '').trim(), /^[a-zA-Z0-9._*-]{1,128}$/, 'host');
      const sshDir = path.join(os.homedir(), '.ssh');
      if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
      const cfgPath = path.join(sshDir, 'config');
      const block = [
        `Host ${alias}`,
        hostObj.hostname ? `  HostName ${String(hostObj.hostname).replace(/[\r\n]/g, '')}` : null,
        hostObj.user ? `  User ${String(hostObj.user).replace(/[\r\n]/g, '')}` : null,
        hostObj.port ? `  Port ${validateInt(hostObj.port, 1, 65535, 'port')}` : null,
        hostObj.identity_file ? `  IdentityFile ${String(hostObj.identity_file).replace(/[\r\n]/g, '')}` : null,
        hostObj.proxy_jump ? `  ProxyJump ${String(hostObj.proxy_jump).replace(/[\r\n]/g, '')}` : null,
      ].filter(Boolean).join('\n') + '\n\n';
      fs.appendFileSync(cfgPath, block, { encoding: 'utf8', mode: 0o600 });
      return;
    }

    case 'db_connect':
    case 'db_disconnect':
    case 'db_test_connection':
    case 'db_execute_query':
    case 'db_list_tables':
    case 'db_get_table_columns':
    case 'redis_scan_keys':
    case 'redis_get_value':
    case 'redis_set_value':
    case 'redis_delete_key':
    case 'mongodb_list_collections':
    case 'mongodb_find_documents':
    case 'mongodb_insert_document':
    case 'db_execute_operation':
    case 'db_get_object_definition':
    case 'sftp_download':
    case 'sftp_download_to_downloads':
    case 'sftp_upload':
    case 'ssh_agent_get_status':
    case 'ssh_exec_stream':
    case 'ssh_exec_stop':
    case 'logs_stream_start':
    case 'logs_stream_stop':
    case 'app_request_shutdown': {
      const err = new Error(`UNSUPPORTED_IN_WEB_MODE: Command '${cmd}' requires the native Desktop (Tauri) runtime.`);
      err.code = 'UNSUPPORTED_IN_WEB_MODE';
      err.statusCode = 501;
      throw err;
    }

    default: {
      const err = new Error(`UNKNOWN_COMMAND: Unrecognized IPC command '${cmd}'.`);
      err.code = 'UNKNOWN_COMMAND';
      err.statusCode = 400;
      throw err;
    }
  }
}

// -------------------------------------------------------------
// BROWSER GATEWAY SESSION REGISTRY & STATEFUL MAPPING
// Maps short, stable URLs (/s/:sessionId/*) to remote SSH sessions
// and upstream destinations (e.g. Jenkins at 8080, Grafana at 3000)
// with isolated in-memory cookie jars.
// -------------------------------------------------------------
const browserSessionRegistry = new Map();
const MAX_BROWSER_SESSIONS = 500;
const BROWSER_SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours

function pruneBrowserSessions() {
  const now = Date.now();
  const removeGatewaySession = (id, sess) => {
    for (const gatewaySocket of sess?.sockets || []) {
      try { gatewaySocket.destroy(); } catch {}
    }
    browserSessionRegistry.delete(id);
  };
  for (const [id, sess] of browserSessionRegistry.entries()) {
    if (now - sess.lastActiveAt > BROWSER_SESSION_TTL || !getSession(sess.authToken)) {
      removeGatewaySession(id, sess);
    }
  }
  if (browserSessionRegistry.size > MAX_BROWSER_SESSIONS) {
    const sorted = Array.from(browserSessionRegistry.entries())
      .sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt);
    const toRemove = sorted.slice(0, browserSessionRegistry.size - MAX_BROWSER_SESSIONS);
    for (const [id, sess] of toRemove) removeGatewaySession(id, sess);
  }
}
setInterval(pruneBrowserSessions, 300000).unref?.();

function getOrCreateBrowserSession(connId, proto, host, port, authToken) {
  const authSession = getSession(authToken);
  if (!authSession) throw new Error('An active authenticated session is required for browser gateway access.');
  pruneBrowserSessions();
  connId = String(connId || 'default').trim();
  proto = String(proto || 'http').toLowerCase();
  port = port === undefined || port === null || port === '' ? (proto === 'https' ? 443 : 80) : Number(port);
  const cleanHost = String(host || '127.0.0.1').toLowerCase().trim();
  if (!connId || connId.length > 128 || /[\x00-\x1f\x7f]/.test(connId)) {
    throw new Error('Invalid browser gateway connection identifier.');
  }
  if (!['http', 'https'].includes(proto)) throw new Error('Browser gateway supports HTTP and HTTPS targets only.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser gateway target port.');
  if (!cleanHost || cleanHost.length > 253 || /[\s/?#@]/.test(cleanHost)) throw new Error('Invalid browser gateway target host.');
  const authTokenHash = hashToken(authToken);
  const key = `${authTokenHash}:${connId}:${proto}:${cleanHost}:${port}`;

  for (const sess of browserSessionRegistry.values()) {
    if (sess.key === key) {
      sess.lastActiveAt = Date.now();
      return sess;
    }
  }

  const connShort = connId.replace(/^server-/, 's').slice(0, 8);
  const randomSecret = crypto.randomBytes(16).toString('hex');
  const sessionId = `${connShort}_${port}_${randomSecret}`;

  const session = {
    id: sessionId,
    key,
    connId,
    proto,
    host: cleanHost,
    port,
    cookies: new Map(), // Isolated per-authenticated-user and upstream-target cookie jar
    authToken,
    authUsername: authSession.username,
    sockets: new Set(),
    createdAt: Date.now(),
    lastActiveAt: Date.now()
  };

  browserSessionRegistry.set(sessionId, session);
  return session;
}

function resolveSessionFromRequest(reqUrl, authToken = null) {
  if (typeof reqUrl !== 'string') return null;

  // 1. Stable short route: /s/:sessionId/*
  if (reqUrl.startsWith('/s/')) {
    const afterS = reqUrl.slice('/s/'.length);
    const slashIdx = afterS.indexOf('/');
    const sessionId = slashIdx === -1 ? afterS.split('?')[0] : afterS.slice(0, slashIdx);
    const rest = slashIdx === -1 ? '/' : afterS.slice(slashIdx);
    const sess = browserSessionRegistry.get(sessionId);
    if (sess) {
      if (!getSession(sess.authToken)) {
        browserSessionRegistry.delete(sessionId);
        return null;
      }
      if (authToken && hashToken(authToken) !== hashToken(sess.authToken)) {
        return null;
      }
      sess.lastActiveAt = Date.now();
      return { session: sess, targetPath: rest, isSessionRoute: true };
    }
  }

  // 2. Legacy gateway route: /api/browser/gateway/:connId/:proto/:hostPart/*
  if (reqUrl.startsWith('/api/browser/gateway/')) {
    const rawPrefix = '/api/browser/gateway/';
    const subPath = reqUrl.slice(rawPrefix.length);
    const slash1 = subPath.indexOf('/');
    if (slash1 !== -1) {
      let connId;
      try { connId = decodeURIComponent(subPath.slice(0, slash1)); }
      catch { return null; }
      const afterConn = subPath.slice(slash1 + 1);
      const slash2 = afterConn.indexOf('/');
      const proto = (slash2 === -1 ? afterConn : afterConn.slice(0, slash2)).toLowerCase();
      if (!['http', 'https'].includes(proto)) return null;
      const afterProto = slash2 === -1 ? '' : afterConn.slice(slash2 + 1);
      const slash3 = afterProto.indexOf('/');
      const hostPart = slash3 === -1 ? afterProto : afterProto.slice(0, slash3);
      let targetPath = slash3 === -1 ? '/' : afterProto.slice(slash3);

      let host = hostPart;
      let port = proto === 'https' ? 443 : 80;
      if (hostPart.includes(':')) {
        const split = hostPart.split(':');
        host = split[0];
        port = parseInt(split[1], 10) || port;
      } else {
        const portMatch = targetPath.match(/^\/(\d{1,5})(\/.*)?$/);
        if (portMatch) {
          port = parseInt(portMatch[1], 10);
          targetPath = portMatch[2] || '/';
        }
      }
      if (!getSession(authToken)) return null;
      const sess = getOrCreateBrowserSession(connId, proto, host, port, authToken);
      return { session: sess, targetPath, isSessionRoute: false };
    }
  }

  return null;
}

function updateSessionCookies(session, setCookieHeaders) {
  if (!session || !session.cookies || !setCookieHeaders) return;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const parts = raw.split(';');
    const firstPart = parts[0].trim();
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx === -1) continue;
    const name = firstPart.slice(0, eqIdx).trim();
    const value = firstPart.slice(eqIdx + 1).trim();

    let isExpired = false;
    for (let i = 1; i < parts.length; i++) {
      const attr = parts[i].trim().toLowerCase();
      if (attr === 'max-age=0' || attr.startsWith('max-age=-')) {
        isExpired = true;
        break;
      }
      if (attr.startsWith('expires=')) {
        const expDate = new Date(parts[i].trim().slice('expires='.length));
        if (!isNaN(expDate.getTime()) && expDate.getTime() <= Date.now()) {
          isExpired = true;
          break;
        }
      }
    }

    if (isExpired || value === '') {
      session.cookies.delete(name);
    } else {
      session.cookies.set(name, value);
    }
  }
}

function buildUpstreamCookieHeader(session, clientCookieHeader) {
  if (!session || !session.cookies) return undefined;
  const merged = new Map(session.cookies);
  if (clientCookieHeader) {
    const pairs = clientCookieHeader.split(';');
    for (const p of pairs) {
      const eqIdx = p.indexOf('=');
      if (eqIdx === -1) continue;
      const k = p.slice(0, eqIdx).trim();
      const v = p.slice(eqIdx + 1).trim();
      if (k === '__ssh_session' || k === '__ssh_browser_gw' || k === 'sshdesktop_session') continue;
      if (!merged.has(k)) {
        merged.set(k, v);
      }
    }
  }
  if (merged.size === 0) return undefined;
  const cookieStrings = [];
  for (const [k, v] of merged.entries()) {
    cookieStrings.push(`${k}=${v}`);
  }
  return cookieStrings.join('; ');
}

// -------------------------------------------------------------
// BROWSER GATEWAY & REVERSE PROXY HANDLER (Web Mode Support)
// Proxies HTTP and HTTPS requests from PC browser clients through
// the remote SSH server so users can reach server localhost,
// internal services, and private IPs seamlessly.
// -------------------------------------------------------------
function handleBrowserGatewayUpgrade(req, socket, head) {
  const resolved = resolveSessionFromRequest(req.url, extractSessionToken(req, null));
  if (!resolved) {
    try { socket.destroy(); } catch {}
    return;
  }

  const { session, targetPath } = resolved;
  const { connId, proto, host, port } = session;
  if (!session.sockets) session.sockets = new Set();
  session.sockets.add(socket);
  socket.once('close', () => session.sockets.delete(socket));

  let entry = null;
  if (connId && connId !== 'default' && connId !== 'local' && activeConnections.has(connId)) {
    entry = activeConnections.get(connId);
  }

  if (!entry || !entry.client) {
    try { socket.destroy(); } catch {}
    return;
  }

  const connectTarget = (cb) => {
    const destHost = host === 'localhost' ? '127.0.0.1' : host;
    const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const strictTls = !(isLoopback && Boolean(entry && entry.client));
    entry.client.forwardOut('127.0.0.1', 0, destHost, port, (err, stream) => {
      if (err) return cb(err);
      if (proto === 'https') {
        const tlsSocket = tls.connect({
          socket: stream,
          servername: host,
          rejectUnauthorized: strictTls
        }, () => cb(null, tlsSocket));
        tlsSocket.on('error', e => cb(e));
      } else {
        cb(null, stream);
      }
    });
  };

  connectTarget((err, targetStream) => {
    if (err) {
      try { socket.destroy(); } catch {}
      return;
    }

    const isDefaultPort = (proto === 'http' && Number(port) === 80) || (proto === 'https' && Number(port) === 443);
    const hostHeader = isDefaultPort ? host : `${host}:${port}`;

    let rawHeaders = `${req.method} ${targetPath} HTTP/1.1\r\nHost: ${hostHeader}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      const lower = k.toLowerCase();
      if (lower === 'host') continue;
      if (lower === 'cookie') {
        const upstreamCookies = buildUpstreamCookieHeader(session, v);
        if (upstreamCookies) {
          rawHeaders += `cookie: ${upstreamCookies}\r\n`;
        }
        continue;
      }
      rawHeaders += `${k}: ${v}\r\n`;
    }
    if (!req.headers.cookie) {
      const upstreamCookies = buildUpstreamCookieHeader(session, null);
      if (upstreamCookies) {
        rawHeaders += `cookie: ${upstreamCookies}\r\n`;
      }
    }
    rawHeaders += '\r\n';

    targetStream.write(rawHeaders);
    if (head && head.length > 0) {
      targetStream.write(head);
    }

    socket.pipe(targetStream);
    targetStream.pipe(socket);

    socket.on('error', () => { try { targetStream.destroy(); } catch {} });
    targetStream.on('error', () => { try { socket.destroy(); } catch {} });
    socket.on('close', () => { try { targetStream.end(); } catch {} });
    targetStream.on('close', () => { try { socket.end(); } catch {} });
  });
}

function handleBrowserGatewayRequest(req, res) {
  // 1. Query-based proxy redirect: /api/browser/proxy?url=...
  if (req.url.startsWith('/api/browser/proxy')) {
    let urlObj;
    try { urlObj = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
    catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid browser proxy request URL.' }));
      return;
    }
    const targetUrl = urlObj.searchParams.get('url');
    const connId = urlObj.searchParams.get('connId') || 'default';
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?url parameter in proxy request' }));
      return;
    }
    try {
      const fullUrl = targetUrl.startsWith('http://') || targetUrl.startsWith('https://') ? targetUrl : `http://${targetUrl}`;
      const parsed = new URL(fullUrl);
      const proto = parsed.protocol.replace(':', '');
      if (!['http', 'https'].includes(proto) || parsed.username || parsed.password) {
        throw new Error('Only HTTP/HTTPS targets without embedded credentials are supported.');
      }
      const port = parsed.port || (proto === 'https' ? '443' : '80');
      const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '');
      const session = getOrCreateBrowserSession(connId, proto, parsed.hostname, port, extractSessionToken(req, null));
      const redirectDest = `/s/${encodeURIComponent(session.id)}${pathAndQuery}`;
      res.writeHead(302, {
        'Location': redirectDest,
        'Set-Cookie': `__ssh_session=${encodeURIComponent(session.id)}; Path=/; SameSite=Lax`
      });
      res.end();
      return;
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid URL '${targetUrl}': ${err.message}` }));
      return;
    }
  }

  // 2. Gateway route resolution: /s/:sessionId/* or legacy /api/browser/gateway/:connId/:proto/:hostPart/*
  const resolved = resolveSessionFromRequest(req.url, extractSessionToken(req, null));
  if (!resolved) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Gateway route or active session not found' }));
    return;
  }

  const { session, targetPath: resolvedTargetPath, isSessionRoute } = resolved;
  let targetPath = resolvedTargetPath;
  const { connId, proto, host, port } = session;

  // If request arrived via legacy /api/browser/gateway/... on an HTML navigation,
  // 302 redirect cleanly to the short, stable /s/:sessionId/ route!
  if (!isSessionRoute) {
    const isHtmlNav = req.method === 'GET' &&
                      (req.headers.accept || '').includes('text/html') &&
                      !req.headers['x-requested-with'];
    if (isHtmlNav) {
      res.writeHead(302, {
        'Location': `/s/${encodeURIComponent(session.id)}${targetPath}`,
        'Set-Cookie': `__ssh_session=${encodeURIComponent(session.id)}; Path=/; SameSite=Lax`
      });
      res.end();
      return;
    }
  }

  let entry = null;
  if (connId && connId !== 'default' && connId !== 'local' && activeConnections.has(connId)) {
    entry = activeConnections.get(connId);
  } else if (connId === 'default' && activeConnections.size === 1) {
    entry = activeConnections.values().next().value;
  }

  const isHttps = proto === 'https';
  const httpModule = isHttps ? https : http;
  const gatewayBase = `/s/${encodeURIComponent(session.id)}`;

  const isPrivateHost = host === 'localhost' || host === '127.0.0.1' ||
    host.startsWith('10.') || host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host.endsWith('.local') || host.endsWith('.internal');

  const headersToSend = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (['connection', 'upgrade', 'keep-alive', 'transfer-encoding', 'host', 'authorization', 'x-session-token',
         'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-prefix'].includes(lower)) {
      continue;
    }
    headersToSend[k] = v;
  }
  const isDefaultPort = (proto === 'http' && Number(port) === 80) || (proto === 'https' && Number(port) === 443);
  headersToSend['host'] = isDefaultPort ? host : `${host}:${port}`;

  // Upstream Cookie Injection: Provide isolated cookies for this session
  const upstreamCookies = buildUpstreamCookieHeader(session, req.headers.cookie);
  if (upstreamCookies) {
    headersToSend['cookie'] = upstreamCookies;
  } else {
    delete headersToSend['cookie'];
  }

  if (isPrivateHost) {
    // CSRF & Reverse Proxy Headers for internal/private services (Jenkins, Grafana, Portainer, etc.)
    headersToSend['origin'] = `${proto}://${host}:${port}`;
    headersToSend['referer'] = `${proto}://${host}:${port}${targetPath}`;
    headersToSend['x-forwarded-host'] = req.headers.host || `${host}:${port}`;
    headersToSend['x-forwarded-proto'] = proto;
    headersToSend['x-forwarded-port'] = String(port);
    headersToSend['x-forwarded-prefix'] = gatewayBase;
    headersToSend['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  } else {
    // Public Web Requests: Send authentic Chrome browser headers to prevent Cloudflare/WAF bot-detection & Captcha challenges
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      headersToSend['origin'] = `${proto}://${host}`;
    } else {
      delete headersToSend['origin'];
    }

    if (req.headers.referer && (req.headers.referer.includes('/s/') || req.headers.referer.includes('/api/browser/gateway/'))) {
      headersToSend['referer'] = `${proto}://${isDefaultPort ? host : `${host}:${port}`}${targetPath}`;
    }

    if (!headersToSend['user-agent'] || headersToSend['user-agent'].includes('Node') || headersToSend['user-agent'].includes('curl')) {
      headersToSend['user-agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    }
    if (!headersToSend['accept']) {
      headersToSend['accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
    }
    if (!headersToSend['accept-language']) {
      headersToSend['accept-language'] = 'en-US,en;q=0.9';
    }
    headersToSend['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
    headersToSend['sec-ch-ua-mobile'] = '?0';
    headersToSend['sec-ch-ua-platform'] = '"Windows"';
    headersToSend['sec-fetch-dest'] = req.headers['sec-fetch-dest'] || 'document';
    headersToSend['sec-fetch-mode'] = req.headers['sec-fetch-mode'] || 'navigate';
    headersToSend['sec-fetch-site'] = req.headers['sec-fetch-site'] || 'none';
    headersToSend['sec-fetch-user'] = '?1';
    headersToSend['upgrade-insecure-requests'] = '1';
  }


  // Decompression: Support gzip, deflate, and br (Brotli)
  headersToSend['accept-encoding'] = 'gzip, deflate, br, identity';

  // Neutralize rogue undefined in gateway targetPath (e.g. Jenkins dialogs or missing rootURL)
  if (targetPath.startsWith('/undefined/')) {
    targetPath = '/' + targetPath.slice('/undefined/'.length);
  } else if (targetPath.includes('/undefined/')) {
    targetPath = targetPath.replace(/\/undefined\//g, '/');
  }

  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  // Enforce certificate verification on external hosts; allow self-signed certs only for local SSH-tunneled development
  const strictTls = !(isLoopback && Boolean(entry && entry.client));

  const requestOptions = {
    hostname: host,
    port: port,
    path: targetPath,
    method: req.method,
    headers: headersToSend,
    rejectUnauthorized: strictTls,
    maxHeaderSize: 16 * 1024, // 1MB header limit to eliminate "Header overflow" on YouTube/Google
  };

  if (entry && entry.client) {
    requestOptions.createConnection = (options, callback) => {
      const destHost = options.hostname === 'localhost' ? '127.0.0.1' : options.hostname;
      entry.client.forwardOut('127.0.0.1', 0, destHost, Number(options.port), (err, stream) => {
        if (err) return callback(err);
        if (isHttps) {
          const tlsSocket = tls.connect({
            socket: stream,
            servername: options.hostname,
            rejectUnauthorized: strictTls
          }, () => callback(null, tlsSocket));
          tlsSocket.on('error', (tlsErr) => callback(tlsErr));
        } else {
          callback(null, stream);
        }
      });
    };
  } else if (isHttps) {
    requestOptions.createConnection = (options, callback) => {
      const netSocket = net.connect(options.port, options.hostname, () => {
        const tlsSocket = tls.connect({
          socket: netSocket,
          servername: options.hostname,
          rejectUnauthorized: strictTls
        }, () => callback(null, tlsSocket));
        tlsSocket.on('error', (tlsErr) => callback(tlsErr));
      });
      netSocket.on('error', (netErr) => callback(netErr));
    };
  }

  const clientReq = httpModule.request(requestOptions, (targetRes) => {
    const outHeaders = { ...targetRes.headers };

    // Retain upstream Content-Security-Policy rules (script-src, object-src, default-src),
    // adjusting frame-ancestors to allow embedding in the application workspace rather than
    // stripping all XSS and injection safeguards.
    if (outHeaders['content-security-policy']) {
      outHeaders['content-security-policy'] = String(outHeaders['content-security-policy'])
        .replace(/frame-ancestors\s+[^;]+/i, "frame-ancestors 'self' *")
        .replace(/frame-ancestors\s*;/i, "frame-ancestors 'self' *;");
    }
    delete outHeaders['x-frame-options'];

    const origin = req.headers['origin'];
    const reqHost = String(req.headers.host || '').toLowerCase();
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.host.toLowerCase() === reqHost) {
          outHeaders['access-control-allow-origin'] = origin;
          outHeaders['access-control-allow-credentials'] = 'true';
        }
      } catch {}
    }
    outHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
    outHeaders['access-control-allow-headers'] = 'Content-Type, Authorization, X-Session-Token';

    // Cookie Management: Update isolated in-memory cookie jar for this upstream target
    if (outHeaders['set-cookie']) {
      updateSessionCookies(session, outHeaders['set-cookie']);
    }

    // Prepare client-facing cookies: strip Domain & Secure restrictions on HTTP,
    // and attach __ssh_session and __ssh_browser_gw tracking cookies
    const sessionCookie = `__ssh_session=${encodeURIComponent(session.id)}; Path=/; SameSite=Lax`;
    const gatewayCookie = `__ssh_browser_gw=${encodeURIComponent(gatewayBase)}; Path=/; SameSite=Lax`;
    let cookieList = [];
    if (outHeaders['set-cookie']) {
      const rawCookies = Array.isArray(outHeaders['set-cookie']) ? outHeaders['set-cookie'] : [outHeaders['set-cookie']];
      cookieList = rawCookies.map(c => {
        let clean = c.replace(/;\s*Domain=[^;]+/gi, '');
        if (!req.socket.encrypted && req.headers['x-forwarded-proto'] !== 'https') {
          clean = clean.replace(/;\s*Secure/gi, '');
        }
        return clean;
      });
    }
    cookieList.push(sessionCookie);
    cookieList.push(gatewayCookie);
    outHeaders['set-cookie'] = cookieList;

    function rewriteLocationUrl(loc) {
      if (typeof loc !== 'string' || !loc) return loc;
      loc = loc.trim();
      if (loc.startsWith('//')) {
        loc = `${proto}:${loc}`;
      }
      if (loc.startsWith('http://') || loc.startsWith('https://')) {
        try {
          const locUrl = new URL(loc);
          const locProto = locUrl.protocol.replace(':', '');
          const locPort = locUrl.port || (locProto === 'https' ? 443 : 80);
          const targetSession = getOrCreateBrowserSession(connId, locProto, locUrl.hostname, locPort, extractSessionToken(req, null));
          return `/s/${encodeURIComponent(targetSession.id)}${locUrl.pathname}${locUrl.search}${locUrl.hash || ''}`;
        } catch {
          return loc;
        }
      }
      if (loc.startsWith('/')) {
        return `${gatewayBase}${loc}`;
      }
      // Relative path without leading slash (e.g. 'login', './login', '../login')
      try {
        const resolved = new URL(loc, `${proto}://${host}:${port}${targetPath}`);
        return `${gatewayBase}${resolved.pathname}${resolved.search}${resolved.hash || ''}`;
      } catch {
        return `${gatewayBase}/${loc}`;
      }
    }

    // Handle HTTP Redirects (Location header: 301, 302, 303, 307, 308)
    if (outHeaders['location']) {
      outHeaders['location'] = rewriteLocationUrl(outHeaders['location']);
      res.writeHead(targetRes.statusCode, outHeaders);
      targetRes.pipe(res);
      return;
    }

    if (outHeaders['refresh']) {
      outHeaders['refresh'] = outHeaders['refresh'].replace(/(url\s*=\s*)(.+)$/i, (match, prefix, rUrl) => {
        const cleanUrl = rUrl.trim().replace(/^['"]|['"]$/g, '');
        return `${prefix}${rewriteLocationUrl(cleanUrl)}`;
      });
    }

    const contentType = (outHeaders['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html');
    const isCss = contentType.includes('text/css');
    const isJs = contentType.includes('javascript') || contentType.includes('application/x-javascript');

    if (isHtml || isCss || isJs) {
      const MAX_GATEWAY_REWRITE_BYTES = 32 * 1024 * 1024;
      const chunks = [];
      let totalBytes = 0;
      let oversized = false;
      targetRes.on('data', c => {
        if (oversized) return;
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
        totalBytes += buf.length;
        if (totalBytes > MAX_GATEWAY_REWRITE_BYTES) {
          oversized = true;
          chunks.length = 0;
          try { targetRes.destroy(); } catch {}
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Gateway response exceeded 32 MiB rewrite buffer limit');
          }
          return;
        }
        chunks.push(buf);
      });
      targetRes.on('end', () => {
        if (oversized) return;
        let buffer = Buffer.concat(chunks, totalBytes);

        // Decompress GZIP, Deflate, or Brotli if target server sent compressed payload
        const enc = (outHeaders['content-encoding'] || '').toLowerCase();
        if (enc.includes('gzip')) {
          try { buffer = zlib.gunzipSync(buffer); } catch (e) { console.warn('[Gateway gunzip error]', e.message); }
        } else if (enc.includes('deflate')) {
          try { buffer = zlib.inflateSync(buffer); } catch (e) { console.warn('[Gateway inflate error]', e.message); }
        } else if (enc.includes('br')) {
          try { buffer = zlib.brotliDecompressSync(buffer); } catch (e) { console.warn('[Gateway brotli error]', e.message); }
        }

        let bodyText = buffer.toString('utf8');

        // All variations of target origin that Jenkins, Grafana, WordPress might emit
        const targetOrigins = [
          `${proto}://${host}:${port}`,
          `${proto}://${host}`,
          `${proto}://localhost:${port}`,
          `${proto}://localhost`,
          `${proto}://127.0.0.1:${port}`,
          `${proto}://127.0.0.1`,
          `//${host}:${port}`,
          `//localhost:${port}`,
          `//127.0.0.1:${port}`
        ];

        // Replace any absolute references to target origin with gatewayBase
        for (const orig of targetOrigins) {
          const escaped = orig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          bodyText = bodyText.replace(new RegExp(`href\\s*=\\s*["']${escaped}/?`, 'gi'), `href="${gatewayBase}/`);
          bodyText = bodyText.replace(new RegExp(`src\\s*=\\s*["']${escaped}/?`, 'gi'), `src="${gatewayBase}/`);
          bodyText = bodyText.replace(new RegExp(`action\\s*=\\s*["']${escaped}/?`, 'gi'), `action="${gatewayBase}/`);
          bodyText = bodyText.replace(new RegExp(`url\\(["']?${escaped}/?`, 'gi'), `url("${gatewayBase}/`);
        }

        for (const orig of targetOrigins) {
          // Also rewrite target origins in JavaScript string literals (e.g. window.location = "https://localhost.com/login")
          const escaped = orig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          bodyText = bodyText.replace(new RegExp(`(["'])${escaped}/?`, 'gi'), `$1${gatewayBase}/`);
        }

        if (isHtml) {
          // Remove existing <base> tag so our injected gateway base tag is authoritative
          bodyText = bodyText.replace(/<base\b[^>]*>/gi, '');

          // Rewrite <meta http-equiv="refresh" content="...url=...">
          bodyText = bodyText.replace(/(<meta\b[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["'][^"']*url\s*=\s*)([^"'\s>]+)(["'][^>]*>)/gi, (match, before, rUrl, after) => {
            return `${before}${rewriteLocationUrl(rUrl)}${after}`;
          });

          const dirPath = targetPath.endsWith('/') ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/') + 1);
          const baseTag = `<base href="${gatewayBase}${dirPath || '/'}" />\n`;

          // 1. Rewrite root-relative href="/..." (links, navigation, stylesheets, icons)
          bodyText = bodyText.replace(/(href\s*=\s*["'])\/(?!\/|s\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 2. Rewrite root-relative src="/..." (scripts, images, media, iframes)
          bodyText = bodyText.replace(/(src\s*=\s*["'])\/(?!\/|s\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 3. Rewrite root-relative action="/..." (form submit for login, settings, POST)
          bodyText = bodyText.replace(/(action\s*=\s*["'])\/(?!\/|s\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 4. Handle forms with empty action="" or NO action attribute: submit to current gateway URL
          bodyText = bodyText.replace(/(action\s*=\s*["'])\s*["']/gi, `$1${gatewayBase}${targetPath}"`);
          bodyText = bodyText.replace(/<form\b(?![^>]*\baction\b)([^>]*)>/gi, `<form action="${gatewayBase}${targetPath}"$1>`);

          // 5. Rewrite CSS url(/...)
          bodyText = bodyText.replace(/(url\(\s*["']?)\/(?!\/|s\/|api\/browser\/gateway\/)([^"')]+["']?\))/gi, `$1${gatewayBase}/$2`);

          // 6. Rewrite data-url, data-href, data-src
          bodyText = bodyText.replace(/(data-(?:url|href|src)\s*=\s*["'])\/(?!\/|s\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 7. Calculate Target Origin & reCAPTCHA / Captcha bypass parameters
          const interceptScript = `
<script>
(function() {
  var GW = ${JSON.stringify(gatewayBase)};
  var TARGET_ORIGIN = ${JSON.stringify(`${proto}://${host}:${port}`)};
  var TARGET_HOST = ${JSON.stringify(host)};
  var ORIGINS = ${JSON.stringify([
    `${proto}://${host}:${port}`,
    `${proto}://${host}`,
    `${proto}://localhost:${port}`,
    `${proto}://localhost`,
    `${proto}://127.0.0.1:${port}`,
    `${proto}://127.0.0.1`,
    `//${host}:${port}`,
    `//localhost:${port}`,
    `//127.0.0.1:${port}`
  ])};

  function fixCaptchaUrl(url) {
    return url;
  }

  // Jenkins & SPA Context Protection: Ensure rootURL and head metadata cannot evaluate to undefined
  try {
    if (document.head) {
      if (!document.head.hasAttribute('data-rooturl')) {
        document.head.setAttribute('data-rooturl', '');
      }
      if (document.head.dataset && document.head.dataset.rooturl === undefined) {
        document.head.dataset.rooturl = '';
      }
    }
    if (typeof window.rootURL === 'undefined') {
      window.rootURL = '';
    }
    if (typeof window.resURL === 'undefined') {
      window.resURL = '';
    }
    if (typeof window.solveSimpleChallenge === 'undefined') {
      window.solveSimpleChallenge = null;
    }
  } catch(e) {}

  function rewriteUrl(u) {
    if (u === undefined || u === null) return u;
    if (typeof u !== 'string') {
      try { u = String(u); } catch(e) { return u; }
    }
    u = u.trim();
    // Neutralize rogue undefined in relative URL paths (e.g. undefined/i18n/resourceBundle -> /i18n/resourceBundle)
    if (u === 'undefined') {
      u = '/';
    } else if (u.startsWith('undefined/')) {
      u = '/' + u.slice('undefined/'.length);
    } else if (u.includes('/undefined/')) {
      u = u.split('/undefined/').join('/');
    }
    if (!u || u === '/') return GW + '/';
    if (u.startsWith('#') || u.startsWith('javascript:') || u.startsWith('mailto:') || u.startsWith('tel:') || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('about:')) {
      return u;
    }
    if (u.startsWith(GW) || u.startsWith('/s/') || u.startsWith('/api/browser/gateway/')) {
      return u;
    }
    // Handle current server origin (e.g. http://localhost:2222 or http://localhost:2222/...)
    var gwOrigin = window.location.origin;
    if (u.startsWith(gwOrigin)) {
      var afterGwOrigin = u.slice(gwOrigin.length);
      if (afterGwOrigin.startsWith(GW) || afterGwOrigin.startsWith('/s/') || afterGwOrigin.startsWith('/api/browser/gateway/')) {
        return u;
      }
      return GW + (afterGwOrigin.startsWith('/') ? afterGwOrigin : '/' + afterGwOrigin);
    }
    // Handle protocol-relative for current host (e.g. //localhost:2222/...)
    if (u.startsWith('//' + window.location.host)) {
      var afterHost = u.slice(('//' + window.location.host).length);
      if (afterHost.startsWith(GW) || afterHost.startsWith('/s/') || afterHost.startsWith('/api/browser/gateway/')) {
        return u;
      }
      return GW + (afterHost.startsWith('/') ? afterHost : '/' + afterHost);
    }
    // Handle target origins (e.g. https://www.youtube.com:443, https://www.youtube.com, etc.)
    for (var i = 0; i < ORIGINS.length; i++) {
      if (u.startsWith(ORIGINS[i])) {
        var rest = u.slice(ORIGINS[i].length);
        return GW + (rest.startsWith('/') ? rest : (rest ? '/' + rest : '/'));
      }
    }
    // Handle absolute external HTTP/HTTPS URLs (e.g. redirecting to accounts.google.com or auth provider)
    if (u.startsWith('http://') || u.startsWith('https://')) {
      try {
        var parsed = new URL(u);
        var pProto = parsed.protocol.replace(':', '');
        var pPort = parsed.port || (pProto === 'https' ? '443' : '80');
        return '/api/browser/gateway/' + encodeURIComponent(${JSON.stringify(connId)}) + '/' + pProto + '/' + parsed.hostname + ':' + pPort + (parsed.pathname || '/') + parsed.search + (parsed.hash || '');
      } catch(e) {}
    }
    // Handle root-relative paths (e.g. /watch?v=..., /login, /assets/...)
    if (u.startsWith('/') && !u.startsWith('//')) {
      return GW + u;
    }
    // Handle relative paths without leading slash (e.g. 'watch?v=...', './watch', '../api')
    try {
      var resolved = new URL(u, window.location.href);
      if (resolved.origin === gwOrigin) {
        if (!resolved.pathname.startsWith(GW) && !resolved.pathname.startsWith('/s/') && !resolved.pathname.startsWith('/api/browser/gateway/')) {
          return GW + resolved.pathname + resolved.search + resolved.hash;
        }
        return resolved.pathname + resolved.search + resolved.hash;
      }
    } catch(e) {}
    return u;
  }

  // Prevent frame-busting on top window while preserving parent/top postMessage communication for iframes
  try {
    if (window.self === window.top) {
      Object.defineProperty(window, 'top', { get: function() { return window; }, configurable: true });
    }
  } catch (e) {}

  // Intercept Location.prototype.replace & Location.prototype.assign if configurable
  if (window.Location && Location.prototype) {
    try {
      var _origLocReplace = Location.prototype.replace;
      if (_origLocReplace) {
        Location.prototype.replace = function(url) {
          return _origLocReplace.call(this, rewriteUrl(url));
        };
      }
      var _origLocAssign = Location.prototype.assign;
      if (_origLocAssign) {
        Location.prototype.assign = function(url) {
          return _origLocAssign.call(this, rewriteUrl(url));
        };
      }
    } catch(e) {}
  }

  // Intercept History.prototype & window.history pushState / replaceState (SPAs, YouTube Kevlar, Grafana)
  function patchHistoryObj(obj) {
    if (!obj || obj._gwPatched) return;
    try {
      obj._gwPatched = true;
      var _origPush = obj.pushState;
      if (_origPush) {
        obj.pushState = function(state, title, url) {
          if (url !== undefined && url !== null) url = rewriteUrl(url);
          return _origPush.call(this, state, title, url);
        };
      }
      var _origReplace = obj.replaceState;
      if (_origReplace) {
        obj.replaceState = function(state, title, url) {
          if (url !== undefined && url !== null) url = rewriteUrl(url);
          return _origReplace.call(this, state, title, url);
        };
      }
    } catch(e) {}
  }

  if (window.History && History.prototype) patchHistoryObj(History.prototype);
  if (window.history) patchHistoryObj(window.history);

  // Intercept HTMLIFrameElement.prototype (catches reCAPTCHA & SPF hidden history iframes)
  if (window.HTMLIFrameElement) {
    var iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
    if (iframeSrcDesc && iframeSrcDesc.set) {
      var _origIframeSrcSet = iframeSrcDesc.set;
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        get: function() { return iframeSrcDesc.get.call(this); },
        set: function(val) {
          val = fixCaptchaUrl(val);
          return _origIframeSrcSet.call(this, val);
        },
        configurable: true,
        enumerable: true
      });
    }

    var cwDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
    if (cwDesc && cwDesc.get) {
      var _origCwGet = cwDesc.get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          var cw = _origCwGet.call(this);
          if (cw) {
            try {
              if (cw.History && cw.History.prototype) patchHistoryObj(cw.History.prototype);
              if (cw.history) patchHistoryObj(cw.history);
            } catch(e) {}
          }
          return cw;
        },
        configurable: true,
        enumerable: true
      });
    }

    var cdDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentDocument');
    if (cdDesc && cdDesc.get) {
      var _origCdGet = cdDesc.get;
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentDocument', {
        get: function() {
          var cd = _origCdGet.call(this);
          if (cd && cd.defaultView) {
            try {
              if (cd.defaultView.History && cd.defaultView.History.prototype) patchHistoryObj(cd.defaultView.History.prototype);
              if (cd.defaultView.history) patchHistoryObj(cd.defaultView.history);
            } catch(e) {}
          }
          return cd;
        },
        configurable: true,
        enumerable: true
      });
    }
  }

  // Intercept Element.prototype.setAttribute for src
  var _origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, val) {
    if (typeof name === 'string' && name.toLowerCase() === 'src' && typeof val === 'string') {
      val = fixCaptchaUrl(val);
    }
    return _origSetAttr.call(this, name, val);
  };

  // MutationObserver for any added iframes
  if (window.MutationObserver) {
    var _obs = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var node = added[j];
          if (node && node.nodeType === 1) {
            if (node.tagName === 'IFRAME') {
              var s = node.getAttribute('src');
              if (s) {
                var f = fixCaptchaUrl(s);
                if (f !== s) node.setAttribute('src', f);
              }
              try {
                if (node.contentWindow) {
                  if (node.contentWindow.History) patchHistoryObj(node.contentWindow.History.prototype);
                  if (node.contentWindow.history) patchHistoryObj(node.contentWindow.history);
                }
              } catch(e) {}
            } else if (node.querySelectorAll) {
              var ifrs = node.querySelectorAll('iframe');
              for (var k = 0; k < ifrs.length; k++) {
                var isrc = ifrs[k].getAttribute('src');
                if (isrc) {
                  var ifixed = fixCaptchaUrl(isrc);
                  if (ifixed !== isrc) ifrs[k].setAttribute('src', ifixed);
                }
                try {
                  if (ifrs[k].contentWindow) {
                    if (ifrs[k].contentWindow.History) patchHistoryObj(ifrs[k].contentWindow.History.prototype);
                    if (ifrs[k].contentWindow.history) patchHistoryObj(ifrs[k].contentWindow.history);
                  }
                } catch(e) {}
              }
            }
          }
        }
      }
    });
    _obs.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  // Preserve explicit postMessage targetOrigin instead of wildcarding to '*'

  // Intercept MessageEvent.prototype.origin to ensure captchas and cross-frame handlers accept the message
  try {
    if (window.MessageEvent && MessageEvent.prototype) {
      var _originDesc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'origin');
      if (_originDesc && _originDesc.get) {
        var _origOriginGet = _originDesc.get;
        Object.defineProperty(MessageEvent.prototype, 'origin', {
          get: function() {
            var o = _origOriginGet.call(this);
            if (o === window.location.origin) {
              return TARGET_ORIGIN;
            }
            return o;
          },
          configurable: true
        });
      }
    }
  } catch(e) {}

  // Document domain spoofing
  try {
    Object.defineProperty(document, 'domain', {
      get: function() { return TARGET_HOST; },
      set: function() {},
      configurable: true
    });
  } catch(e) {}

  // 1. Intercept window.fetch (supports GET, POST, PUT, DELETE, PATCH, etc.)
  if (window.fetch) {
    var _fetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === 'string') {
        input = fixCaptchaUrl(input);
        input = rewriteUrl(input);
      } else if (input && typeof input === 'object' && input.url) {
        var newUrl = fixCaptchaUrl(input.url);
        newUrl = rewriteUrl(newUrl);
        if (newUrl !== input.url) {
          input = new Request(newUrl, input);
        }
      }
      return _fetch.call(this, input, init);
    };
  }

  // 2. Intercept XMLHttpRequest (supports GET, POST, PUT, DELETE, PATCH, etc.)
  if (window.XMLHttpRequest) {
    var _open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      url = fixCaptchaUrl(url);
      url = rewriteUrl(url);
      return _open.call(this, method, url, async !== false, user, password);
    };
  }

  // 3. Intercept HTMLFormElement.prototype.submit (catches programmatic submit())
  if (window.HTMLFormElement) {
    var _formSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function() {
      var action = this.getAttribute('action');
      if (!action) {
        this.setAttribute('action', window.location.pathname + window.location.search);
      } else {
        this.setAttribute('action', rewriteUrl(action));
      }
      return _formSubmit.call(this);
    };
  }

  // 4. Global capture click listener for all <a> tags (including Shadow DOM)
  document.addEventListener('click', function(e) {
    var path = e.composedPath ? e.composedPath() : [];
    var t = null;
    for (var i = 0; i < path.length; i++) {
      if (path[i] && path[i].tagName === 'A') {
        t = path[i];
        break;
      }
    }
    if (!t) {
      var cur = e.target;
      while (cur && cur.tagName !== 'A' && cur !== document.body) {
        cur = cur.parentElement;
      }
      if (cur && cur.tagName === 'A') t = cur;
    }
    if (t && t.tagName === 'A') {
      var href = t.getAttribute('href');
      if (href) {
        var rw = rewriteUrl(href);
        if (rw !== href) {
          t.setAttribute('href', rw);
        }
      }
      if (t.target === '_top' || t.target === '_parent') {
        t.target = '_self';
      }
    }
  }, true);

  // 5. Global capture submit listener for all <form> elements
  document.addEventListener('submit', function(e) {
    var form = e.target;
    if (form && form.tagName === 'FORM') {
      var action = form.getAttribute('action');
      if (!action) {
        form.setAttribute('action', window.location.pathname + window.location.search);
      } else {
        form.setAttribute('action', rewriteUrl(action));
      }
    }
  }, true);

  // 6. Intercept window.open
  var _winOpen = window.open;
  window.open = function(url, target, features) {
    url = rewriteUrl(url);
    return _winOpen.call(this, url, target, features);
  };

  // 7. Intercept navigator.sendBeacon
  if (navigator.sendBeacon) {
    var _sendBeacon = navigator.sendBeacon;
    navigator.sendBeacon = function(url, data) {
      if (typeof url === 'string') url = rewriteUrl(url);
      return _sendBeacon.call(this, url, data);
    };
  }

  // 8. Intercept WebSocket
  if (window.WebSocket) {
    var _OrigWS = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      if (typeof url === 'string' && (url.startsWith('ws://') || url.startsWith('wss://'))) {
        try {
          var wsParsed = new URL(url);
          var wsTargetProto = wsParsed.protocol === 'wss:' ? 'https' : 'http';
          var wsTargetPort = wsParsed.port || (wsTargetProto === 'https' ? '443' : '80');
          var localWsScheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          url = localWsScheme + '//' + window.location.host + GW + (wsParsed.pathname || '/') + wsParsed.search;
        } catch(e) {}
      }
      return protocols ? new _OrigWS(url, protocols) : new _OrigWS(url);
    };
    window.WebSocket.prototype = _OrigWS.prototype;
  }
})();
</script>
`;

          const headMatch = bodyText.match(/<head\b[^>]*>/i);
          if (headMatch && headMatch.index !== undefined) {
            const insertIdx = headMatch.index + headMatch[0].length;
            bodyText = bodyText.slice(0, insertIdx) + '\n' + baseTag + interceptScript + bodyText.slice(insertIdx);
          } else {
            const htmlMatch = bodyText.match(/<html\b[^>]*>/i);
            if (htmlMatch && htmlMatch.index !== undefined) {
              const insertIdx = htmlMatch.index + htmlMatch[0].length;
              bodyText = bodyText.slice(0, insertIdx) + '\n<head>' + baseTag + interceptScript + '</head>' + bodyText.slice(insertIdx);
            } else {
              bodyText = '<head>' + baseTag + interceptScript + '</head>\n' + bodyText;
            }
          }
        } else if (isCss) {
          bodyText = bodyText.replace(/(url\(\s*["']?)\/(?!\/|s\/|api\/browser\/gateway\/)([^"')]+["']?\))/gi, `$1${gatewayBase}/$2`);
          bodyText = bodyText.replace(/(@import\s*["'])\/(?!\/|s\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);
        }

        const outBuffer = Buffer.from(bodyText, 'utf8');
        delete outHeaders['transfer-encoding'];
        delete outHeaders['content-encoding'];
        outHeaders['content-length'] = outBuffer.length;
        res.writeHead(targetRes.statusCode, outHeaders);
        res.end(outBuffer);
      });
    } else {
      res.writeHead(targetRes.statusCode, outHeaders);
      targetRes.pipe(res);
    }
  });

  clientReq.on('error', (err) => {
    console.warn(`[Browser Gateway] Failed to reach ${proto}://${host}:${port}${targetPath}:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Gateway Error</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #11111b; color: #f38ba8; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .card { background: #1e1e2e; padding: 32px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); max-width: 520px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    h2 { color: #f38ba8; margin-top: 0; font-size: 20px; }
    p { color: #a6adc8; font-size: 13px; line-height: 1.6; }
    code { background: #181825; padding: 4px 8px; border-radius: 6px; color: #89b4fa; font-family: monospace; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <h2>SSH Gateway Connection Failed</h2>
    <p>Could not connect to target service at <code>${escapeHtml(`${proto}://${host}:${port}${targetPath}`)}</code> via SSH Server.</p>
    <p><strong>Error:</strong> <code>${escapeHtml(err.message)}</code></p>
    <p>Ensure the remote port is actively listening and the SSH connection is open.</p>
  </div>
</body>
</html>`);
    }
  });

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    req.pipe(clientReq);
  } else {
    clientReq.end();
  }
}

// -------------------------------------------------------------
// BACKEND SERVER (Listening on Port 2020)
// -------------------------------------------------------------
const backendServer = http.createServer({ maxHeaderSize: 16 * 1024 }, async (req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Browser Gateway & Reverse Proxy (routes Web Mode traffic via remote SSH server)
  if (req.url.startsWith('/s/') || req.url.startsWith('/api/browser/gateway/') || req.url.startsWith('/api/browser/proxy')) {
    const token = extractSessionToken(req, null);
    const session = getSession(token);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Active session required to access browser gateway' }));
      return;
    }
    handleBrowserGatewayRequest(req, res);
    return;
  }

  // Health check
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // Keep the unauthenticated liveness endpoint intentionally minimal.
    // Runtime topology and active-session counts are not public health data.
    res.end(JSON.stringify({
      status: 'ok',
      service: 'sshdesktop-backend',
      version: VERSION
    }));
    return;
  }

  if (req.url === '/api/sso/status' && req.method === 'GET') {
    const sso = readJsonSafe(SSO_FILE, { enabled: false, provider_name: 'OIDC Identity Provider' });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: Boolean(sso.enabled && sso.issuer_url && sso.client_id), provider_name: sso.provider_name || 'SSO' }));
    return;
  }

  if (req.url === '/api/sso/start' && req.method === 'GET') {
    const sso = readJsonSafe(SSO_FILE, { enabled: false });
    if (!sso.enabled || !sso.issuer_url || !sso.client_id) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OIDC SSO is not configured/enabled.' }));
      return;
    }
    try {
      const wellKnownUrl = `${String(sso.issuer_url).replace(/\/+$/, '')}/.well-known/openid-configuration`;
      const discRes = await fetch(wellKnownUrl);
      if (!discRes.ok) throw new Error(`OIDC discovery HTTP ${discRes.status}`);
      const meta = await discRes.json();
      if (!meta.authorization_endpoint) throw new Error('OIDC discovery missing authorization_endpoint');
      const codeVerifier = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = new URL(meta.authorization_endpoint);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('client_id', sso.client_id);
      authUrl.searchParams.set('redirect_uri', sso.redirect_uri || `http://${req.headers.host || 'localhost:2222'}/api/sso/callback`);
      authUrl.searchParams.set('scope', 'openid profile email');
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      res.writeHead(302, { Location: authUrl.toString() });
      res.end();
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `OIDC discovery failed: ${err.message}` }));
    }
    return;
  }

  // Unified Web IPC Invoke Endpoint with HttpOnly Session Cookie + CSRF Protection
  if (req.url === '/api/invoke' && req.method === 'POST') {
    const reqReferer = String(req.headers['referer'] || '');
    try {
      if (reqReferer) {
        const refPath = new URL(reqReferer).pathname || '';
        if (refPath.startsWith('/s/') || refPath.startsWith('/api/browser/gateway/')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Forbidden: Proxied gateway frames cannot invoke SSH Desktop backend APIs.' }));
          return;
        }
      }
    } catch {}
    if (String(req.headers['x-requested-with'] || '') !== 'SSHDesktop') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: Missing required X-Requested-With header.' }));
      return;
    }

    const bodyChunks = [];
    const MAX_INVOKE_BODY = 10 * 1024 * 1024; // 10 MiB measured in actual request bytes
    let bodyBytes = 0;
    let bodyOverflow = false;

    req.on('data', chunk => {
      if (bodyOverflow) return;
      bodyBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (bodyBytes > MAX_INVOKE_BODY) {
        bodyOverflow = true;
        bodyChunks.length = 0;
        res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
        res.end(JSON.stringify({ error: 'Payload Too Large: Maximum request body is 10 MiB' }), () => {
          try { req.socket.destroy(); } catch {}
        });
        req.pause();
        return;
      }
      bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });

    req.on('end', async () => {
      if (bodyOverflow) return;
      try {
        const rawBody = Buffer.concat(bodyChunks, bodyBytes).toString('utf8');
        const payload = JSON.parse(rawBody || '{}');
        const { cmd, args } = payload;
        const token = extractSessionToken(req, payload);
        const session = getSession(token) || resolveApiToken(token);
        const clientIp = getClientIp(req);

        // Public auth commands do not require an active session
        const isPublicAuthCmd = cmd === 'auth_login' || cmd === 'auth_get_status';

        if (!isPublicAuthCmd && !session) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Session expired or unauthorized. Please sign in again (1 hour session limit).',
            session_expired: true,
            code: 'SESSION_EXPIRED'
          }));
          return;
        }

        const result = await handleInvokeCommand(cmd, args, session, clientIp);
        const respHeaders = { 'Content-Type': 'application/json' };
        const isSecureReq = Boolean(
          req.socket?.encrypted ||
          String(req.headers['x-forwarded-proto'] || '').toLowerCase().includes('https')
        );
        const secureFlag = isSecureReq ? '; Secure' : '';
        if (cmd === 'auth_login' && result?.success && result?.token) {
          respHeaders['Set-Cookie'] = `sshdesktop_session=${encodeURIComponent(result.token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureFlag}`;
          // Avoid leaking raw session token to client JS/localStorage; auth state relies on HttpOnly cookie
          const sanitizedResult = { ...result };
          delete sanitizedResult.token;
          res.writeHead(200, respHeaders);
          res.end(JSON.stringify({ result: sanitizedResult }));
          return;
        }
        if (cmd === 'auth_logout') {
          respHeaders['Set-Cookie'] = `sshdesktop_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secureFlag}`;
        }
        res.writeHead(200, respHeaders);
        res.end(JSON.stringify({ result }));
      } catch (err) {
        const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: err.message || String(err),
          ...(err?.code ? { code: err.code } : {})
        }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// Set slow-client and request timeouts
backendServer.headersTimeout = 60000;
backendServer.requestTimeout = 120000;
backendServer.keepAliveTimeout = 5000;

// WebSocket Server attached directly to Backend Server
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

function handleWsConnection(ws, req) {
  let urlObj;
  try { urlObj = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch { ws.close(1008, 'Invalid WebSocket request URL'); return; }
  const cookieMatch = req.headers.cookie ? req.headers.cookie.match(/(?:^|;\s*)sshdesktop_session=([^;]+)/) : null;
  let cookieToken = null;
  if (cookieMatch) {
    try { cookieToken = decodeURIComponent(cookieMatch[1].trim()); }
    catch { ws.close(1008, 'Malformed session cookie'); return; }
  }
  const secProtoToken = req.headers['sec-websocket-protocol'] ? req.headers['sec-websocket-protocol'].split(',')[0].trim() : null;
  const token = secProtoToken || cookieToken || req.headers['x-session-token'];
  if (!getSession(token)) { ws.close(1008, 'Session expired or unauthorized (1 hour limit)'); return; }
  ws.authToken = token;

  const termId = urlObj.searchParams.get('termId');
  const connId = urlObj.searchParams.get('connId');
  const cols = urlObj.searchParams.has('cols') ? Number(urlObj.searchParams.get('cols')) : 80;
  const rows = urlObj.searchParams.has('rows') ? Number(urlObj.searchParams.get('rows')) : 24;
  if (!termId || termId.length > 128 || !/^[A-Za-z0-9_-]+$/.test(termId)) {
    ws.close(1008, 'Invalid terminal identifier');
    return;
  }
  if (!Number.isInteger(cols) || cols < 1 || cols > 1000 || !Number.isInteger(rows) || rows < 1 || rows > 500) {
    ws.close(1008, 'Invalid initial terminal dimensions');
    return;
  }

  const existingClient = activeWsClients.get(termId);
  if (existingClient && existingClient !== ws) {
    try { existingClient.close(1000, 'Replaced by newer connection'); } catch {}
  }
  activeWsClients.set(termId, ws);

  let creationPending = false;
  const pendingInput = [];
  let pendingInputBytes = 0;
  const writeTerminalData = data => {
    const terminal = activeTerminals.get(termId);
    if (!terminal || !terminal.stream) return false;
    const writable = terminal.stream.write(data);
    if (writable === false && typeof terminal.stream.once === 'function') {
      ws.pause();
      terminal.stream.once('drain', () => { if (ws.readyState === WebSocket.OPEN) ws.resume(); });
    }
    return true;
  };

  if (!activeTerminals.has(termId) && connId) {
    creationPending = true;
    handleInvokeCommand('terminal_create', { connId, rows, cols, terminalId: termId })
      .then(async () => {
        creationPending = false;
        while (pendingInput.length && ws.readyState === WebSocket.OPEN) {
          const data = pendingInput.shift();
          pendingInputBytes -= data.length;
          const terminal = activeTerminals.get(termId);
          if (!terminal || !terminal.stream) break;
          const writable = terminal.stream.write(data);
          if (writable === false && typeof terminal.stream.once === 'function') {
            ws.pause();
            await new Promise(resolve => terminal.stream.once('drain', resolve));
          }
        }
        if (ws.readyState === WebSocket.OPEN) ws.resume();
      })
      .catch(err => {
        creationPending = false;
        pendingInput.length = 0;
        pendingInputBytes = 0;
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'output', text: '\r\n[SSH Desktop Error] Terminal spawn failed: ' + err.message + '\r\n' })); } catch {}
        }
      });
  }

  ws.on('message', message => {
    const data = Buffer.isBuffer(message) ? Buffer.from(message) : Buffer.from(message.toString());
    let parsed = null;
    try { parsed = JSON.parse(data.toString('utf8')); } catch {}
    if (parsed && parsed.type === 'resize') {
      const r = parsed.rows, c = parsed.cols;
      if (!Number.isInteger(r) || !Number.isInteger(c) || r < 1 || r > 500 || c < 1 || c > 1000) {
        ws.close(1008, 'Invalid terminal dimensions');
        return;
      }
      pendingTerminalResizes.set(termId, { rows: r, cols: c });
      const active = activeTerminals.get(termId);
      if (active && active.stream && typeof active.stream.setWindow === 'function') {
        try { active.stream.setWindow(r, c, 0, 0); } catch {}
      }
      return;
    }
    const terminal = activeTerminals.get(termId);
    if (!terminal || !terminal.stream) {
      if (creationPending) {
        if (pendingInputBytes + data.length > 64 * 1024) {
          ws.close(1009, 'Terminal input queued during startup exceeded 64 KiB');
          return;
        }
        pendingInput.push(data);
        pendingInputBytes += data.length;
      }
      return;
    }
    try {
      writeTerminalData(data);
    } catch (error) {
      console.warn('[SSH Desktop] Terminal input write failed:', error.message);
      ws.close(1011, 'Terminal input transport failed');
    }
  });

  ws.on('close', () => {
    pendingInput.length = 0;
    pendingInputBytes = 0;
    if (activeWsClients.get(termId) === ws) activeWsClients.delete(termId);
  });
}

function isAllowedWebSocketOrigin(req) {
  const origin = req.headers.origin;
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (typeof origin !== 'string' || !origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host.toLowerCase() === host;
  } catch { return false; }
}

backendServer.on('upgrade', (req, socket, head) => {
  if (!isAllowedWebSocketOrigin(req)) {
    socket.destroy();
    return;
  }

  if (/^\/ws\/terminal(?:\?|$)/.test(req.url)) {
    wss.handleUpgrade(req, socket, head, ws => {
      handleWsConnection(ws, req);
    });
  } else if (req.url.startsWith('/s/') || req.url.startsWith('/api/browser/gateway/')) {
    const token = extractSessionToken(req, null);
    const session = getSession(token);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    handleBrowserGatewayUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// -------------------------------------------------------------
// FRONTEND SERVER (Listening on Port 2222)
// -------------------------------------------------------------
const frontendServer = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Transparent reverse-proxy: Any /api/* or /s/* request from port 2222 is forwarded to backend on 2020
  if (req.url.startsWith('/api/') || req.url.startsWith('/s/')) {
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${BACKEND_PORT}`,
        // Overwrite client-provided forwarding headers; backend trusts this
        // private client-IP hint only from its loopback frontend proxy.
        'x-forwarded-for': req.socket.remoteAddress || '',
        'x-sshdesktop-client-ip': req.socket.remoteAddress || ''
      },
      maxHeaderSize: 16 * 1024
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Backend unavailable on port ${BACKEND_PORT}: ${err.message}` }));
    });
    req.pipe(proxyReq);
    return;
  }

  // Sanitize rogue undefined in URLs (e.g. from Jenkins or client-side routing bugs)
  if (req.url.startsWith('/undefined/')) {
    req.url = '/' + req.url.slice('/undefined/'.length);
  } else if (req.url.includes('/undefined/')) {
    req.url = req.url.replace(/\/undefined\//g, '/');
  }

  let reqPath;
  try {
    reqPath = decodeURI(req.url.split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Malformed URL');
    return;
  }

  // 1. Resolve Gateway context from Cookie or Referer
  let savedGw = null;
  if (req.headers.cookie && req.headers.cookie.includes('__ssh_session=')) {
    const m = req.headers.cookie.match(/__ssh_session=([^;]+)/);
    if (m) {
      try {
        const sessId = decodeURIComponent(m[1].trim());
        if (browserSessionRegistry.has(sessId)) {
          savedGw = `/s/${sessId}`;
        }
      } catch {}
    }
  }
  if (!savedGw && req.headers.cookie && req.headers.cookie.includes('__ssh_browser_gw=')) {
    const m = req.headers.cookie.match(/__ssh_browser_gw=([^;]+)/);
    if (m) {
      try { savedGw = decodeURIComponent(m[1].trim()); } catch {}
    }
  }
  if (!savedGw && req.headers.referer) {
    if (req.headers.referer.includes('/s/')) {
      const refMatch = req.headers.referer.match(/\/s\/([^/?#]+)/);
      if (refMatch) {
        savedGw = `/s/${refMatch[1]}`;
      }
    } else if (req.headers.referer.includes('/api/browser/gateway/')) {
      const refMatch = req.headers.referer.match(/(\/api\/browser\/gateway\/[^/]+\/https?\/[^/]+)/);
      if (refMatch) {
        savedGw = refMatch[1];
      }
    }
  }

  // 2. Detect if this request originated from within an active Gateway session
  const isFromGatewayReferer = Boolean(req.headers.referer && (req.headers.referer.includes('/s/') || req.headers.referer.includes('/api/browser/gateway/')));
  const isIframeGateway = Boolean(savedGw && req.headers['sec-fetch-dest'] === 'iframe');
  const isGatewayRequest = Boolean(savedGw && (isFromGatewayReferer || isIframeGateway));

  // If the request is for the root path ('/' or '/index.html') from inside the gateway,
  // DO NOT serve SSH Desktop dashboard! Redirect cleanly back to the gateway root!
  if ((reqPath === '/' || reqPath === '/index.html') && isGatewayRequest) {
    const forwardedPath = `${savedGw}/`;
    res.writeHead(302, {
      'Location': forwardedPath,
      'Cache-Control': 'no-cache',
      'Set-Cookie': `__ssh_browser_gw=${encodeURIComponent(savedGw)}; Path=/; SameSite=Lax`
    });
    res.end();
    return;
  }

  // 3. Serve SSH Desktop's own static assets (/assets/*, /clouddesk.svg, /sshdesktop.svg, or root '/' when NOT from gateway)
  const isCoreAsset = reqPath.startsWith('/assets/') || reqPath === '/clouddesk.svg' || reqPath === '/sshdesktop.svg' || reqPath === '/favicon.ico';
  const isRootDashboard = (reqPath === '/' || reqPath === '/index.html') && !isGatewayRequest;

  if (isCoreAsset || isRootDashboard) {
    const assetPath = isRootDashboard ? '/index.html' : reqPath;
    let diskPath;
    try {
      const resolvedDist = fs.realpathSync(DIST_DIR);
      const candidatePath = path.resolve(resolvedDist, '.' + (assetPath.startsWith('/') ? assetPath : '/' + assetPath));
      const relativePath = path.relative(resolvedDist, candidatePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access Denied: Path traversal detected.');
        return;
      }
      // Resolve symlinks as well: lexical containment alone does not prevent
      // an asset inside dist from pointing outside the distribution directory.
      diskPath = fs.realpathSync(candidatePath);
      const realRelativePath = path.relative(resolvedDist, diskPath);
      if (realRelativePath.startsWith('..') || path.isAbsolute(realRelativePath)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Access Denied: Path traversal detected.');
        return;
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      throw error;
    }
    if (fs.existsSync(diskPath)) {
      try {
        const stats = fs.statSync(diskPath);
        if (stats.isFile()) {
          const ext = path.extname(diskPath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
          });
          fs.createReadStream(diskPath).pipe(res);
          return;
        }
      } catch {}
    }
    if (typeof EMBEDDED_FILES !== 'undefined' && EMBEDDED_FILES && EMBEDDED_FILES[assetPath]) {
      const asset = EMBEDDED_FILES[assetPath];
      res.writeHead(200, {
        'Content-Type': asset.type,
        'Cache-Control': assetPath === '/index.html' ? 'no-cache' : 'public, max-age=31536000'
      });
      if (asset.isBase64) {
        res.end(Buffer.from(asset.b64, 'base64'));
      } else {
        res.end(asset.text);
      }
      return;
    }
  }

  // 4. Any other non-core path requested when a gateway context is present (e.g. /watch, /login, /s/desktop/..., /logout, /generate_204)
  if (savedGw) {
    const forwardedPath = `${savedGw}${req.url.startsWith('/') ? req.url : '/' + req.url}`;
    const isHtmlNav = req.method === 'GET' &&
                      (req.headers.accept || '').includes('text/html') &&
                      !req.headers['x-requested-with'];

    if (isHtmlNav) {
      res.writeHead(302, {
        'Location': forwardedPath,
        'Cache-Control': 'no-cache',
        'Set-Cookie': `__ssh_browser_gw=${encodeURIComponent(savedGw)}; Path=/; SameSite=Lax`
      });
      res.end();
      return;
    }

    // Transparent proxy to backendServer on port 2020
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: forwardedPath,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
      maxHeaderSize: 16 * 1024
    }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Gateway forwarding failed: ${err.message}` }));
    });
    req.pipe(proxyReq);
    return;
  }

  // 5. SPA Fallback: non-asset routes (or HTML routes) serve index.html (when no gateway context active)
  const isDirectAsset = reqPath.includes('.') && !reqPath.endsWith('.html');
  if (!isDirectAsset) {
    const diskIndex = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(diskIndex)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      fs.createReadStream(diskIndex).pipe(res);
      return;
    }
    if (typeof EMBEDDED_FILES !== 'undefined' && EMBEDDED_FILES && EMBEDDED_FILES['/index.html']) {
      const asset = EMBEDDED_FILES['/index.html'];
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(asset.isBase64 ? Buffer.from(asset.b64, 'base64') : asset.text);
      return;
    }
  }

  // 4. Fallback message if dist was not found at all
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SSH Desktop Server</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f111a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1a1d2d; padding: 40px; border-radius: 12px; border: 1px solid #2e344e; max-width: 520px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { color: #60a5fa; margin-top: 0; }
    code { background: #24293d; padding: 3px 8px; border-radius: 6px; color: #34d399; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 SSH Desktop All-in-One Engine</h1>
    <p>Frontend is running on port <strong>${FRONTEND_PORT}</strong>.</p>
    <p>Backend API is running on port <strong>${BACKEND_PORT}</strong>.</p>
    <p>Build the frontend with: <code>npm run build</code></p>
  </div>
</body>
</html>`);
});

// Set slow-client and request timeouts for frontend server
frontendServer.headersTimeout = 60000;
frontendServer.requestTimeout = 120000;
frontendServer.keepAliveTimeout = 5000;

// Forward WebSocket upgrades on port 2222 directly to backend WebSocket handler with origin & session validation
frontendServer.on('upgrade', (req, socket, head) => {
  if (!isAllowedWebSocketOrigin(req)) {
    socket.destroy();
    return;
  }

  if (/^\/ws\/terminal(?:\?|$)/.test(req.url)) {
    wss.handleUpgrade(req, socket, head, ws => {
      handleWsConnection(ws, req);
    });
  } else if (req.url.startsWith('/s/') || req.url.startsWith('/api/browser/gateway/')) {
    const token = extractSessionToken(req, null);
    const session = getSession(token);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    handleBrowserGatewayUpgrade(req, socket, head);
  } else {
    let savedGw = null;
    if (req.headers.cookie && req.headers.cookie.includes('__ssh_session=')) {
      const m = req.headers.cookie.match(/__ssh_session=([^;]+)/);
      if (m) {
        try {
          const sessId = decodeURIComponent(m[1].trim());
          if (browserSessionRegistry.has(sessId)) savedGw = `/s/${sessId}`;
        } catch {}
      }
    }
    if (!savedGw && req.headers.cookie && req.headers.cookie.includes('__ssh_browser_gw=')) {
      const m = req.headers.cookie.match(/__ssh_browser_gw=([^;]+)/);
      if (m) try { savedGw = decodeURIComponent(m[1].trim()); } catch {}
    }
    if (!savedGw && req.headers.referer) {
      if (req.headers.referer.includes('/s/')) {
        const refMatch = req.headers.referer.match(/\/s\/([^/?#]+)/);
        if (refMatch) savedGw = `/s/${refMatch[1]}`;
      } else if (req.headers.referer.includes('/api/browser/gateway/')) {
        const refMatch = req.headers.referer.match(/(\/api\/browser\/gateway\/[^/]+\/https?\/[^/]+)/);
        if (refMatch) savedGw = refMatch[1];
      }
    }
    // A Referer is attacker-controlled and is not an authorization credential.
    // Only allow fallback gateway upgrades when the referenced opaque gateway
    // session still exists in the in-memory registry.
    if (savedGw && resolveSessionFromRequest(savedGw)) {
      req.url = `${savedGw}${req.url.startsWith('/') ? req.url : '/' + req.url}`;
      handleBrowserGatewayUpgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  }
});

// -------------------------------------------------------------
// Start Both Servers
// -------------------------------------------------------------

backendServer.on('error', (err) => {
  console.error('[SSH Desktop] Backend server error:', err);
  process.exit(1);
});

frontendServer.on('error', (err) => {
  console.error('[SSH Desktop] Frontend server error:', err);
  process.exit(1);
});

export {
  parseSocks5GreetingFrame,
  parseSocks5UserPassFrame,
  parseSocks5ConnectFrame,
  validateVaultKeyName,
  vaultEncryptValue,
  vaultDecryptValue,
  vaultRotateKey,
  base32Encode,
  base32Decode,
  computeTotpAt,
  verifyTotpCode,
  resolveApiToken,
  appendAuditEvent,
  verifyAuditChain,
  getSecurityPolicy,
  enforcePolicyPermission,
  evaluateKnownHostsContent,
  backendServer,
  frontendServer,
};

// Backend is private. Only the frontend is exposed to the network.
if (process.env.SSHDESKTOP_LIB_ONLY !== '1') {
  backendServer.listen(BACKEND_PORT, BACKEND_HOST, () => {
    frontendServer.listen(FRONTEND_PORT, HOST, () => {
      console.log('\n======================================================');
      console.log('SSH Desktop Standalone Server Started');
      console.log('======================================================');
      console.log(`Frontend: http://${HOST}:${FRONTEND_PORT}`);
      console.log(`Backend:  http://${BACKEND_HOST}:${BACKEND_PORT}`);
      console.log(`Data:     ${DATA_DIR}`);
      console.log('Backend access: localhost only');
      console.log('======================================================\n');
    });
  });
}
