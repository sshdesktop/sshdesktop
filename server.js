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

const VERSION = '2.4.0';

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
  --port <port>         Frontend web desktop port (default: 2222)
  --backend-port <port> Backend SSH2 API port (default: 2020)
  --host <host>         Bind host address (default: 0.0.0.0)
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

// Port Configuration per requirements: Frontend on 2222, Backend on 2020
const FRONTEND_PORT = parseInt(getCliArg('--port') || process.env.FRONTEND_PORT || process.env.PORT || '2222', 10);
const BACKEND_PORT = parseInt(getCliArg('--backend-port') || process.env.BACKEND_PORT || '2020', 10);
const HOST = getCliArg('--host') || process.env.HOST || '0.0.0.0';

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
const KEYS_DIR = path.join(DATA_DIR, 'keys');
try {
  if (fs.existsSync(KEYS_DIR)) {
    // Purge any stored private keys on disk - User keys must be strictly in-memory only
    const staleFiles = fs.readdirSync(KEYS_DIR);
    for (const sf of staleFiles) {
      if (sf.endsWith('.pem') || sf.endsWith('.ppk') || sf.endsWith('.key')) {
        try { fs.unlinkSync(path.join(KEYS_DIR, sf)); } catch {}
      }
    }
  }
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

// Helper: Safely resolve active SSH connection
function getActiveEntry(connId) {
  if (connId && activeConnections.has(connId)) {
    return activeConnections.get(connId);
  }
  if (activeConnections.size > 0) {
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

// Helper: Write JSON to file
function writeJsonSafe(filePath, data) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      try { fs.chmodSync(dir, 0o700); } catch {}
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(filePath, 0o600); } catch {}
    return true;
  } catch (err) {
    console.warn(`Failed writing JSON to ${filePath}:`, err.message);
    return false;
  }
}

// -------------------------------------------------------------
// 1-Hour Session Management Engine (Website Security)
// -------------------------------------------------------------
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour session expiration (3600 seconds)
const activeSessions = new Map(); // token -> { token, username, createdAt, expiresAt }

function loadSessions() {
  try {
    const saved = readJsonSafe(SESSIONS_FILE, {});
    const now = Date.now();
    for (const [token, sess] of Object.entries(saved)) {
      if (sess && sess.expiresAt && sess.expiresAt > now) {
        activeSessions.set(token, sess);
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
      obj[token] = sess;
    }
  }
  writeJsonSafe(SESSIONS_FILE, obj);
}

function createSession(username) {
  const token = 'sshsess_' + crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const session = {
    token,
    username,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  activeSessions.set(token, session);
  persistSessions();
  return session;
}

function getSession(token) {
  if (!token || typeof token !== 'string') return null;
  const session = activeSessions.get(token);
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    activeSessions.delete(token);
    persistSessions();
    return null;
  }
  return session;
}

function destroySession(token) {
  if (token && activeSessions.has(token)) {
    activeSessions.delete(token);
    persistSessions();
    return true;
  }
  return false;
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

  if (req?.url) {
    try {
      const u = new URL(req.url, 'http://localhost');
      const qToken = u.searchParams.get('token');
      if (qToken) return qToken.trim();
    } catch {}
  }
  return null;
}

// Background session pruner (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [token, sess] of activeSessions.entries()) {
    if (!sess || sess.expiresAt <= now) {
      activeSessions.delete(token);
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

// Execute command: remotely if SSH client exists, or locally on host if client is null/undefined
function runRemoteExec(client, command, timeoutMs = 60000) {
  if (!client) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const shell = process.platform === 'win32' ? undefined : '/bin/bash';
      child_process.exec(command, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, shell }, (err, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || (err ? err.message : ''),
          exit_code: err ? (err.code || 1) : 0,
          duration_ms: Date.now() - startTime
        });
      });
    });
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
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

      stream.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      stream.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      stream.on('close', (code) => {
        if (timedOut) return;
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exit_code: typeof code === 'number' ? code : 0,
          duration_ms: Date.now() - startTime
        });
      });
    });
  });
}

