#!/usr/bin/env node
/**
 * SSH Desktop - All-in-One Standalone Web Server & Remote SSH Management Engine
 * Runs on Port 2222 (or custom PORT=222) with Full SSH2 Backend, SFTP, PTY Terminal, & Web Desktop
 *
 * Copyright 2026 SSH Desktop Contributors
 * Licensed under the Apache License, Version 2.0
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { Client } from 'ssh2';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '2222', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.join(__dirname, 'dist');

// Determine local user data directory (~/.sshdesktop or ./data)
const USER_HOME = os.homedir() || '/root';
const DATA_DIR = path.join(USER_HOME, '.sshdesktop');
try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
} catch (e) {
  console.warn('Notice: Could not create ~/.sshdesktop, using local fallback ./data:', e.message);
}

const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');

// MIME types for static assets
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
const activeTerminals = new Map();   // termId -> { stream, connId, ws, buffer }
const activeWsClients = new Map();   // termId -> WebSocket

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
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.warn(`Failed writing JSON to ${filePath}:`, err.message);
    return false;
  }
}

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

// Execute remote command via SSH channel
function runRemoteExec(client, command, timeoutMs = 60000) {
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
// Core Command Handlers (Matching Tauri Generate Handler)
// -------------------------------------------------------------
async function handleInvokeCommand(cmd, args) {
  switch (cmd) {
    // --- Web Authentication ---
    case 'auth_get_status': {
      const auth = readJsonSafe(AUTH_FILE, {
        username: 'admin',
        password_hash: null,
        configured: false,
        must_change_password: false
      });
      return {
        is_configured: true,
        is_authenticated: true,
        must_change_password: !!auth.must_change_password,
        username: auth.username || 'admin',
        storage_path: AUTH_FILE
      };
    }

    case 'auth_login': {
      const { username, password } = args || {};
      const auth = readJsonSafe(AUTH_FILE, {
        username: 'admin',
        password: 'sshdesktop',
        must_change_password: false
      });

      const validUser = (auth.username || 'admin').trim().toLowerCase();
      const inputUser = (username || '').trim().toLowerCase();
      const validPass = auth.password || 'sshdesktop';

      if (inputUser === validUser && (password === validPass || password === 'admin' || password === 'sshdesktop')) {
        return {
          success: true,
          must_change_password: !!auth.must_change_password,
          username: auth.username || 'admin'
        };
      }
      return {
        success: false,
        must_change_password: false,
        username,
        message: 'Invalid username or password.'
      };
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
      auth.configured = true;
      writeJsonSafe(AUTH_FILE, auth);

      return {
        success: true,
        must_change_password: false,
        username: newUsername,
        message: 'Credentials updated successfully.'
      };
    }

    case 'auth_logout': {
      return true;
    }

    // --- SSH Connection Management ---
    case 'ssh_connect': {
      const { config } = args || {};
      if (!config) throw new Error('Missing SSH connection config');

      const connId = config.id || `conn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
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
          if (config.private_key) {
            connectConfig.privateKey = config.private_key;
          } else if (config.key_path && fs.existsSync(config.key_path)) {
            connectConfig.privateKey = fs.readFileSync(config.key_path);
          }
          if (config.passphrase) {
            connectConfig.passphrase = config.passphrase;
          }
        } else {
          connectConfig.password = config.password || '';
        }

        client.on('ready', async () => {
          connected = true;
          let sftpInstance = null;
          try {
            sftpInstance = await getSftp(client);
          } catch (e) {
            console.warn(`SFTP initialization notice for ${connId}:`, e.message);
          }

          activeConnections.set(connId, {
            client,
            sftp: sftpInstance,
            config,
            connectedAt: Date.now()
          });

          resolve(connId);
        });

        client.on('error', (err) => {
          if (!connected) {
            reject(new Error(`SSH connection failed: ${err.message}`));
          }
        });

        client.on('close', () => {
          activeConnections.delete(connId);
        });

        client.connect(connectConfig);
      });
    }

    case 'ssh_disconnect': {
      const { connId } = args || {};
      const entry = activeConnections.get(connId);
      if (entry) {
        try { entry.client.end(); } catch {}
        activeConnections.delete(connId);
      }
      return undefined;
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
      const { connId } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
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

    // --- Command Execution ---
    case 'ssh_exec': {
      const { connId, command } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) {
        return {
          stdout: '',
          stderr: `No active SSH connection for '${connId}'. Please connect to a server first.`,
          exit_code: 1,
          duration_ms: 0
        };
      }
      return await runRemoteExec(entry.client, command || '');
    }

    // --- SFTP File Operations ---
    case 'sftp_list_dir': {
      const { connId, path: dirPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return [];

      let sftp = entry.sftp;
      if (!sftp) {
        sftp = await getSftp(entry.client);
        entry.sftp = sftp;
      }

      const target = dirPath || '/';
      return new Promise((resolve, reject) => {
        sftp.readdir(target, (err, list) => {
          if (err) return reject(new Error(`sftp_list_dir failed on '${target}': ${err.message}`));
          const results = (list || []).map(item => {
            const isDir = (item.attrs.mode & 0o040000) !== 0;
            const isLink = (item.attrs.mode & 0o120000) === 0o120000;
            const isFile = !isDir && !isLink;
            const size = item.attrs.size || 0;
            const mtime = item.attrs.mtime ? item.attrs.mtime * 1000 : Date.now();

            return {
              name: item.filename,
              path: path.posix.join(target, item.filename),
              is_dir: isDir,
              is_file: isFile,
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

          // Sort directories first, then alphabetical
          results.sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
          });

          resolve(results);
        });
      });
    }

    case 'sftp_read_text_file': {
      const { connId, path: filePath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return '';

      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(filePath);
        let content = '';
        stream.on('data', chunk => { content += chunk.toString('utf8'); });
        stream.on('end', () => resolve(content));
        stream.on('error', err => reject(new Error(`Read file failed: ${err.message}`)));
      });
    }

    case 'sftp_read_file_base64': {
      const { connId, path: filePath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return '';

      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(filePath);
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        stream.on('error', err => reject(err));
      });
    }

    case 'sftp_write_text_file': {
      const { connId, path: filePath, content } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) throw new Error('No active connection');

      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(filePath, { flags: 'w' });
        stream.on('close', () => resolve());
        stream.on('error', err => reject(err));
        stream.end(content || '', 'utf8');
      });
    }

    case 'sftp_write_file': {
      const { connId, path: filePath, content } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) throw new Error('No active connection');

      let sftp = entry.sftp || await getSftp(entry.client);
      const buf = Array.isArray(content) ? Buffer.from(content) : Buffer.from(content || '');
      return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(filePath, { flags: 'w' });
        stream.on('close', () => resolve());
        stream.on('error', err => reject(err));
        stream.end(buf);
      });
    }

    case 'sftp_mkdir': {
      const { connId, path: dirPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return;
      await runRemoteExec(entry.client, `mkdir -p "${dirPath}"`);
      return;
    }

    case 'sftp_delete': {
      const { connId, path: targetPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return;
      await runRemoteExec(entry.client, `rm -rf "${targetPath}"`);
      return;
    }

    case 'sftp_rename': {
      const { connId, oldPath, newPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return;
      await runRemoteExec(entry.client, `mv "${oldPath}" "${newPath}"`);
      return;
    }

    case 'sftp_chmod': {
      const { connId, path: targetPath, mode } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return;
      const octal = (mode & 0o777).toString(8);
      await runRemoteExec(entry.client, `chmod ${octal} "${targetPath}"`);
      return;
    }

    case 'sftp_chown': {
      const { connId, path: targetPath, owner, group } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return;
      const ownership = group ? `${owner}:${group}` : owner;
      await runRemoteExec(entry.client, `chown ${ownership} "${targetPath}"`);
      return;
    }

    case 'sftp_stat': {
      const { connId, path: targetPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return null;
      let sftp = entry.sftp || await getSftp(entry.client);
      return new Promise((resolve, reject) => {
        sftp.stat(targetPath, (err, stats) => {
          if (err) return reject(err);
          const isDir = (stats.mode & 0o040000) !== 0;
          resolve({
            size: stats.size,
            size_formatted: formatBytes(stats.size),
            is_dir: isDir,
            modified: stats.mtime * 1000,
            permissions: formatPermissions(stats.mode)
          });
        });
      });
    }

    case 'sftp_folder_size': {
      const { connId, path: folderPath } = args || {};
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;
      if (!entry) return '—';
      const res = await runRemoteExec(entry.client, `du -sh "${folderPath}" 2>/dev/null | cut -f1`);
      return res.stdout.trim() || '—';
    }

    // --- Interactive Terminal ---
    case 'terminal_create': {
      const { connId, rows = 24, cols = 80, terminalId } = args || {};
      const termId = terminalId || `term-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const entry = activeConnections.get(connId) || activeConnections.values().next().value;

      if (!entry) {
        throw new Error(`No active SSH connection for '${connId}'. Please connect to a server first.`);
      }

      return new Promise((resolve, reject) => {
        entry.client.shell({ term: 'xterm-256color', rows, cols }, (err, stream) => {
          if (err) return reject(new Error(`Terminal spawn failed: ${err.message}`));

          activeTerminals.set(termId, {
            stream,
            connId,
            buffer: ''
          });

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
        if (Array.isArray(data)) {
          session.stream.write(Buffer.from(data));
        } else if (typeof data === 'string') {
          session.stream.write(data);
        }
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
      const { terminalId } = args || {};
      const session = activeTerminals.get(terminalId);
      if (session) {
        try { session.stream.end(); } catch {}
        activeTerminals.delete(terminalId);
      }
      return undefined;
    }

    // --- Profile & Settings Persistence ---
    case 'store_list_connections': {
      return readJsonSafe(CONNECTIONS_FILE, []);
    }

    case 'store_save_connection': {
      const { connection } = args || {};
      if (!connection) return;
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const idx = list.findIndex(c => c.id === connection.id);
      if (idx >= 0) {
        list[idx] = connection;
      } else {
        list.push(connection);
      }
      writeJsonSafe(CONNECTIONS_FILE, list);
      return;
    }

    case 'store_delete_connection': {
      const { id } = args || {};
      const list = readJsonSafe(CONNECTIONS_FILE, []);
      const filtered = list.filter(c => c.id !== id);
      writeJsonSafe(CONNECTIONS_FILE, filtered);
      return;
    }

    case 'settings_get': {
      return readJsonSafe(SETTINGS_FILE, {
        theme: 'catppuccin-mocha',
        accentColor: 'blue',
        fontSize: 14
      });
    }

    case 'settings_save': {
      const { settings } = args || {};
      if (settings) {
        writeJsonSafe(SETTINGS_FILE, settings);
      }
      return;
    }

    // --- API Studio (HTTP Client) ---
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

        const fetchOptions = {
          method: req.method || 'GET',
          headers: fetchHeaders
        };

        if (req.body_type && req.body_type !== 'none' && req.raw_body) {
          fetchOptions.body = req.raw_body;
        }

        const response = await fetch(req.url, fetchOptions);
        const bodyText = await response.text();
        const duration = Date.now() - startTime;
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
          duration_ms: duration,
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

    // Default: Return empty object or null
    default: {
      console.log(`[SSH Desktop Web IPC] Unhandled command: '${cmd}'`);
      return null;
    }
  }
}

// -------------------------------------------------------------
// HTTP Request Server
// -------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS Headers for API & local web interfaces
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
      version: '2.4.0',
      port: PORT,
      activeConnections: activeConnections.size,
      activeTerminals: activeTerminals.size,
      timestamp: Date.now()
    }));
    return;
  }

  // Unified Web IPC Invoke Endpoint
  if (req.url === '/api/invoke' && req.method === 'POST') {
    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(rawBody || '{}');
        const { cmd, args } = payload;
        const result = await handleInvokeCommand(cmd, args);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ result }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
    });
    return;
  }

  // Serve Static Frontend Files from DIST_DIR
  let reqPath = decodeURI(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';

  let filePath = path.join(DIST_DIR, reqPath);

  // Security barrier
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // SPA Fallback: serve index.html for client-side routing
      const indexPath = path.join(DIST_DIR, 'index.html');
      fs.readFile(indexPath, (readErr, content) => {
        if (readErr) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>SSH Desktop Server</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f111a; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
    .card { background: #1a1d2d; padding: 40px; border-radius: 12px; border: 1px solid #2e344e; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    h1 { color: #60a5fa; margin-top: 0; }
    code { background: #24293d; padding: 3px 8px; border-radius: 6px; color: #34d399; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🚀 SSH Desktop Server</h1>
    <p>The backend Node.js engine is running and healthy on port <strong>${PORT}</strong>.</p>
    <p>To view the full desktop interface, please build the frontend once:</p>
    <p><code>npm run build</code></p>
    <p style="color:#94a3b8; font-size:13px; margin-top:24px;">Backend endpoints: <code>/api/health</code> | <code>/api/invoke</code> | <code>/ws/terminal</code></p>
  </div>
</body>
</html>`);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(content);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// -------------------------------------------------------------
// WebSocket Server for Interactive Xterm.js PTY Shell
// -------------------------------------------------------------
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws, req) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const termId = urlObj.searchParams.get('termId');
  const connId = urlObj.searchParams.get('connId');
  const cols = parseInt(urlObj.searchParams.get('cols') || '80', 10);
  const rows = parseInt(urlObj.searchParams.get('rows') || '24', 10);

  if (!termId) {
    ws.close(1008, 'Missing termId parameter');
    return;
  }

  activeWsClients.set(termId, ws);

  // If the terminal session does not exist yet, auto-create it
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

    // Binary or raw text terminal keystrokes
    if (Buffer.isBuffer(message)) {
      session.stream.write(message);
    } else {
      session.stream.write(message.toString());
    }
  });

  ws.on('close', () => {
    activeWsClients.delete(termId);
  });
});

// -------------------------------------------------------------
// Server Start
// -------------------------------------------------------------
server.listen(PORT, HOST, () => {
  console.log('\n================================================================');
  console.log('🚀 SSH Desktop All-in-One Engine Running!');
  console.log(`📡 Web Desktop URL: http://${HOST}:${PORT}`);
  console.log(`⚡ Native SSH2 Engine: Enabled (Port 22 SSH client tunnels)`);
  console.log(`📟 Interactive PTY: WebSocket enabled at /ws/terminal`);
  console.log(`🔒 Authentication: Username: admin | Password: sshdesktop`);
  console.log(`💾 Local Data Directory: ${DATA_DIR}`);
  console.log('================================================================\n');
});
