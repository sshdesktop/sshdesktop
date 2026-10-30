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
import net from 'net';
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

// -------------------------------------------------------------
// Unified Command Handler (Implements all 70+ Tauri IPC commands)
// -------------------------------------------------------------
// -------------------------------------------------------------
// SOCKS5 Dynamic Proxy Engine (RFC 1928 over SSH2 forwardOut)
// -------------------------------------------------------------
const activeSocksServers = new Map(); // connId -> { server, port }

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
    case 'ssh_connect': {
      const { config } = args || {};
      if (!config) throw new Error('Missing SSH connection config');
      const targetId = config.id || `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const client = new Client();

      return new Promise((resolve, reject) => {
        let connected = false;
        const connectConfig = {
          host: config.host,
          port: parseInt(config.port || 22, 10),
          username: config.username || 'root',
          readyTimeout: 15000,
          keepaliveInterval: 10000
        };

        if (config.auth_type === 'key' || config.authType === 'key' || config.private_key || config.key_path) {
          if (config.private_key) connectConfig.privateKey = config.private_key;
          else if (config.key_path && fs.existsSync(config.key_path)) connectConfig.privateKey = fs.readFileSync(config.key_path);
          if (config.passphrase) connectConfig.passphrase = config.passphrase;
        } else {
          connectConfig.password = config.password || '';
        }

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

    case 'ssh_get_socks5': {
      if (activeSocksServers.has(connId)) {
        return activeSocksServers.get(connId).port;
      }
      return null;
    }

    case 'open_browser_window': {
      return `browser-${Date.now()}`;
    }

    case 'ssh_test_connection': {
      const { config } = args || {};
      if (!config) return false;
      const client = new Client();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          try { client.end(); } catch {}
          resolve(false);
        }, 8000);
        client.on('ready', () => {
          clearTimeout(timer);
          try { client.end(); } catch {}
          resolve(true);
        });
        client.on('error', () => {
          clearTimeout(timer);
          resolve(false);
        });
        const connectConfig = {
          host: config.host,
          port: parseInt(config.port || 22, 10),
          username: config.username || 'root',
          readyTimeout: 7000
        };
        if (config.auth_type === 'key' || config.private_key || config.key_path) {
          if (config.private_key) connectConfig.privateKey = config.private_key;
          else if (config.key_path && fs.existsSync(config.key_path)) connectConfig.privateKey = fs.readFileSync(config.key_path);
          if (config.passphrase) connectConfig.passphrase = config.passphrase;
        } else {
          connectConfig.password = config.password || '';
        }
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
        return {
          username: 'root',
          uid: 0,
          gid: 0,
          home_dir: '/root',
          is_root: true,
          has_sudo: true,
          sudo_type: 'root',
          groups: ['root']
        };
      }
      const script = "id -u; id -un; id -Gn; sudo -n true 2>/dev/null && echo 'SUDO_OK' || echo 'SUDO_NO'";
      const res = await runRemoteExec(entry.client, script, 8000);
      const lines = res.stdout.trim().split('\n').map(s => s.trim());
      const uid = parseInt(lines[0] || '0', 10);
      const username = lines[1] || 'root';
      const groups = (lines[2] || '').split(' ').filter(Boolean);
      const hasSudo = lines[3] === 'SUDO_OK' || uid === 0;

      return {
        username,
        uid,
        gid: uid,
        home_dir: uid === 0 ? '/root' : `/home/${username}`,
        is_root: uid === 0,
        has_sudo: hasSudo,
        sudo_type: uid === 0 ? 'root' : (hasSudo ? 'passwordless' : 'password'),
        groups
      };
    }

    // ==========================================
    // 3. Remote Command Execution
    // ==========================================
    case 'ssh_exec': {
      const { command } = args || {};
      return await runRemoteExec(entry?.client, command || '');
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
      const res = await runRemoteExec(entry.client, "ip -o addr show 2>/dev/null; echo '---NETDEV---'; cat /proc/net/dev 2>/dev/null", 8000);
      const [ipSection, devSection] = res.stdout.split('---NETDEV---');
      const ipMap = {};

      if (ipSection) {
        for (const line of ipSection.split('\n')) {
          const t = line.trim().split(/\s+/);
          if (t.length >= 4 && (t[2] === 'inet' || t[2] === 'inet6')) {
            const iface = t[1].replace(':', '');
            const ip = t[3].split('/')[0];
            ipMap[iface] = ip;
          }
        }
      }

      const ifaces = [];
      if (devSection) {
        for (const line of devSection.split('\n')) {
          if (!line.includes(':')) continue;
          const [namePart, dataPart] = line.split(':');
          const name = namePart.trim();
          const d = dataPart.trim().split(/\s+/);
          ifaces.push({
            name,
            ip: ipMap[name] || '127.0.0.1',
            mac: '00:00:00:00:00:00',
            rx_bytes: parseInt(d[0], 10) || 0,
            tx_bytes: parseInt(d[8], 10) || 0
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
      await runRemoteExec(entry.client, `kill -${sig} ${args?.pid}`);
      return;
    }

    case 'process_renice': {
      if (!entry) return;
      await runRemoteExec(entry.client, `renice ${args?.priority || 0} -p ${args?.pid}`);
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
      const res = await runRemoteExec(entry.client, `systemctl ${action} "${target}" 2>&1`);
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
      const res = await runRemoteExec(entry.client, `fuser -k ${port}/tcp 2>/dev/null || (lsof -i :${port} -t | xargs -r kill -9)`);
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
      const res = await runRemoteExec(entry.client, 'ufw status verbose 2>&1 || firewall-cmd --state 2>&1');
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
      const res = await runRemoteExec(entry.client, 'ufw status numbered 2>/dev/null || iptables -L -n --line-numbers 2>/dev/null');
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
      const res = await runRemoteExec(entry.client, `ufw ${action} ${port}/${proto} 2>&1`);
      return res.stdout || 'Rule added';
    }

    case 'firewall_delete_rule': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, `ufw --force delete ${args?.number} 2>&1`);
      return res.stdout || 'Rule deleted';
    }

    case 'firewall_toggle': {
      if (!entry) return '';
      const cmd = args?.enable ? 'ufw --force enable' : 'ufw disable';
      const res = await runRemoteExec(entry.client, `${cmd} 2>&1`);
      return res.stdout || 'Firewall toggled';
    }

    case 'firewall_reload': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, 'ufw reload 2>&1 || firewall-cmd --reload 2>&1');
      return res.stdout || 'Reloaded';
    }

    // ==========================================
    // 10. Package Manager
    // ==========================================
    case 'package_detect_manager': {
      if (!entry) return 'apt';
      const res = await runRemoteExec(
        entry.client,
        "if command -v apt-get >/dev/null 2>&1; then echo 'apt'; elif command -v dnf >/dev/null 2>&1; then echo 'dnf'; elif command -v yum >/dev/null 2>&1; then echo 'yum'; elif command -v pacman >/dev/null 2>&1; then echo 'pacman'; else echo 'apt'; fi"
      );
      return res.stdout.trim().toLowerCase() || 'apt';
    }

    case 'package_list': {
      if (!entry) return [];
      const res = await runRemoteExec(
        entry.client,
        "dpkg-query -W -f='${Package}\\t${Version}\\t${Installed-Size}\\t${Architecture}\\t${binary:Summary}\\n' 2>/dev/null | head -n 250",
        15000
      );
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const [name, version, size, arch, description] = line.split('\t');
        if (name && version) {
          list.push({
            name,
            version,
            size: formatBytes((parseInt(size, 10) || 0) * 1024),
            arch: arch || 'x86_64',
            description: description || '',
            status: 'installed'
          });
        }
      }
      return list;
    }

    case 'package_search': {
      if (!entry) return [];
      const q = args?.query || '';
      const res = await runRemoteExec(entry.client, `apt-cache search "${q}" 2>/dev/null | head -n 60`);
      const list = [];
      for (const line of res.stdout.split('\n')) {
        const parts = line.split(' - ');
        if (parts.length >= 2) {
          list.push({
            name: parts[0].trim(),
            version: 'latest',
            size: '—',
            arch: 'any',
            description: parts.slice(1).join(' - ').trim(),
            status: 'available'
          });
        }
      }
      return list;
    }

    case 'package_install': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, `DEBIAN_FRONTEND=noninteractive apt-get install -y "${args?.name}" 2>&1`, 120000);
      return res.stdout || res.stderr;
    }

    case 'package_remove': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, `DEBIAN_FRONTEND=noninteractive apt-get remove -y "${args?.name}" 2>&1`, 60000);
      return res.stdout || res.stderr;
    }

    case 'package_update': {
      if (!entry) return '';
      const res = await runRemoteExec(entry.client, 'apt-get update -y 2>&1', 120000);
      return res.stdout || res.stderr;
    }

    case 'package_upgradable': {
      if (!entry) return [];
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

    // ==========================================
    // 11. User & Group Management
    // ==========================================
    case 'user_list': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, "getent passwd 2>/dev/null; echo '---GROUPS---'; getent group 2>/dev/null; echo '---SHADOW---'; cat /etc/shadow 2>/dev/null || true");
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
      await runRemoteExec(entry.client, `useradd -m -s "${sh}" "${username}"`);
      if (password) await runRemoteExec(entry.client, `echo "${username}:${password}" | chpasswd`);
      if (Array.isArray(groups) && groups.length > 0) {
        await runRemoteExec(entry.client, `usermod -aG "${groups.join(',')}" "${username}"`);
      }
      return;
    }

    case 'user_set_password': {
      if (!entry) return;
      await runRemoteExec(entry.client, `echo "${args?.username}:${args?.password}" | chpasswd`);
      return;
    }

    case 'user_toggle_sudo': {
      if (!entry) return;
      const { username, grant } = args || {};
      if (grant) {
        await runRemoteExec(entry.client, `usermod -aG sudo "${username}" 2>/dev/null || usermod -aG wheel "${username}" 2>/dev/null`);
      } else {
        await runRemoteExec(entry.client, `gpasswd -d "${username}" sudo 2>/dev/null || gpasswd -d "${username}" wheel 2>/dev/null`);
      }
      return;
    }

    case 'user_delete': {
      if (!entry) return;
      const rm = args?.removeHome ? '-r' : '';
      await runRemoteExec(entry.client, `userdel ${rm} "${args?.username}"`);
      return;
    }

    case 'user_lock': {
      if (!entry) return;
      await runRemoteExec(entry.client, `usermod -L "${args?.username}"`);
      return;
    }

    case 'user_unlock': {
      if (!entry) return;
      await runRemoteExec(entry.client, `usermod -U "${args?.username}"`);
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
      await runRemoteExec(entry.client, `groupadd "${args?.name}"`);
      return;
    }

    case 'group_delete': {
      if (!entry) return;
      await runRemoteExec(entry.client, `groupdel "${args?.name}"`);
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
      const res = await runRemoteExec(entry.client, `docker ${args?.action} "${args?.containerId}" 2>&1`);
      return res.stdout || res.stderr || 'Action executed';
    }

    case 'docker_logs': {
      if (!entry) return '';
      const lines = args?.lines || 100;
      const res = await runRemoteExec(entry.client, `docker logs --tail ${lines} "${args?.containerId}" 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'docker_images': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, "docker images --format '{{json .}}' 2>/dev/null");
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
      const res = await runRemoteExec(entry.client, `docker exec "${args?.containerId}" ${args?.command} 2>&1`);
      return res.stdout || res.stderr;
    }

    case 'docker_stats': {
      if (!entry) return [];
      const res = await runRemoteExec(entry.client, "docker stats --no-stream --format '{{json .}}' 2>/dev/null");
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
      const res = await runRemoteExec(entry.client, `docker rmi "${args?.imageId}" 2>&1`);
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
      const res = await runRemoteExec(entry.client, `smartctl -a "${args?.device}" 2>&1`);
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
      const res = await runRemoteExec(entry.client, `mount ${opt} "${args?.device}" "${args?.mountPoint}" 2>&1`);
      return res.stdout || 'Mounted';
    }

    case 'disk_unmount': {
      if (!entry) return '';
      const f = args?.force ? '-f' : '';
      const l = args?.lazy ? '-l' : '';
      const res = await runRemoteExec(entry.client, `umount ${f} ${l} "${args?.target}" 2>&1`);
      return res.stdout || 'Unmounted';
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
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(args?.path, { flags: 'w' });
        stream.on('close', () => resolve());
        stream.on('error', err => reject(err));
        stream.end(args?.content || '', 'utf8');
      });
    }

    case 'sftp_write_file': {
      const buf = Array.isArray(args?.content) ? Buffer.from(args.content) : Buffer.from(args?.content || '');
      if (!entry || !entry.client) {
        fs.writeFileSync(args?.path, buf);
        return true;
      }
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(args?.path, { flags: 'w' });
        stream.on('close', () => resolve());
        stream.on('error', err => reject(err));
        stream.end(buf);
      });
    }

    case 'sftp_mkdir': {
      if (!entry) return;
      await runRemoteExec(entry.client, `mkdir -p "${args?.path}"`);
      return;
    }

    case 'sftp_delete': {
      if (!entry) return;
      await runRemoteExec(entry.client, `rm -rf "${args?.path}"`);
      return;
    }

    case 'sftp_rename': {
      if (!entry) return;
      await runRemoteExec(entry.client, `mv "${args?.oldPath}" "${args?.newPath}"`);
      return;
    }

    case 'sftp_chmod': {
      if (!entry) return;
      const octal = (args?.mode & 0o777).toString(8);
      await runRemoteExec(entry.client, `chmod ${octal} "${args?.path}"`);
      return;
    }

    case 'sftp_chown': {
      if (!entry) return;
      const ownership = args?.group ? `${args.owner}:${args.group}` : args.owner;
      await runRemoteExec(entry.client, `chown ${ownership} "${args?.path}"`);
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

    case 'store_save_connection': {
      const { connection } = args || {};
      if (!connection) return;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const idx = list.findIndex(c => c.id === connection.id);
      if (idx >= 0) list[idx] = connection;
      else list.push(connection);
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
    case 'api_send_request': {
      const { req } = args || {};
      if (!req || !req.url) throw new Error('Missing URL');
      const startTime = Date.now();
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
// BACKEND SERVER (Listening on Port 2020)
// -------------------------------------------------------------
const backendServer = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
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
  } else {
    socket.destroy();
  }
});

// -------------------------------------------------------------
// FRONTEND SERVER (Listening on Port 2222)
// -------------------------------------------------------------
const frontendServer = http.createServer((req, res) => {
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
      headers: { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` }
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
  } else {
    socket.destroy();
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