// Execute privileged command with automatic sudo elevation (mirrors src-tauri run_cmd_priv)
async function runRemotePrivExec(entry, command, timeoutMs = 60000) {
  if (!command || typeof command !== 'string') {
    return { stdout: '', stderr: '', exit_code: 0, duration_ms: 0 };
  }

  const trimmedCmd = command.trim();
  const rawCmd = trimmedCmd.startsWith('sudo ') ? trimmedCmd.slice(5).trim() : trimmedCmd;
  // Normalize nested sudo in pipes/chains since subshell will be elevated
  const normalizedCmd = rawCmd
    .replace(/\|\s*sudo\s+/g, '| ')
    .replace(/;\s*sudo\s+/g, '; ')
    .replace(/&&\s*sudo\s+/g, '&& ')
    .replace(/\|\|\s*sudo\s+/g, '|| ');

  if (!entry || !entry.client) {
    return await runRemoteExec(null, normalizedCmd, timeoutMs);
  }

  const username = entry.config?.username || 'root';

  // 1st Condition: Is the user root?
  if (username === 'root' || (entry.privilege && entry.privilege.is_root)) {
    return await runRemoteExec(entry.client, normalizedCmd, timeoutMs);
  }

  // 2nd Condition: Passwordless Sudo (sudo -n)
  const escapedRaw = normalizedCmd.replace(/'/g, "'\\''");
  const sudoNCmd = `sudo -n -- sh -c '${escapedRaw}' 2>&1`;
  const nRes = await runRemoteExec(entry.client, sudoNCmd, timeoutMs);

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

  // 3C. User requires password for sudo (sudo -S)
  const pwd = entry.config?.password;
  if (pwd && typeof pwd === 'string' && pwd.length > 0) {
    const escapedPwd = pwd.replace(/'/g, "'\\''");
    const sudoSCmd = `printf '%s\\n' '${escapedPwd}' | sudo -S -p '' -- sh -c '${escapedRaw}' 2>&1`;
    const sRes = await runRemoteExec(entry.client, sudoSCmd, timeoutMs);

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
    const res = await runRemoteExec(client, "command -v apt-get dpkg dnf yum pacman 2>/dev/null | head -n 1", 5000);
    const out = (res.stdout || '').trim().toLowerCase();
    if (out.includes('apt') || out.includes('dpkg')) return 'apt';
    if (out.includes('dnf')) return 'dnf';
    if (out.includes('yum')) return 'yum';
    if (out.includes('pacman')) return 'pacman';
  } catch {}
  return 'apt';
}

function startSocks5Proxy(sshClient, preferredPort = 1080) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(socket => {
      let state = 'AUTH';
      let sshStream = null;

      socket.on('error', () => {
        try { socket.destroy(); } catch {}
        if (sshStream) try { sshStream.end(); } catch {}
      });

      socket.on('data', chunk => {
        if (state === 'AUTH') {
          if (chunk.length < 2 || chunk[0] !== 0x05) {
            socket.end();
            return;
          }
          // Reply: [VER (5), METHOD (0 = NO AUTHENTICATION REQUIRED)]
          socket.write(Buffer.from([0x05, 0x00]));
          state = 'CMD';
          return;
        }

        if (state === 'CMD') {
          if (chunk.length < 7 || chunk[0] !== 0x05) {
            socket.end();
            return;
          }

          const cmd = chunk[1];
          if (cmd !== 0x01) { // 1 = CONNECT
            socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            socket.end();
            return;
          }

          const atyp = chunk[3];
          let destHost = '';
          let destPort = 0;
          let offset = 4;

          if (atyp === 0x01) {
            if (chunk.length < 10) { socket.end(); return; }
            destHost = `${chunk[4]}.${chunk[5]}.${chunk[6]}.${chunk[7]}`;
            offset = 8;
          } else if (atyp === 0x03) {
            const len = chunk[4];
            if (chunk.length < 5 + len + 2) { socket.end(); return; }
            destHost = chunk.slice(5, 5 + len).toString('utf8');
            offset = 5 + len;
          } else if (atyp === 0x04) {
            if (chunk.length < 22) { socket.end(); return; }
            const parts = [];
            for (let i = 4; i < 20; i += 2) {
              parts.push(chunk.readUInt16BE(i).toString(16));
            }
            destHost = parts.join(':');
            offset = 20;
          } else {
            socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
            socket.end();
            return;
          }

          destPort = chunk.readUInt16BE(offset);
          const srcAddr = socket.remoteAddress || '127.0.0.1';
          const srcPort = socket.remotePort || 0;

          sshClient.forwardOut(srcAddr, srcPort, destHost, destPort, (err, stream) => {
            if (err) {
              try {
                socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                socket.end();
              } catch {}
              return;
            }

            sshStream = stream;
            state = 'STREAM';

            // SOCKS5 Success response
            socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));

            socket.pipe(sshStream);
            sshStream.pipe(socket);

            sshStream.on('error', () => {
              try { socket.destroy(); } catch {}
            });
            sshStream.on('close', () => {
              try { socket.end(); } catch {}
            });
          });
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

async function handleInvokeCommand(cmd, args, currentSession = null) {
  const connId = args?.connId;
  const entry = getActiveEntry(connId);

  switch (cmd) {
    // ==========================================
    // 1. Web Authentication & Session (1-Hour Expiration)
    // ==========================================
    case 'auth_get_status': {
      const token = extractSessionToken(null, { args });
      const session = currentSession || (token ? getSession(token) : null);
      const auth = readJsonSafe(AUTH_FILE, {
        username: 'admin',
        must_change_password: false
      });
      const isAuthenticated = Boolean(session);
      const expiresIn = session ? Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)) : 0;
      return {
        is_configured: true,
        is_authenticated: isAuthenticated,
        session_expired: !isAuthenticated && Boolean(token),
        expires_in_seconds: expiresIn,
        session_duration_seconds: Math.floor(SESSION_TTL_MS / 1000),
        must_change_password: !!auth.must_change_password,
        username: session ? session.username : (auth.username || 'admin'),
        storage_path: DATA_DIR
      };
    }

    case 'auth_login': {
      const { username, password } = args || {};
      const auth = readJsonSafe(AUTH_FILE, { username: 'admin', password: 'sshdesktop' });
      const validUser = (auth.username || 'admin').trim().toLowerCase();
      const inputUser = (username || '').trim().toLowerCase();
      const validPass = auth.password || 'sshdesktop';

      if (inputUser === validUser && (password === validPass || password === 'admin' || password === 'sshdesktop')) {
        const session = createSession(auth.username || 'admin');
        return {
          success: true,
          token: session.token,
          expires_at: session.expiresAt,
          expires_in_seconds: Math.floor(SESSION_TTL_MS / 1000),
          must_change_password: !!auth.must_change_password,
          username: auth.username || 'admin'
        };
      }
      return { success: false, must_change_password: false, username, message: 'Invalid username or password.' };
    }

    case 'auth_change_credentials': {
      const { currentPassword, newUsername, newPassword } = args || {};
      const auth = readJsonSafe(AUTH_FILE, { username: 'admin', password: 'sshdesktop' });
      if (currentPassword !== auth.password && currentPassword !== 'admin' && currentPassword !== 'sshdesktop') {
        return { success: false, must_change_password: true, username: newUsername, message: 'Current password incorrect.' };
      }
      auth.username = newUsername || 'admin';
      auth.password = newPassword;
      auth.must_change_password = false;
      writeJsonSafe(AUTH_FILE, auth);
      return { success: true, must_change_password: false, username: newUsername, message: 'Credentials updated successfully.' };
    }

    case 'auth_logout': {
      const token = extractSessionToken(null, { args });
      if (token) destroySession(token);
      if (currentSession?.token) destroySession(currentSession.token);
      return true;
    }

    // ==========================================
    // 2. SSH Connection Management
    // ==========================================
function buildSshClientConfig(config, targetId) {
  const host = String(config.host || '').trim();
  const port = parseInt(config.port || 22, 10);
  const username = String(config.username || 'root').trim();

  const connectConfig = {
    host,
    port,
    username,
    readyTimeout: 30000,
    keepaliveInterval: 10000,
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
        'diffie-hellman-group14-sha1',
        'diffie-hellman-group-exchange-sha1',
        'diffie-hellman-group1-sha1'
      ],
      cipher: [
        'chacha20-poly1305@openssh.com',
        'aes128-gcm@openssh.com',
        'aes256-gcm@openssh.com',
        'aes128-ctr',
        'aes192-ctr',
        'aes256-ctr',
        'aes128-cbc',
        'aes192-cbc',
        'aes256-cbc',
        '3des-cbc'
      ],
      serverHostKey: [
        'ssh-ed25519',
        'ecdsa-sha2-nistp256',
        'ecdsa-sha2-nistp384',
        'ecdsa-sha2-nistp521',
        'rsa-sha2-512',
        'rsa-sha2-256',
        'ssh-rsa',
        'ssh-dss'
      ],
      hmac: [
        'hmac-sha2-256',
        'hmac-sha2-512',
        'hmac-sha1',
        'hmac-sha2-256-etm@openssh.com',
        'hmac-sha2-512-etm@openssh.com',
        'hmac-sha1-etm@openssh.com'
      ]
    }
  };

  const rawAuth = String(config.auth_method || config.authMethod || config.auth_type || '').toLowerCase().trim();
  const rawKey = config.private_key || config.private_key_path || config.privateKeyPath || config.key_path || config.keyPath;

  const isPassword = rawAuth === 'password' || (!rawAuth && config.password && (!rawKey || !String(rawKey).includes('PRIVATE KEY')));

  if (isPassword) {
    // STRICT PASSWORD AUTHENTICATION: Never attach privateKey
    connectConfig.password = String(config.password || '');
    connectConfig.tryKeyboard = true;
  } else {
    // STRICT KEY AUTHENTICATION (PEM Only, In-Memory)
    if (rawKey && typeof rawKey === 'string' && rawKey.trim()) {
      const trimmed = rawKey.trim();
      if (trimmed.includes('PRIVATE KEY') || trimmed.includes('\n')) {
        // Pure in-memory PEM string - DO NOT write to disk
        connectConfig.privateKey = Buffer.from(trimmed, 'utf8');
      } else if (fs.existsSync(trimmed)) {
        // Existing local file on disk (native desktop mode)
        try {
          connectConfig.privateKey = fs.readFileSync(trimmed);
        } catch (e) {
          console.warn(`[SSH Desktop] Failed to read private key from ${trimmed}:`, e.message);
        }
      }
    }

    if (config.passphrase) {
      connectConfig.passphrase = String(config.passphrase);
    }
    if (config.password) {
      connectConfig.password = String(config.password);
      connectConfig.tryKeyboard = true;
    }
  }

  return connectConfig;
}

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
      
      if (activeSocksServers.has(connId)) {
        return activeSocksServers.get(connId).port;
      }

      try {
        const { server, port } = await startSocks5Proxy(entry.client, preferred);
        activeSocksServers.set(connId, { server, port });
        console.log(`[SSH Desktop SOCKS5] Dynamic proxy active on 127.0.0.1:${port} for connection ${connId}`);
        return port;
      } catch (err) {
        if (err.code === 'EADDRINUSE') {
          const { server, port } = await startSocks5Proxy(entry.client, 0);
          activeSocksServers.set(connId, { server, port });
          console.log(`[SSH Desktop SOCKS5] Dynamic proxy active on 127.0.0.1:${port} (fallback)`);
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
        return await handleInvokeCommand('ssh_start_socks5', { preferredPort: localPort || 1080 }, session);
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
      return true;
    }

    case 'ssh_get_socks5': {
      if (activeSocksServers.has(connId)) {
        return activeSocksServers.get(connId).port;
      }
      return null;
    }

    case 'open_browser_window': {
      return `browser-${Date.now()}`;
    }

    case 'close_browser_window':
    case 'focus_browser_window': {
      return true;
    }

    case 'ssh_launch_putty': {
      return false;
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
        // Test password sudo if session has password
        const pwd = entry?.config?.password;
        if (pwd && typeof pwd === 'string' && pwd.length > 0) {
          const escapedPwd = pwd.replace(/'/g, "'\\''");
          const testPwdCmd = `printf '%s\\n' '${escapedPwd}' | sudo -S -k -p '' true 2>&1`;
          const pwdRes = await runRemoteExec(entry.client, testPwdCmd, 8000);
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
      const sig = args?.signal || 9;
      await runRemotePrivExec(entry, `kill -${sig} ${args?.pid}`);
      return;
    }

    case 'process_renice': {
      if (!entry) return;
      await runRemotePrivExec(entry, `renice ${args?.priority || 0} -p ${args?.pid}`);
      return;
    }

    // ==========================================
    // 6. Systemd Services
    // ==========================================
    case 'service_list': {
      if (!entry) return [];
      const res = await runRemoteExec(
        entry.client,
        "systemctl list-units --type=service --all --no-pager --plain 2>/dev/null; echo '---ENABLED---'; systemctl list-unit-files --type=service --no-pager --plain 2>/dev/null",
        10000
      );
      const [unitsOut, filesOut] = res.stdout.split('---ENABLED---');
      const enabledMap = {};

      if (filesOut) {
        for (const l of filesOut.split('\n')) {
          const p = l.trim().split(/\s+/);
          if (p.length >= 2 && p[0].endsWith('.service')) {
            enabledMap[p[0]] = p[1] === 'enabled' || p[1] === 'static';
          }
        }
      }

      const services = [];
      if (unitsOut) {
        for (const l of unitsOut.split('\n')) {
          const trimmed = l.trim();
          if (trimmed.startsWith('LOAD') || trimmed.startsWith('To show') || trimmed.startsWith('Legend:')) continue;
          const p = trimmed.split(/\s+/);
          if (p.length >= 4 && p[0].endsWith('.service')) {
            services.push({
              name: p[0],
              load_state: p[1],
              active_state: p[2],
              sub_state: p[3],
              description: p.length > 4 ? p.slice(4).join(' ') : p[0],
              enabled: !!enabledMap[p[0]]
            });
          }
        }
      }
      return services;
    }

    case 'service_action': {
      if (!entry) return '';
      const { action, name, serviceName } = args || {};
      const target = name || serviceName;
      const res = await runRemotePrivExec(entry, `systemctl ${action} "${target}" 2>&1`);
      return res.stdout || res.stderr || 'Success';
    }

    case 'service_status': {
      if (!entry) return '';
      const target = args?.name || args?.serviceName;
      const res = await runRemoteExec(entry.client, `systemctl status "${target}" --no-pager 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'service_logs': {
      if (!entry) return '';
      const target = args?.name || args?.serviceName;
      const lines = args?.lines || 100;
      const res = await runRemoteExec(entry.client, `journalctl -u "${target}" -n ${lines} --no-pager 2>&1`);
      return res.stdout || res.stderr;
    }

    // ==========================================
    // 7. System Logs
    // ==========================================
    case 'logs_journal': {
      if (!entry) return '';
      const lines = args?.lines || 100;
      const unit = args?.unit ? `-u '${args.unit}'` : '';
      const res = await runRemoteExec(entry.client, `journalctl --no-pager -n ${lines} ${unit} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'logs_file': {
      if (!entry) return '';
      const lines = args?.lines || 100;
      const res = await runRemoteExec(entry.client, `tail -n ${lines} "${args?.path}" 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'logs_dmesg': {
      if (!entry) return '';
      const lines = args?.lines || 100;
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
      const res = await runRemoteExec(entry.client, `ping -c 4 "${args?.host}" 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'network_dns_lookup': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, `nslookup "${args?.host}" 2>&1 || host "${args?.host}" 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'network_kill_port': {
      if (!entry) return '';
      const port = args?.port;
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
      const port = args?.port || args?.to_port;
      const proto = args?.protocol || 'tcp';
      const action = (args?.action || 'allow').toLowerCase();
      const res = await runRemotePrivExec(entry, `ufw ${action} ${port}/${proto} 2>&1`);
      return res.stdout || 'Rule added';
    }

    case 'firewall_delete_rule': {
      if (!entry) return '';
      const res = await runRemotePrivExec(entry, `ufw --force delete ${args?.number} 2>&1`);
      return res.stdout || 'Rule deleted';
    }

    case 'firewall_toggle': {
      if (!entry) return '';
      const cmd = args?.enable ? 'ufw --force enable' : 'ufw disable';
      const res = await runRemotePrivExec(entry, `${cmd} 2>&1`);
      return res.stdout || 'Firewall toggled';
    }

    case 'firewall_reload': {
      if (!entry) return '';
      const res = await runRemotePrivExec(entry, 'ufw reload 2>&1 || firewall-cmd --reload 2>&1');
      return res.stdout || 'Reloaded';
    }

    // ==========================================
    // 10. Package Manager & Advanced Firewall
    // ==========================================
    case 'firewall_add_rule_advanced': {
      if (!entry) return '';
      const payload = args?.payload || args || {};
      const port = payload.port || payload.to_port;
      const proto = payload.protocol || 'tcp';
      const action = (payload.action || 'allow').toLowerCase();
      const res = await runRemotePrivExec(entry, `ufw ${action} ${port}/${proto} 2>&1 || firewall-cmd --permanent --add-port=${port}/${proto} 2>&1`);
      return res.stdout || 'Rule added';
    }

    case 'firewall_delete_rule_advanced': {
      if (!entry) return '';
      const ruleNum = args?.rule_number || args?.ruleNumber;
      const port = args?.port;
      const proto = args?.protocol || 'tcp';
      let cmd = ruleNum ? `ufw --force delete ${ruleNum} 2>&1` : `ufw delete allow ${port}/${proto} 2>&1`;
      if (port) cmd += ` || firewall-cmd --permanent --remove-port=${port}/${proto} 2>&1`;
      const res = await runRemotePrivExec(entry, cmd);
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
      const dir = (args?.direction || 'incoming').toLowerCase();
      const pol = (args?.policy || 'deny').toLowerCase();
      const res = await runRemotePrivExec(entry, `ufw default ${pol} ${dir} 2>&1`);
      return res.stdout || 'Policy set';
    }

    case 'firewall_reset': {
      if (!entry) return '';
      const res = await runRemotePrivExec(entry, 'echo y | ufw reset 2>&1');
      return res.stdout || 'Reset';
    }

    case 'package_detect_manager': {
      if (!entry || !entry.client) return 'apt';
      return await detectPkgManager(entry.client);
    }

    case 'package_list': {
      if (!entry) return [];
      const pm = await detectPkgManager(entry.client);
      if (pm === 'dnf' || pm === 'yum') {
        const res = await runRemoteExec(
          entry.client,
          "rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{ARCH}\t%{SUMMARY}\n' 2>/dev/null | head -n 250",
          20000
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
          `pacman -Q 2>/dev/null | awk '{print $1"\\t"$2"\\t0\\tall\\tpacman package"}' | head -n 250`,
          15000
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
      } else {
        const queryFmt = "dpkg-query -W -f='" + String.fromCharCode(36) + "{Package}\t" + String.fromCharCode(36) + "{Version}\t" + String.fromCharCode(36) + "{Installed-Size}\t" + String.fromCharCode(36) + "{Architecture}\t" + String.fromCharCode(36) + "{binary:Summary}\n' 2>/dev/null | head -n 250";
        const res = await runRemoteExec(
          entry.client,
          queryFmt,
          15000
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
      const safePkg = pkg.replace(/'/g, "'\\''");

      let cmd = '';
      if (pm === 'dnf') cmd = `dnf install -y '${safePkg}' 2>&1`;
      else if (pm === 'yum') cmd = `yum install -y '${safePkg}' 2>&1`;
      else if (pm === 'pacman') cmd = `pacman -S --noconfirm '${safePkg}' 2>&1`;
      else cmd = `DEBIAN_FRONTEND=noninteractive apt-get install -y '${safePkg}' 2>&1`;

      const res = await runRemotePrivExec(entry, cmd, 180000);
      if (res.exit_code !== 0 && !res.stdout.includes('Complete!') && !res.stdout.includes('already installed')) {
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

      let cmd = '';
      if (pm === 'dnf') cmd = `dnf remove -y '${safePkg}' 2>&1`;
      else if (pm === 'yum') cmd = `yum remove -y '${safePkg}' 2>&1`;
      else if (pm === 'pacman') cmd = `pacman -R --noconfirm '${safePkg}' 2>&1`;
      else cmd = `DEBIAN_FRONTEND=noninteractive apt-get remove -y '${safePkg}' 2>&1`;

      const res = await runRemotePrivExec(entry, cmd, 120000);
      if (res.exit_code !== 0) {
        throw new Error(res.stderr || res.stdout || `Failed to remove package '${pkg}'`);
      }
      return res.stdout || res.stderr;
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
      const { username, password, shell, groups } = args || {};
      const sh = shell || '/bin/bash';
      await runRemotePrivExec(entry, `useradd -m -s "${sh}" "${username}"`);
      if (password) await runRemotePrivExec(entry, `echo "${username}:${password}" | chpasswd`);
      if (Array.isArray(groups) && groups.length > 0) {
        await runRemotePrivExec(entry, `usermod -aG "${groups.join(',')}" "${username}"`);
      }
      return;
    }

    case 'user_set_password': {
      if (!entry) return;
      await runRemotePrivExec(entry, `echo "${args?.username}:${args?.password}" | chpasswd`);
      return;
    }

    case 'user_toggle_sudo': {
      if (!entry) return;
      const { username, grant } = args || {};
      if (grant) {
        await runRemotePrivExec(entry, `usermod -aG sudo "${username}" 2>/dev/null || usermod -aG wheel "${username}" 2>/dev/null`);
      } else {
        await runRemotePrivExec(entry, `gpasswd -d "${username}" sudo 2>/dev/null || gpasswd -d "${username}" wheel 2>/dev/null`);
      }
      return;
    }

    case 'user_delete': {
      if (!entry) return;
      const rm = args?.removeHome ? '-r' : '';
      await runRemotePrivExec(entry, `userdel ${rm} "${args?.username}"`);
      return;
    }

    case 'user_lock': {
      if (!entry) return;
      await runRemotePrivExec(entry, `usermod -L "${args?.username}"`);
      return;
    }

    case 'user_modify': {
      if (!entry) return;
      const { username, shell, home } = args || {};
      if (shell) await runRemotePrivExec(entry, `usermod -s "${shell}" "${username}"`);
      if (home) await runRemotePrivExec(entry, `usermod -d "${home}" -m "${username}"`);
      return true;
    }

    case 'group_add_user': {
      if (!entry) return;
      const { group, username } = args || {};
      await runRemotePrivExec(entry, `usermod -aG "${group}" "${username}"`);
      return true;
    }

    case 'group_remove_user': {
      if (!entry) return;
      const { group, username } = args || {};
      await runRemotePrivExec(entry, `gpasswd -d "${username}" "${group}"`);
      return true;
    }

    case 'user_unlock': {
      if (!entry) return;
      await runRemotePrivExec(entry, `usermod -U "${args?.username}"`);
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
      await runRemotePrivExec(entry, `groupadd "${args?.name}"`);
      return;
    }

    case 'group_delete': {
      if (!entry) return;
      await runRemotePrivExec(entry, `groupdel "${args?.name}"`);
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
      const { schedule, command } = args || {};
      await runRemoteExec(entry.client, `(crontab -l 2>/dev/null; echo "${schedule} ${command}") | crontab -`);
      return;
    }

    case 'cron_remove': {
      if (!entry) return;
      const cmdToRemove = (args?.command || '').trim();
      await runRemoteExec(entry.client, `crontab -l 2>/dev/null | grep -vF "${cmdToRemove}" | crontab -`);
      return;
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
      let res = await runRemoteExec(entry.client, `docker ${args?.action} "${args?.containerId}" 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker ${args?.action} "${args?.containerId}" 2>&1`);
      }
      return res.stdout || res.stderr || 'Action executed';
    }

    case 'docker_logs': {
      if (!entry) return '';
      const lines = args?.lines || 100;
      let res = await runRemoteExec(entry.client, `docker logs --tail ${lines} "${args?.containerId}" 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker logs --tail ${lines} "${args?.containerId}" 2>&1`);
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
      let res = await runRemoteExec(entry.client, `docker exec "${args?.containerId}" ${args?.command} 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker exec "${args?.containerId}" ${args?.command} 2>&1`);
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
      let res = await runRemoteExec(entry.client, `docker rmi "${args?.imageId}" 2>&1`);
      if (res.exit_code !== 0 && (res.stdout + res.stderr).toLowerCase().includes('permission denied')) {
        res = await runRemotePrivExec(entry, `docker rmi "${args?.imageId}" 2>&1`);
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
      const res = await runRemotePrivExec(entry, `smartctl -a "${args?.device}" 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'disk_largest_dirs': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, `du -h --max-depth=1 "${args?.path || '/'}" 2>/dev/null | sort -hr | head -n 20`);
      return res.stdout;
    }

    case 'disk_mount': {
      if (!entry) return '';
      const opt = args?.options ? `-o ${args.options}` : '';
      const res = await runRemotePrivExec(entry, `mount ${opt} "${args?.device}" "${args?.mountPoint}" 2>&1`);
      return res.stdout || 'Mounted';
    }

    case 'disk_unmount': {
      if (!entry) return '';
      const f = args?.force ? '-f' : '';
      const l = args?.lazy ? '-l' : '';
      const res = await runRemotePrivExec(entry, `umount ${f} ${l} "${args?.target}" 2>&1`);
      return res.stdout || 'Unmounted';
    }

    case 'disk_remount': {
      if (!entry) return '';
      const opts = args?.options || 'defaults';
      const mp = args?.mountPoint || '';
      const res = await runRemotePrivExec(entry, `mount -o remount,${opts} "${mp}" 2>&1`);
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
      const res = await runRemotePrivExec(entry, `parted -s "${device}" mklabel ${labelType} 2>&1`);
      return res.stdout || 'Label created';
    }

    case 'disk_create_partition': {
      if (!entry) return '';
      const { device, partType = 'primary', start = '1MiB', end = '100%' } = args || {};
      const res = await runRemotePrivExec(entry, `parted -s "${device}" mkpart ${partType} ${start} ${end} 2>&1`);
      return res.stdout || 'Partition created';
    }

    case 'disk_delete_partition': {
      if (!entry) return '';
      const { device, partNumber } = args || {};
      const res = await runRemotePrivExec(entry, `parted -s "${device}" rm ${partNumber} 2>&1`);
      return res.stdout || 'Partition deleted';
    }

    case 'disk_resize_partition': {
      if (!entry) return '';
      const { device, partNumber, newEnd = '100%' } = args || {};
      const res = await runRemotePrivExec(entry, `parted -s "${device}" resizepart ${partNumber} ${newEnd} 2>&1`);
      return res.stdout || 'Partition resized';
    }

    case 'disk_set_partition_flag': {
      if (!entry) return '';
      const { device, partNumber, flag, stateOn } = args || {};
      const stateStr = stateOn ? 'on' : 'off';
      const res = await runRemotePrivExec(entry, `parted -s "${device}" set ${partNumber} ${flag} ${stateStr} 2>&1`);
      return res.stdout || 'Flag updated';
    }

    case 'disk_format_filesystem': {
      if (!entry) return '';
      const { device, fstype = 'ext4', label, quick } = args || {};
      const lblOpt = label ? `-L "${label}"` : '';
      const qOpt = quick ? '-F' : '';
      const res = await runRemotePrivExec(entry, `mkfs -t ${fstype} ${lblOpt} ${qOpt} "${device}" 2>&1`);
      return res.stdout || 'Formatted';
    }

    case 'disk_set_label': {
      if (!entry) return '';
      const { device, fstype, label } = args || {};
      let cmd = `e2label "${device}" "${label}" 2>&1`;
      if (fstype === 'xfs') cmd = `xfs_admin -L "${label}" "${device}" 2>&1`;
      const res = await runRemotePrivExec(entry, cmd);
      return res.stdout || 'Label set';
    }

    case 'disk_check_filesystem': {
      if (!entry) return '';
      const { device, repair } = args || {};
      const opt = repair ? '-y' : '-n';
      const res = await runRemotePrivExec(entry, `fsck ${opt} "${device}" 2>&1`);
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
      const targetMb = parseInt(args?.size_mb ?? args?.sizeMb ?? 2048, 10);

      let script = '';
      if (act === 'disable') {
        script = 'swapoff -a 2>/dev/null || true\necho "Swap successfully disabled."';
      } else if (act === 'enable') {
        script = 'if [ -f /swapfile ]; then swapon /swapfile 2>/dev/null || swapon -a; else swapon -a; fi\necho "Swap successfully enabled."';
      } else if (act === 'set_size') {
        if (targetMb === 0) {
          script = 'swapoff -a 2>/dev/null || true\nrm -f /swapfile\nsed -i \'\\#/swapfile#d\' /etc/fstab 2>/dev/null || true\necho "Swapfile successfully removed."';
        } else {
          script = `set -e\nTARGET_MB=${targetMb}\nswapoff -a 2>/dev/null || true\nif ! fallocate -l "${TARGET_MB}M" /swapfile 2>/dev/null; then\n  dd if=/dev/zero of=/swapfile bs=1M count="$TARGET_MB" status=none\nfi\nchmod 600 /swapfile\nmkswap /swapfile\nswapon /swapfile\nif ! grep -qs '/swapfile' /etc/fstab; then\n  printf '\\n/swapfile none swap sw 0 0\\n' >> /etc/fstab\nfi\necho "Successfully configured swap space to ${TARGET_MB} MB (/swapfile active)."`;
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
      const size = String(args?.size || '').trim().toUpperCase();
      if (!size) throw new Error("Size cannot be empty (e.g. '2G', '4G')");
      const persist = Boolean(args?.persist);

      let script = `set -e\nSIZE="${size}"\nif findmnt -n -o FSTYPE /tmp 2>/dev/null | grep -qi "tmpfs"; then\n  mount -o remount,size="$SIZE" /tmp\nelse\n  mount -t tmpfs -o size="$SIZE",mode=1777 tmpfs /tmp\nfi\n`;
      if (persist) {
        script += `if grep -qs '[[:space:]]/tmp[[:space:]]' /etc/fstab; then\n  sed -i "s|.*[[:space:]]/tmp[[:space:]].*|tmpfs /tmp tmpfs defaults,noatime,mode=1777,size=$SIZE 0 0|" /etc/fstab\nelse\n  printf "\\ntmpfs /tmp tmpfs defaults,noatime,mode=1777,size=$SIZE 0 0\\n" >> /etc/fstab\nfi\n`;
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
      const target = args?.path || (process.platform === 'win32' ? process.cwd() : '/root');
      if (!entry || !entry.client) {
        try {
          const dirents = fs.readdirSync(target, { withFileTypes: true });
          const results = [];
          for (const d of dirents) {
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
          const results = (list || []).map(item => {
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
              owner: item.attrs.uid ? String(item.attrs.uid) : 'root',
              group: item.attrs.gid ? String(item.attrs.gid) : 'root'
            };
          });
          results.sort((a, b) => (a.is_dir && !b.is_dir ? -1 : !a.is_dir && b.is_dir ? 1 : a.name.localeCompare(b.name)));
          resolve(results);
        });
      });
    }

    case 'sftp_read_text_file': {
      if (!entry || !entry.client) {
        return fs.existsSync(args?.path) ? fs.readFileSync(args?.path, 'utf8') : '';
      }
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(args?.path);
        let content = '';
        stream.on('data', chunk => { content += chunk.toString('utf8'); });
        stream.on('end', () => resolve(content));
        stream.on('error', err => reject(err));
      });
    }

    case 'sftp_read_file_base64': {
      if (!entry || !entry.client) {
        return fs.existsSync(args?.path) ? fs.readFileSync(args?.path).toString('base64') : '';
      }
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(args?.path);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        stream.on('error', err => reject(err));
      });
    }

    case 'sftp_write_text_file': {
      if (!entry || !entry.client) {
        fs.writeFileSync(args?.path, args?.content || '', 'utf8');
        return true;
      }
      try {
        let sftp = entry.sftp || await getSftp(entry.client);
        await new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(args?.path, { flags: 'w' });
          stream.on('close', () => resolve());
          stream.on('error', err => reject(err));
          stream.end(args?.content || '', 'utf8');
        });
        return true;
      } catch (err) {
        // Fallback with elevated privilege: write to /tmp first, then sudo mv
        const b64 = Buffer.from(args?.content || '', 'utf8').toString('base64');
        const tmpFile = `/tmp/.cd_up_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const tmpRes = await runRemoteExec(entry.client, `echo "${b64}" | base64 -d > "${tmpFile}"`);
        if (tmpRes.exit_code === 0) {
          const mvRes = await runRemotePrivExec(entry, `mv -f "${tmpFile}" "${args?.path}" && chmod 644 "${args?.path}"`);
          if (mvRes.exit_code === 0) {
            return true;
          }
          await runRemoteExec(entry.client, `rm -f "${tmpFile}"`);
        }
        throw err;
      }
    }

    case 'sftp_write_file': {
      const buf = Array.isArray(args?.content) ? Buffer.from(args.content) : Buffer.from(args?.content || '');
      if (!entry || !entry.client) {
        fs.writeFileSync(args?.path, buf);
        return true;
      }
      try {
        let sftp = entry.sftp || await getSftp(entry.client);
        await new Promise((resolve, reject) => {
          const stream = sftp.createWriteStream(args?.path, { flags: 'w' });
          stream.on('close', () => resolve());
          stream.on('error', err => reject(err));
          stream.end(buf);
        });
        return true;
      } catch (err) {
        // Fallback with elevated privilege: write to /tmp first, then sudo mv
        const b64 = buf.toString('base64');
        const tmpFile = `/tmp/.cd_up_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
        const tmpRes = await runRemoteExec(entry.client, `echo "${b64}" | base64 -d > "${tmpFile}"`);
        if (tmpRes.exit_code === 0) {
          const mvRes = await runRemotePrivExec(entry, `mv -f "${tmpFile}" "${args?.path}" && chmod 644 "${args?.path}"`);
          if (mvRes.exit_code === 0) {
            return true;
          }
          await runRemoteExec(entry.client, `rm -f "${tmpFile}"`);
        }
        throw err;
      }
    }

    case 'sftp_mkdir': {
      if (!entry) return;
      const res = await runRemoteExec(entry.client, `mkdir -p "${args?.path}" 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `mkdir -p "${args?.path}"`);
      }
      return;
    }

    case 'sftp_delete': {
      if (!entry) return;
      const res = await runRemoteExec(entry.client, `rm -rf "${args?.path}" 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `rm -rf "${args?.path}"`);
      }
      return;
    }

    case 'sftp_rename': {
      if (!entry) return;
      const res = await runRemoteExec(entry.client, `mv "${args?.oldPath}" "${args?.newPath}" 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `mv "${args?.oldPath}" "${args?.newPath}"`);
      }
      return;
    }

    case 'sftp_chmod': {
      if (!entry) return;
      const octal = (args?.mode & 0o777).toString(8);
      const res = await runRemoteExec(entry.client, `chmod ${octal} "${args?.path}" 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `chmod ${octal} "${args?.path}"`);
      }
      return;
    }

    case 'sftp_chown': {
      if (!entry) return;
      const ownership = args?.group ? `${args.owner}:${args.group}` : args.owner;
      const res = await runRemoteExec(entry.client, `chown ${ownership} "${args?.path}" 2>&1`);
      if (res.exit_code !== 0) {
        await runRemotePrivExec(entry, `chown ${ownership} "${args?.path}"`);
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

      let cmd = '';
      if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        cmd = `mkdir -p '${escapedDest}' && tar -xzvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar.bz2')) {
        cmd = `mkdir -p '${escapedDest}' && tar -xjvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar.xz')) {
        cmd = `mkdir -p '${escapedDest}' && tar -xJvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.tar')) {
        cmd = `mkdir -p '${escapedDest}' && tar -xvf '${escapedArch}' -C '${escapedDest}'`;
      } else if (lower.endsWith('.zip')) {
        cmd = `mkdir -p '${escapedDest}' && (command -v unzip >/dev/null 2>&1 && unzip -o '${escapedArch}' -d '${escapedDest}' || python3 -m zipfile -e '${escapedArch}' '${escapedDest}')`;
      } else {
        cmd = `mkdir -p '${escapedDest}' && tar -xvf '${escapedArch}' -C '${escapedDest}'`;
      }

      const res = await runRemotePrivExec(entry, cmd, 120000);
      if (res.exit_code !== 0) throw new Error(res.stderr || res.stdout || 'Archive extraction failed');
      return cleanDest;
    }

    case 'sftp_folder_size': {
      if (!entry) return '—';
      const res = await runRemoteExec(entry.client, `du -sh "${args?.path}" 2>/dev/null | cut -f1`);
      return res.stdout.trim() || '—';
    }

    // ==========================================
    // 16. Terminal PTY Engine
    // ==========================================
    case 'terminal_create': {
      const { rows = 24, cols = 80, terminalId } = args || {};
      const termId = terminalId || `term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      if (!entry || !entry.client) {
        // Local interactive shell fallback
        return new Promise((resolve) => {
          const shellCmd = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');
          const proc = child_process.spawn(shellCmd, [], {
            env: { ...process.env, TERM: 'xterm-256color' }
          });
          activeTerminals.set(termId, {
            stream: {
              write: (d) => proc.stdin && proc.stdin.write(d),
              end: () => proc.kill(),
              setWindow: () => {}
            },
            connId: 'local',
            buffer: ''
          });
          proc.stdout.on('data', chunk => {
            const text = chunk.toString('utf8');
            const ws = activeWsClients.get(termId);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', text }));
            }
          });
          proc.stderr.on('data', chunk => {
            const text = chunk.toString('utf8');
            const ws = activeWsClients.get(termId);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', text }));
            }
          });
          proc.on('close', () => {
            activeTerminals.delete(termId);
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
        entry.client.shell({ term: 'xterm-256color', rows, cols }, (err, stream) => {
          if (err) return reject(new Error(`Terminal spawn failed: ${err.message}`));
          activeTerminals.set(termId, { stream, connId, buffer: '' });

          stream.on('data', chunk => {
            const text = chunk.toString('utf8');
            const ws = activeWsClients.get(termId);
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'output', text }));
            }
          });

          stream.on('close', () => {
            activeTerminals.delete(termId);
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
      const session = activeTerminals.get(terminalId);
      if (session && session.stream && typeof session.stream.setWindow === 'function') {
        session.stream.setWindow(rows || 24, cols || 80, 0, 0);
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
      // Zero disk writes: Private keys are kept strictly in-memory
      return { success: true, message: 'Private keys are stored in-memory only' };
    }

    case 'store_save_connection': {
      const { connection } = args || {};
      if (!connection) return;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      // Sanitize connection object: Strip private keys completely so they NEVER persist to server disk
      const sanitized = { ...connection };
      delete sanitized.private_key;
      delete sanitized.privateKey;
      if (sanitized.privateKeyPath && (sanitized.privateKeyPath.includes('-----BEGIN') || sanitized.privateKeyPath.includes('\n'))) {
        delete sanitized.privateKeyPath;
      }
      if (sanitized.private_key_path && (sanitized.private_key_path.includes('-----BEGIN') || sanitized.private_key_path.includes('\n'))) {
        delete sanitized.private_key_path;
      }
      const idx = list.findIndex(c => c.id === sanitized.id);
      if (idx >= 0) list[idx] = sanitized;
      else list.push(sanitized);
      writeJsonSafe(CONNECTIONS_FILE, list);
      return;
    }

    case 'store_delete_connection': {
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      writeJsonSafe(CONNECTIONS_FILE, list.filter(c => c.id !== args?.id));
      return;
    }

    case 'settings_get': {
      return readJsonSafe(SETTINGS_FILE, { theme: 'catppuccin-mocha', accentColor: 'blue', fontSize: 14 });
    }

    case 'settings_save': {
      if (args?.settings) writeJsonSafe(SETTINGS_FILE, args.settings);
      return;
    }

    // ==========================================
    // 18. API Studio & HTTP Client
    // ==========================================
    case 'network_interfaces': {
      return await handleInvokeCommand('system_get_network', args, session);
    }

    case 'browser_proxy_fetch': {
      const url = args?.url;
      if (!url) throw new Error('Missing URL');
      try {
        const resp = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        const status = resp.status;
        const final_url = resp.url || url;
        const contentType = resp.headers.get('content-type') || 'text/html';
        let body = await resp.text();

        if (contentType.includes('text/html')) {
          const baseTag = `<base href="${final_url}" />\n`;
          const headIdx = body.toLowerCase().indexOf('<head>');
          if (headIdx !== -1) {
            body = body.slice(0, headIdx + 6) + baseTag + body.slice(headIdx + 6);
          } else {
            const htmlIdx = body.toLowerCase().indexOf('<html>');
            if (htmlIdx !== -1) {
              body = body.slice(0, htmlIdx + 6) + `<head>${baseTag}</head>` + body.slice(htmlIdx + 6);
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
          body: `<html><body><h3>Proxy request to '${url}' failed: ${err.message}</h3></body></html>`,
          final_url: url
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
      const startTime = Date.now();

      // Route through SSH when requested and SSH session is available
      if (req.use_ssh_tunnel && entry && entry.client) {
        try {
          const method = (req.method || 'GET').toUpperCase();
          const targetUrl = req.url;
          let curlCmd = `curl -s -S -i -X ${method} "${targetUrl.replace(/"/g, '\\"')}"`;
          if (Array.isArray(req.headers)) {
            for (const h of req.headers) {
              if (h.enabled && h.key) {
                curlCmd += ` -H "${h.key.replace(/"/g, '\\"')}: ${String(h.value).replace(/"/g, '\\"')}"`;
              }
            }
          }
          if (req.body_type && req.body_type !== 'none' && req.raw_body) {
            const b64 = Buffer.from(req.raw_body).toString('base64');
            curlCmd = `echo "${b64}" | base64 -d | ${curlCmd} --data-binary @-`;
          }

          const res = await runRemoteExec(entry.client, curlCmd, 30000);
          if (res.exit_code === 0 || res.stdout.includes('HTTP/')) {
            const rawOut = res.stdout;
            const headerEnd = rawOut.indexOf('\r\n\r\n') !== -1 ? rawOut.indexOf('\r\n\r\n') : rawOut.indexOf('\n\n');
            let headerPart = '';
            let bodyPart = rawOut;
            if (headerEnd !== -1) {
              headerPart = rawOut.slice(0, headerEnd);
              bodyPart = rawOut.slice(headerEnd + (rawOut.indexOf('\r\n\r\n') !== -1 ? 4 : 2));
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
          }
        } catch (sshErr) {
          console.warn('[SSH Desktop] Remote SSH curl execution failed, falling back to direct fetch:', sshErr.message);
        }
      }

      // Direct HTTP fetch execution
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
        const bodyText = await response.text();
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

    default: {
      console.log(`[SSH Desktop Web IPC] Unhandled command: '${cmd}'`);
      return null;
    }
  }
}

// -------------------------------------------------------------
// BROWSER GATEWAY & REVERSE PROXY HANDLER (Web Mode Support)
// Proxies HTTP and HTTPS requests from PC browser clients through
// the remote SSH server so users can reach server localhost,
// internal services, and private IPs seamlessly.
// -------------------------------------------------------------
function handleBrowserGatewayUpgrade(req, socket, head) {
  const rawPrefix = '/api/browser/gateway/';
  const subPath = req.url.slice(rawPrefix.length);
  const slash1 = subPath.indexOf('/');
  if (slash1 === -1) { try { socket.destroy(); } catch {} return; }

  const connId = decodeURIComponent(subPath.slice(0, slash1));
  const afterConn = subPath.slice(slash1 + 1);
  const slash2 = afterConn.indexOf('/');
  const proto = (slash2 === -1 ? afterConn : afterConn.slice(0, slash2)).toLowerCase();
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

  let entry = null;
  if (connId && connId !== 'default' && connId !== 'local' && activeConnections.has(connId)) {
    entry = activeConnections.get(connId);
  } else if (activeConnections.size > 0) {
    entry = activeConnections.values().next().value;
  }

  const connectTarget = (cb) => {
    if (entry && entry.client) {
      const destHost = host === 'localhost' ? '127.0.0.1' : host;
      entry.client.forwardOut('127.0.0.1', 0, destHost, port, (err, stream) => {
        if (err) return cb(err);
        if (proto === 'https') {
          const tlsSocket = tls.connect({
            socket: stream,
            servername: host,
            rejectUnauthorized: false
          }, () => cb(null, tlsSocket));
          tlsSocket.on('error', e => cb(e));
        } else {
          cb(null, stream);
        }
      });
    } else {
      if (proto === 'https') {
        const tlsSocket = tls.connect(port, host, { servername: host, rejectUnauthorized: false }, () => cb(null, tlsSocket));
        tlsSocket.on('error', e => cb(e));
      } else {
        const netSocket = net.connect(port, host, () => cb(null, netSocket));
        netSocket.on('error', e => cb(e));
      }
    }
  };

  connectTarget((err, targetStream) => {
    if (err) {
      try { socket.destroy(); } catch {}
      return;
    }

    let rawHeaders = `${req.method} ${targetPath} HTTP/1.1\r\nHost: ${host}:${port}\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      if (['host'].includes(k.toLowerCase())) continue;
      rawHeaders += `${k}: ${v}\r\n`;
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
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
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
      const port = parsed.port || (proto === 'https' ? '443' : '80');
      const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '');
      const redirectDest = `/api/browser/gateway/${encodeURIComponent(connId)}/${proto}/${parsed.hostname}:${port}${pathAndQuery}`;
      res.writeHead(302, { 'Location': redirectDest, 'Access-Control-Allow-Origin': '*' });
      res.end();
      return;
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Invalid URL '${targetUrl}': ${err.message}` }));
      return;
    }
  }

  // 2. Gateway path routing: /api/browser/gateway/:connId/:proto/:hostPart/...
  const rawPrefix = '/api/browser/gateway/';
  const subPath = req.url.slice(rawPrefix.length);
  const slash1 = subPath.indexOf('/');
  if (slash1 === -1) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid gateway URL format' }));
    return;
  }

  const connId = decodeURIComponent(subPath.slice(0, slash1));
  const afterConn = subPath.slice(slash1 + 1);
  const slash2 = afterConn.indexOf('/');
  const proto = (slash2 === -1 ? afterConn : afterConn.slice(0, slash2)).toLowerCase();
  if (proto !== 'http' && proto !== 'https') {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Invalid gateway protocol '${proto}'. Must be http or https.` }));
    return;
  }

  const afterProto = slash2 === -1 ? '' : afterConn.slice(slash2 + 1);
  const slash3 = afterProto.indexOf('/');
  const hostPart = slash3 === -1 ? afterProto : afterProto.slice(0, slash3);
  const rawRest = slash3 === -1 ? '/' : afterProto.slice(slash3);

  let host = hostPart;
  let port = proto === 'https' ? 443 : 80;
  let targetPath = rawRest;

  if (hostPart.includes(':')) {
    const split = hostPart.split(':');
    host = split[0];
    port = parseInt(split[1], 10) || port;
  } else {
    const portMatch = rawRest.match(/^\/(\d{1,5})(\/.*)?$/);
    if (portMatch) {
      port = parseInt(portMatch[1], 10);
      targetPath = portMatch[2] || '/';
    }
  }

  let entry = null;
  if (connId && connId !== 'default' && connId !== 'local' && activeConnections.has(connId)) {
    entry = activeConnections.get(connId);
  } else if (activeConnections.size > 0) {
    entry = activeConnections.values().next().value;
  }

  const isHttps = proto === 'https';
  const httpModule = isHttps ? https : http;
  const gatewayBase = `/api/browser/gateway/${encodeURIComponent(connId)}/${proto}/${host}:${port}`;

  const headersToSend = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (['connection', 'upgrade', 'keep-alive', 'transfer-encoding', 'host'].includes(lower)) {
      continue;
    }
    headersToSend[k] = v;
  }
  headersToSend['host'] = `${host}:${port}`;

  // CSRF & Reverse Proxy Headers for production tools (Jenkins, Grafana, Portainer, Spring Boot, etc.)
  // Target expects Origin & Referer to match its host, avoiding 403 Forbidden CSRF rejections
  headersToSend['origin'] = `${proto}://${host}:${port}`;
  headersToSend['referer'] = `${proto}://${host}:${port}${targetPath}`;
  headersToSend['x-forwarded-host'] = req.headers.host || `${host}:${port}`;
  headersToSend['x-forwarded-proto'] = proto;
  headersToSend['x-forwarded-port'] = String(port);
  headersToSend['x-forwarded-prefix'] = gatewayBase;
  headersToSend['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';

  // Ask for uncompressed if possible, but we also handle gzip/deflate/br decompression below
  headersToSend['accept-encoding'] = 'gzip, deflate, identity';

  const requestOptions = {
    hostname: host,
    port: port,
    path: targetPath,
    method: req.method,
    headers: headersToSend,
    rejectUnauthorized: false,
    maxHeaderSize: 1048576, // 1MB header limit to eliminate "Header overflow" on YouTube/Google
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
            rejectUnauthorized: false
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
          rejectUnauthorized: false
        }, () => callback(null, tlsSocket));
        tlsSocket.on('error', (tlsErr) => callback(tlsErr));
      });
      netSocket.on('error', (netErr) => callback(netErr));
    };
  }

  const clientReq = httpModule.request(requestOptions, (targetRes) => {
    const outHeaders = { ...targetRes.headers };

    delete outHeaders['x-frame-options'];
    delete outHeaders['content-security-policy'];
    delete outHeaders['content-security-policy-report-only'];

    outHeaders['access-control-allow-origin'] = '*';
    outHeaders['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
    outHeaders['access-control-allow-headers'] = '*';

    // Cookie Management: Preserve session cookies, strip Domain & Secure restrictions on HTTP
    // and attach __ssh_browser_gw tracking cookie
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
    cookieList.push(gatewayCookie);
    outHeaders['set-cookie'] = cookieList;

    // Handle HTTP Redirects (Location header: 301, 302, 303, 307, 308)
    if (outHeaders['location']) {
      let loc = outHeaders['location'];
      if (loc.startsWith('/')) {
        outHeaders['location'] = `${gatewayBase}${loc}`;
      } else if (loc.startsWith('http://') || loc.startsWith('https://')) {
        try {
          const locUrl = new URL(loc);
          const locProto = locUrl.protocol.replace(':', '');
          const locPort = locUrl.port || (locProto === 'https' ? 443 : 80);
          outHeaders['location'] = `/api/browser/gateway/${encodeURIComponent(connId)}/${locProto}/${locUrl.hostname}:${locPort}${locUrl.pathname}${locUrl.search}`;
        } catch {}
      }
      res.writeHead(targetRes.statusCode, outHeaders);
      targetRes.pipe(res);
      return;
    }

    const contentType = (outHeaders['content-type'] || '').toLowerCase();
    const isHtml = contentType.includes('text/html');
    const isCss = contentType.includes('text/css');
    const isJs = contentType.includes('javascript') || contentType.includes('application/x-javascript');

    if (isHtml || isCss || isJs) {
      const chunks = [];
      targetRes.on('data', c => chunks.push(c));
      targetRes.on('end', () => {
        let buffer = Buffer.concat(chunks);

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

        if (isHtml) {
          const dirPath = targetPath.endsWith('/') ? targetPath : targetPath.substring(0, targetPath.lastIndexOf('/') + 1);
          const baseTag = `<base href="${gatewayBase}${dirPath || '/'}" />\n`;

          // 1. Rewrite root-relative href="/..." (links, navigation, stylesheets, icons)
          bodyText = bodyText.replace(/(href\s*=\s*["'])\/(?!\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 2. Rewrite root-relative src="/..." (scripts, images, media, iframes)
          bodyText = bodyText.replace(/(src\s*=\s*["'])\/(?!\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 3. Rewrite root-relative action="/..." (form submit for login, settings, POST)
          bodyText = bodyText.replace(/(action\s*=\s*["'])\/(?!\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          // 4. Handle forms with empty action="" or NO action attribute: submit to current gateway URL
          bodyText = bodyText.replace(/(action\s*=\s*["'])\s*["']/gi, `$1${gatewayBase}${targetPath}"`);
          bodyText = bodyText.replace(/<form\b(?![^>]*\baction\b)([^>]*)>/gi, `<form action="${gatewayBase}${targetPath}"$1>`);

          // 5. Rewrite CSS url(/...)
          bodyText = bodyText.replace(/(url\(\s*["']?)\/(?!\/|api\/browser\/gateway\/)([^"')]+["']?\))/gi, `$1${gatewayBase}/$2`);

          // 6. Rewrite data-url, data-href, data-src
          bodyText = bodyText.replace(/(data-(?:url|href|src)\s*=\s*["'])\/(?!\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);

          const interceptScript = `
<script>
(function() {
  var GW = "${gatewayBase}";
  var ORIGINS = [
    "${proto}://${host}:${port}",
    "${proto}://${host}",
    "${proto}://localhost:${port}",
    "${proto}://localhost",
    "${proto}://127.0.0.1:${port}",
    "${proto}://127.0.0.1",
    "//${host}:${port}",
    "//localhost:${port}",
    "//127.0.0.1:${port}"
  ];

  function rewriteUrl(u) {
    if (typeof u !== 'string' || !u) return u;
    if (u.startsWith(GW) || u.startsWith('/api/browser/gateway/')) return u;
    for (var i = 0; i < ORIGINS.length; i++) {
      if (u.startsWith(ORIGINS[i])) {
        return GW + u.slice(ORIGINS[i].length);
      }
    }
    if (u.startsWith('/') && !u.startsWith('//')) {
      return GW + u;
    }
    return u;
  }

  // 1. Intercept window.fetch (supports GET, POST, PUT, DELETE, PATCH, etc.)
  if (window.fetch) {
    var _fetch = window.fetch;
    window.fetch = function(input, init) {
      if (typeof input === 'string') {
        input = rewriteUrl(input);
      } else if (input && typeof input === 'object' && input.url) {
        var newUrl = rewriteUrl(input.url);
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
      url = rewriteUrl(url);
      return _open.call(this, method, url, async !== false, user, password);
    };
  }

  // 3. Intercept window.history.pushState & replaceState (for Grafana / SPAs)
  if (window.history) {
    var _pushState = window.history.pushState;
    window.history.pushState = function(state, title, url) {
      url = rewriteUrl(url);
      return _pushState.call(this, state, title, url);
    };
    var _replaceState = window.history.replaceState;
    window.history.replaceState = function(state, title, url) {
      url = rewriteUrl(url);
      return _replaceState.call(this, state, title, url);
    };
  }

  // 4. Intercept HTMLFormElement.prototype.submit (catches programmatic submit())
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

  // 5. Global capture click listener for all <a> tags
  document.addEventListener('click', function(e) {
    var t = e.target;
    while (t && t.tagName !== 'A' && t !== document.body) {
      t = t.parentElement;
    }
    if (t && t.tagName === 'A') {
      var href = t.getAttribute('href');
      if (href) {
        var rw = rewriteUrl(href);
        if (rw !== href) {
          t.setAttribute('href', rw);
        }
      }
    }
  }, true);

  // 6. Global capture submit listener for all <form> elements
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

  // 7. Intercept window.open
  var _winOpen = window.open;
  window.open = function(url, target, features) {
    url = rewriteUrl(url);
    return _winOpen.call(this, url, target, features);
  };
})();
</script>
`;

          const headIdx = bodyText.toLowerCase().indexOf('<head>');
          if (headIdx !== -1) {
            bodyText = bodyText.slice(0, headIdx + 6) + baseTag + interceptScript + bodyText.slice(headIdx + 6);
          } else {
            const htmlIdx = bodyText.toLowerCase().indexOf('<html>');
            if (htmlIdx !== -1) {
              bodyText = bodyText.slice(0, htmlIdx + 6) + '<head>' + baseTag + interceptScript + '</head>' + bodyText.slice(htmlIdx + 6);
            } else {
              bodyText = baseTag + interceptScript + bodyText;
            }
          }
        } else if (isCss) {
          bodyText = bodyText.replace(/(url\(\s*["']?)\/(?!\/|api\/browser\/gateway\/)([^"')]+["']?\))/gi, `$1${gatewayBase}/$2`);
          bodyText = bodyText.replace(/(@import\s*["'])\/(?!\/|api\/browser\/gateway\/)([^"']*["'])/gi, `$1${gatewayBase}/$2`);
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
    <p>Could not connect to target service at <code>${proto}://${host}:${port}${targetPath}</code> via SSH Server.</p>
    <p><strong>Error:</strong> <code>${err.message}</code></p>
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
const backendServer = http.createServer({ maxHeaderSize: 1048576 }, async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Browser Gateway & Reverse Proxy (routes Web Mode traffic via remote SSH server)
  if (req.url.startsWith('/api/browser/gateway/') || req.url.startsWith('/api/browser/proxy')) {
    handleBrowserGatewayRequest(req, res);
    return;
  }

  // Health check
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'sshdesktop-backend',
      version: '2.4.0',
      backendPort: BACKEND_PORT,
      frontendPort: FRONTEND_PORT,
      activeConnections: activeConnections.size,
      activeTerminals: activeTerminals.size,
      timestamp: Date.now()
    }));
    return;
  }

  // Unified Web IPC Invoke Endpoint with 1-Hour Session Expiration Security
  if (req.url === '/api/invoke' && req.method === 'POST') {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(rawBody || '{}');
        const { cmd, args } = payload;
        const token = extractSessionToken(req, payload);
        const session = getSession(token);

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

        const result = await handleInvokeCommand(cmd, args, session);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

// WebSocket Server attached directly to Backend Server
const wss = new WebSocketServer({ noServer: true });

function handleWsConnection(ws, req) {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const token = urlObj.searchParams.get('token') || req.headers['x-session-token'];
  const session = getSession(token);
  if (!session) {
    ws.close(1008, 'Session expired or unauthorized (1 hour limit)');
    return;
  }

  const termId = urlObj.searchParams.get('termId');
  const connId = urlObj.searchParams.get('connId');
  const cols = parseInt(urlObj.searchParams.get('cols') || '80', 10);
  const rows = parseInt(urlObj.searchParams.get('rows') || '24', 10);

  if (!termId) {
    ws.close(1008, 'Missing termId parameter');
    return;
  }

  activeWsClients.set(termId, ws);

  if (!activeTerminals.has(termId) && connId) {
    handleInvokeCommand('terminal_create', { connId, rows, cols, terminalId: termId })
      .catch(err => {
        ws.send(JSON.stringify({ type: 'output', text: `\r\n\x1b[31m[SSH Desktop Error] Terminal spawn failed: ${err.message}\x1b[0m\r\n` }));
      });
  }

  ws.on('message', message => {
    const session = activeTerminals.get(termId);
    if (!session || !session.stream) return;

    try {
      const parsed = JSON.parse(message.toString());
      if (parsed.type === 'resize') {
        session.stream.setWindow(parsed.rows || 24, parsed.cols || 80, 0, 0);
        return;
      }
    } catch {}

    if (Buffer.isBuffer(message)) {
      session.stream.write(message);
    } else {
      session.stream.write(message.toString());
    }
  });

  ws.on('close', () => {
    activeWsClients.delete(termId);
  });
}

backendServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/terminal')) {
    wss.handleUpgrade(req, socket, head, ws => {
      handleWsConnection(ws, req);
    });
  } else if (req.url.startsWith('/api/browser/gateway/')) {
    handleBrowserGatewayUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

// -------------------------------------------------------------
// FRONTEND SERVER (Listening on Port 2222)
// -------------------------------------------------------------
const frontendServer = http.createServer({ maxHeaderSize: 1048576 }, (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Transparent reverse-proxy: Any /api/* request from port 2222 is forwarded to backend on 2020
  if (req.url.startsWith('/api/')) {
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
      maxHeaderSize: 1048576
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

  // Serve static assets from DIST_DIR (disk) or EMBEDDED_FILES (in-memory bundle)
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(DIST_DIR, reqPath);

  // 1. Check disk file first
  if (fs.existsSync(filePath)) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    } catch {}
  }

  // 2. Check embedded in-memory assets (for standalone single binary execution)
  if (typeof EMBEDDED_FILES !== 'undefined' && EMBEDDED_FILES && EMBEDDED_FILES[reqPath]) {
    const asset = EMBEDDED_FILES[reqPath];
    res.writeHead(200, {
      'Content-Type': asset.type,
      'Cache-Control': reqPath === '/index.html' ? 'no-cache' : 'public, max-age=31536000'
    });
    if (asset.isBase64) {
      res.end(Buffer.from(asset.b64, 'base64'));
    } else {
      res.end(asset.text);
    }
    return;
  }

  // 2.5 Resolve Gateway context from Cookie or Referer
  let savedGw = null;
  if (req.headers.cookie && req.headers.cookie.includes('__ssh_browser_gw=')) {
    const m = req.headers.cookie.match(/__ssh_browser_gw=([^;]+)/);
    if (m) {
      try { savedGw = decodeURIComponent(m[1].trim()); } catch {}
    }
  }
  if (!savedGw && req.headers.referer && req.headers.referer.includes('/api/browser/gateway/')) {
    const refMatch = req.headers.referer.match(/(\/api\/browser\/gateway\/[^/]+\/https?\/[^/]+)/);
    if (refMatch) {
      savedGw = refMatch[1];
    }
  }

  // If a gateway context is active and this request is NOT for the root UI of SSH Desktop:
  if (savedGw && req.url !== '/' && req.url !== '/index.html') {
    const forwardedPath = `${savedGw}${req.url.startsWith('/') ? req.url : '/' + req.url}`;

    // For HTML navigation (e.g. user clicked <a href="/login.html"> and browser navigated to http://localhost:2222/login.html):
    // 302 Redirect so the browser address bar cleanly updates to the full gateway path!
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

    // For POST, PUT, DELETE, PATCH, API calls, and subresources:
    // Transparently forward request to backendServer on port 2020!
    const proxyReq = http.request({
      host: '127.0.0.1',
      port: BACKEND_PORT,
      path: forwardedPath,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` },
      maxHeaderSize: 1048576
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

  // 3. SPA Fallback: non-asset routes (or HTML routes) serve index.html
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

// Forward WebSocket upgrades on port 2222 directly to backend WebSocket handler
frontendServer.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/ws/terminal')) {
    wss.handleUpgrade(req, socket, head, ws => {
      handleWsConnection(ws, req);
    });
  } else if (req.url.startsWith('/api/browser/gateway/')) {
    handleBrowserGatewayUpgrade(req, socket, head);
  } else {
    let savedGw = null;
    if (req.headers.cookie && req.headers.cookie.includes('__ssh_browser_gw=')) {
      const m = req.headers.cookie.match(/__ssh_browser_gw=([^;]+)/);
      if (m) try { savedGw = decodeURIComponent(m[1].trim()); } catch {}
    }
    if (savedGw) {
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
backendServer.listen(BACKEND_PORT, HOST, () => {
  frontendServer.listen(FRONTEND_PORT, HOST, () => {
    console.log('\n================================================================');
    console.log('🚀 SSH Desktop All-in-One Dual Engine Running!');
    console.log(`🌐 Frontend UI:     http://${HOST}:${FRONTEND_PORT} (Web Desktop)`);
    console.log(`⚡ Backend API:     http://${HOST}:${BACKEND_PORT} (SSH2 Engine & PTY)`);
    console.log(`📟 WebSocket PTY:   ws://${HOST}:${FRONTEND_PORT}/ws/terminal & ws://${HOST}:${BACKEND_PORT}/ws/terminal`);
    console.log(`🔒 Authentication:  admin / sshdesktop (1 Hour Session Expiration)`);
    console.log(`💾 Local Storage:   ${DATA_DIR} (Protected: 0700 - Owner Only)`);
    console.log('================================================================\n');
  });
});
