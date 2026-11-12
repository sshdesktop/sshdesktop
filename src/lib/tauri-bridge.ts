import { invoke } from '@tauri-apps/api/core';
import type { UserPrivilegeInfo } from './types';
export type { UserPrivilegeInfo } from './types';
import {
  parseAppError,
  SshDesktopError,
  UNIFIED_COMMAND_CONTRACT,
  type AppErrorCode,
} from './ipc-contract';
export { SshDesktopError, parseAppError, UNIFIED_COMMAND_CONTRACT, type AppErrorCode };

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export const AUTH_STORAGE_KEY = 'sshdesktop_web_auth_session';
export const LEGACY_AUTH_STORAGE_KEY = 'clouddesk_web_auth_session';

export interface StoredSession {
  token?: string;
  username?: string;
  loginAt?: number;
  expiresAt?: number;
}

export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY) || 
                localStorage.getItem(AUTH_STORAGE_KEY) ||
                sessionStorage.getItem(LEGACY_AUTH_STORAGE_KEY) || 
                localStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.expiresAt && Date.now() >= parsed.expiresAt) {
      clearStoredSession();
      return null;
    }
    if (parsed && 'token' in parsed) {
      // Scrub legacy bearer token from browser storage; auth relies on HttpOnly cookie
      const { token: _t, ...safe } = parsed;
      try {
        if (localStorage.getItem(AUTH_STORAGE_KEY)) localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safe));
        if (sessionStorage.getItem(AUTH_STORAGE_KEY)) sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(safe));
        localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
        sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      } catch {}
      return safe;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStoredSession(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
  } catch {}
}

// ----------------- Closed Connections Tracking -----------------
const intentionallyClosedConnections = new Map<string, number>();

export function markConnectionClosed(connId?: string | null): void {
  if (!connId) return;
  intentionallyClosedConnections.set(connId, Date.now() + 15000);
}

export function markConnectionOpened(connId?: string | null): void {
  if (!connId) return;
  intentionallyClosedConnections.delete(connId);
}

export function isConnectionClosed(connId?: string | null): boolean {
  if (!connId) return false;
  const expiry = intentionallyClosedConnections.get(connId);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    intentionallyClosedConnections.delete(connId);
    return false;
  }
  return true;
}

export interface SafeInvokeOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function safeInvoke<T>(
  cmd: string,
  args: Record<string, any> = {},
  fallback: T,
  options?: SafeInvokeOptions,
): Promise<T> {
  const effectiveTimeoutMs = options?.timeoutMs ?? UNIFIED_COMMAND_CONTRACT[cmd]?.defaultTimeoutMs ?? 30_000;
  if (options?.signal?.aborted) {
    throw new SshDesktopError('CANCELLED', `Command '${cmd}' was cancelled before execution.`, cmd);
  }
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err: any) {
      const typedErr = parseAppError(err, cmd);
      console.error(`[SSH Desktop Tauri] Command '${cmd}' failed (${typedErr.code}):`, typedErr.message);
      const errMsg = typedErr.message;
      const isConnectionLoss = 
        errMsg.includes('No active SSH connection') || 
        errMsg.includes('Connection closed') || 
        errMsg.includes('connection reset') || 
        errMsg.includes('broken pipe') ||
        errMsg.includes('Connection refused') ||
        errMsg.includes('Connection timed out') ||
        errMsg.includes('timed out') ||
        errMsg.includes('Host is down') ||
        errMsg.includes('No route to host') ||
        errMsg.includes('Network is unreachable') ||
        errMsg.includes('closed by remote host') ||
        errMsg.includes('failed to send channel request') ||
        errMsg.includes('channel EOF') ||
        errMsg.includes('Socket closed') ||
        errMsg.includes('transport error');

      // Do NOT trigger global disconnect alert when:
      // 1. It is a connection test (ssh_test_connection)
      // 2. It is an intentional disconnect or store deletion
      // 3. It is an initial connection attempt (ssh_connect)
      // 4. The error is simply that no connection exists for this ID (e.g. un-connected fleet node)
      const isNotDropEvent = 
        cmd === 'ssh_test_connection' || 
        cmd === 'ssh_disconnect' || 
        cmd === 'store_delete_connection' ||
        cmd === 'ssh_connect' ||
        errMsg.includes('No active SSH connection') ||
        errMsg.includes('Please connect to a server first');

      const targetConnId = args?.connId || args?.connectionId || args?.id;
      const isExplicitlyClosed = targetConnId && isConnectionClosed(targetConnId);

      if (isConnectionLoss && !isNotDropEvent && !isExplicitlyClosed) {
        if (typeof window !== 'undefined') {
          const detail = { 
            connId: targetConnId,
            command: cmd,
            reason: errMsg 
          };
          window.dispatchEvent(new CustomEvent('sshdesktop-ssh-disconnected', { detail }));
          window.dispatchEvent(new CustomEvent('clouddesk-ssh-disconnected', { detail }));
        }
      }
      throw parseAppError(err, cmd);
    }
  }

  // Web / Node.js Backend Mode (e.g. running via node server.js on port 2222 or web preview)
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timeoutHandle = effectiveTimeoutMs > 0 ? setTimeout(() => controller.abort(), effectiveTimeoutMs) : null;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Requested-With': 'SSHDesktop',
    };

    const res = await fetch('/api/invoke', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      signal: controller.signal,
      body: JSON.stringify({ cmd, args }),
    });

    if (res.status === 401) {
      clearStoredSession();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('sshdesktop-session-expired', {
          detail: { reason: 'Your session has expired (1 hour limit). Please sign in again.' }
        }));
      }
      throw parseAppError('SESSION_EXPIRED: Your session has expired (1 hour limit). Please sign in again.', cmd, 401);
    }

    if (res.ok) {
      const data = await res.json();
      if (data && data.error) {
        throw parseAppError(data.error, cmd, res.status);
      }
      return (data ? data.result : fallback) as T;
    } else {
      const errText = await res.text();
      let parsedMsg = errText;
      try {
        const jsonErr = JSON.parse(errText);
        parsedMsg = jsonErr.error || errText;
      } catch {}
      throw parseAppError(parsedMsg || `HTTP ${res.status}: Failed to invoke '${cmd}'`, cmd, res.status);
    }
  } catch (err: any) {
    const timedOut = controller.signal.aborted && !options?.signal?.aborted;
    const typedErr = timedOut
      ? new SshDesktopError('TIMEOUT', `Command '${cmd}' timed out after ${effectiveTimeoutMs}ms.`, cmd)
      : parseAppError(err, cmd);
    console.error(`[SSH Desktop Web IPC] Command '${cmd}' failed:`, typedErr);
    if (typedErr.code === 'CANCELLED') {
      throw typedErr;
    }
    const isReadOnlyFallback =
      cmd.endsWith('_list') ||
      cmd.endsWith('_get') ||
      cmd.endsWith('_status') ||
      cmd === 'system_get_stats' ||
      cmd === 'system_get_disks' ||
      cmd === 'system_get_network' ||
      cmd === 'network_bandwidth_stats' ||
      cmd === 'ssh_list_connections' ||
      cmd === 'ssh_list_tunnels' ||
      cmd === 'ssh_get_socks5' ||
      cmd === 'store_list_connections';
    if (!isReadOnlyFallback) {
      throw typedErr;
    }
    return fallback;
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

// ----------------- Web Terminal WebSocket Session Cache -----------------
const webTerminalSockets = new Map<string, WebSocket>();
const lastKnownTerminalSizes = new Map<string, { rows: number; cols: number }>();

function setupWebTerminalSocket(termId: string, connId: string, cols: number, rows: number) {
  if (typeof window === 'undefined') return;
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?termId=${encodeURIComponent(termId)}&connId=${encodeURIComponent(connId)}&cols=${cols}&rows=${rows}`;
    lastKnownTerminalSizes.set(termId, { rows, cols });
    const oldWs = webTerminalSockets.get(termId);
    if (oldWs && oldWs.readyState !== WebSocket.CLOSED) {
      try { oldWs.close(); } catch {}
    }
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      const latest = lastKnownTerminalSizes.get(termId) || { rows, cols };
      try {
        ws.send(JSON.stringify({ type: 'resize', rows: latest.rows, cols: latest.cols }));
      } catch {}
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'output' && parsed.text) {
          window.dispatchEvent(new CustomEvent('terminal-output', {
            detail: { terminal_id: termId, text: parsed.text }
          }));
          return;
        }
      } catch {}

      window.dispatchEvent(new CustomEvent('terminal-output', {
        detail: { terminal_id: termId, text: String(event.data) }
      }));
    };

    ws.onclose = () => {
      webTerminalSockets.delete(termId);
    };

    ws.onerror = (e) => {
      console.warn('[SSH Desktop Web Terminal] WebSocket notice:', e);
    };

    webTerminalSockets.set(termId, ws);
  } catch (e) {
    console.warn('[SSH Desktop] Failed to connect web terminal WebSocket:', e);
  }
}

// ----------------- SSH Commands -----------------
export async function sshConnect(config: any): Promise<string> {
  if (config?.id) {
    markConnectionOpened(config.id);
  }
  return safeInvoke<string>('ssh_connect', { config }, '');
}

export async function sshDisconnect(connId: string): Promise<void> {
  if (connId) {
    markConnectionClosed(connId);
  }
  return safeInvoke<void>('ssh_disconnect', { connId }, undefined);
}

export async function sshListConnections(): Promise<any[]> {
  return safeInvoke<any[]>('ssh_list_connections', {}, []);
}

export async function sshTestConnection(config: any): Promise<boolean> {
  return safeInvoke<boolean>('ssh_test_connection', { config }, false);
}

export async function sshGetUserPrivilege(connId: string): Promise<UserPrivilegeInfo> {
  return safeInvoke<UserPrivilegeInfo>('ssh_get_user_privilege', { connId }, {
    username: 'user',
    uid: 1000,
    gid: 1000,
    home_dir: '/home/user',
    is_root: false,
    has_sudo: false,
    sudo_type: 'none',
    groups: [],
  });
}

export async function sshExec(connId: string, command: string): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }> {
  try {
    return await safeInvoke('ssh_exec', { connId, command }, {
      stdout: '',
      stderr: 'Execution failed or bridge disconnected',
      exit_code: -1,
      duration_ms: 0,
    });
  } catch (err: any) {
    return {
      stdout: '',
      stderr: String(err?.message || err),
      exit_code: -1,
      duration_ms: 0,
    };
  }
}

export async function sshLaunchPutty(connId: string, remoteDir?: string): Promise<void> {
  return safeInvoke<void>('ssh_launch_putty', { connId, remoteDir: remoteDir || null }, undefined);
}

export async function sshExecStream(connId: string, command: string, streamId: string): Promise<void> {
  return safeInvoke<void>('ssh_exec_stream', { connId, command, streamId }, undefined);
}

export async function sshExecStop(streamId: string): Promise<void> {
  return safeInvoke<void>('ssh_exec_stop', { streamId }, undefined);
}

// ----------------- Terminal Commands -----------------
export async function terminalCreate(connId: string, rows: number = 24, cols: number = 80, terminalId?: string): Promise<string> {
  const termId = await safeInvoke<string>('terminal_create', { connId, rows, cols, terminalId }, terminalId || 'term-1');
  if (!isTauri() && typeof window !== 'undefined') {
    setupWebTerminalSocket(termId, connId, cols, rows);
  }
  return termId;
}

export async function terminalWrite(terminalId: string, data: number[]): Promise<void> {
  if (!isTauri()) {
    const ws = webTerminalSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(new Uint8Array(data));
      return;
    }
  }
  return safeInvoke<void>('terminal_write', { terminalId, data }, undefined);
}

export async function terminalResize(terminalId: string, rows: number, cols: number): Promise<void> {
  lastKnownTerminalSizes.set(terminalId, { rows, cols });
  if (!isTauri()) {
    const ws = webTerminalSockets.get(terminalId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'resize', rows, cols }));
      } catch {}
    }
  }
  return safeInvoke<void>('terminal_resize', { terminalId, rows, cols }, undefined);
}

export async function terminalClose(terminalId: string): Promise<void> {
  lastKnownTerminalSizes.delete(terminalId);
  if (!isTauri()) {
    const ws = webTerminalSockets.get(terminalId);
    if (ws) {
      try { ws.close(); } catch {}
      webTerminalSockets.delete(terminalId);
    }
  }
  return safeInvoke<void>('terminal_close', { terminalId }, undefined);
}

// ----------------- SFTP Commands -----------------
export async function sftpListDir(connId: string, path: string): Promise<any[]> {
  return safeInvoke<any[]>('sftp_list_dir', { connId, path }, []);
}

export async function sftpReadTextFile(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('sftp_read_text_file', { connId, path }, '');
}

export async function sftpReadFileBase64(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('sftp_read_file_base64', { connId, path }, '');
}

export async function sftpWriteTextFile(
  connId: string,
  path: string,
  content: string,
  expectedHash?: string,
): Promise<void> {
  return safeInvoke<void>('sftp_write_text_file', {
    connId,
    path,
    content,
    expectedHash,
    expected_hash: expectedHash,
  }, undefined);
}

export async function sftpWriteFile(connId: string, path: string, content: number[]): Promise<void> {
  return safeInvoke<void>('sftp_write_file', { connId, path, content }, undefined);
}

export async function sftpMkdir(connId: string, path: string): Promise<void> {
  return safeInvoke<void>('sftp_mkdir', { connId, path }, undefined);
}

export async function sftpDelete(connId: string, path: string): Promise<void> {
  return safeInvoke<void>('sftp_delete', { connId, path }, undefined);
}

export async function sftpRename(connId: string, oldPath: string, newPath: string): Promise<void> {
  return safeInvoke<void>('sftp_rename', { connId, oldPath, newPath }, undefined);
}

export async function sftpChmod(connId: string, path: string, mode: number): Promise<void> {
  return safeInvoke<void>('sftp_chmod', { connId, path, mode }, undefined);
}

export async function sftpChown(connId: string, path: string, owner: string, group: string = ''): Promise<void> {
  return safeInvoke<void>('sftp_chown', { connId, path, owner, group }, undefined);
}

export async function sftpFolderSize(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('sftp_folder_size', { connId, path }, '—');
}

export async function sftpDownloadToDownloads(connId: string, remotePath: string): Promise<string> {
  return safeInvoke<string>('sftp_download_to_downloads', { connId, remotePath }, '');
}

export async function sftpDownloadFile(connId: string, remotePath: string, localPath?: string): Promise<string> {
  try {
    if (isTauri()) {
      if (localPath) {
        await safeInvoke<void>('sftp_download', { connId, remotePath, localPath }, undefined);
        return localPath;
      }
      return await sftpDownloadToDownloads(connId, remotePath);
    }
    // Web browser fallback
    const textContent = await sftpReadTextFile(connId, remotePath);
    const blob = new Blob([textContent], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = remotePath.split('/').pop() || 'downloaded_file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return 'Downloads';
  } catch (err) {
    console.warn('sftpDownloadFile error:', err);
    throw err;
  }
}

// ----------------- System Commands -----------------
export async function systemGetStats(connId: string = 'default'): Promise<any> {
  try {
    return await safeInvoke<any>('system_get_stats', { connId }, null);
  } catch {
    return null;
  }
}

export async function systemGetDisks(connId: string = 'default'): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('system_get_disks', { connId }, []);
  } catch {
    return [];
  }
}

export async function systemGetNetwork(connId: string = 'default'): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('system_get_network', { connId }, []);
  } catch {
    return [];
  }
}

export async function processList(connId: string = 'default'): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('process_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function processKill(
  connId: string,
  pid: number,
  signal: string,
  expectedName?: string,
): Promise<void> {
  return safeInvoke<void>('process_kill', {
    connId,
    pid,
    signal,
    expectedName,
    expected_name: expectedName,
  }, undefined);
}

export async function processRenice(connId: string, pid: number, value: number): Promise<void> {
  return safeInvoke<void>('process_renice', { connId, pid, value }, undefined);
}

export async function serviceList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('service_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function serviceAction(connId: string, name: string, action: string): Promise<string> {
  return safeInvoke<string>('service_action', { connId, name, action }, '');
}

export async function serviceStatus(connId: string, name: string): Promise<string> {
  return safeInvoke<string>('service_status', { connId, name }, '');
}

export async function serviceLogs(connId: string, name: string, lines: number): Promise<string> {
  return safeInvoke<string>('service_logs', { connId, name, lines }, '');
}

export async function dockerContainers(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('docker_containers', { connId }, []);
  } catch {
    return [];
  }
}

export async function dockerAction(connId: string, containerId: string, action: string): Promise<string> {
  return safeInvoke<string>('docker_action', { connId, containerId, action }, '');
}

export async function dockerLogs(connId: string, containerId: string, lines: number): Promise<string> {
  return safeInvoke<string>('docker_logs', { connId, containerId, lines }, '');
}

export async function dockerImages(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('docker_images', { connId }, []);
  } catch {
    return [];
  }
}

export async function dockerImageRemove(connId: string, imageId: string): Promise<string> {
  return safeInvoke<string>('docker_image_remove', { connId, imageId }, '');
}

export async function networkPorts(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('network_ports', { connId }, []);
  } catch {
    return [];
  }
}

export async function networkConnections(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('network_connections', { connId }, []);
  } catch {
    return [];
  }
}

export async function networkPing(connId: string, host: string): Promise<string> {
  return safeInvoke<string>('network_ping', { connId, host }, '');
}

export async function networkDnsLookup(connId: string, domain: string): Promise<string> {
  return safeInvoke<string>('network_dns_lookup', { connId, domain }, '');
}

export interface BandwidthStatInfo {
  name: string;
  ip: string;
  mac: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_packets: number;
  tx_packets: number;
  rx_errors: number;
  tx_errors: number;
  rx_drops: number;
  tx_drops: number;
  rx_speed_bps: number;
  tx_speed_bps: number;
  operstate: string;
  mtu?: number;
  speed_mbit?: number;
}

export interface NetworkBandwidthSummary {
  total_rx_bytes: number;
  total_tx_bytes: number;
  total_rx_speed_bps: number;
  total_tx_speed_bps: number;
  total_rx_packets: number;
  total_tx_packets: number;
  interfaces: BandwidthStatInfo[];
  timestamp: number;
}

export async function networkKillPort(
  connId: string,
  port: number,
  protocol: string = 'tcp',
  pid?: number,
  signal: string = 'KILL'
): Promise<string> {
  return safeInvoke<string>('network_kill_port', { connId, port, protocol, pid, signal }, '');
}

export async function networkBandwidthStats(connId: string): Promise<NetworkBandwidthSummary> {
  return safeInvoke<NetworkBandwidthSummary>('network_bandwidth_stats', { connId }, {
    total_rx_bytes: 0,
    total_tx_bytes: 0,
    total_rx_speed_bps: 0,
    total_tx_speed_bps: 0,
    total_rx_packets: 0,
    total_tx_packets: 0,
    interfaces: [],
    timestamp: Math.floor(Date.now() / 1000),
  });
}

export async function packageList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('package_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function packageInstall(connId: string, name: string): Promise<string> {
  return safeInvoke<string>('package_install', { connId, name }, 'Installed');
}

export async function packageRemove(connId: string, name: string): Promise<string> {
  return safeInvoke<string>('package_remove', { connId, name }, 'Removed');
}

export async function packagePreview(connId: string, name: string, action: 'install' | 'remove'): Promise<string> {
  return safeInvoke<string>('package_preview', { connId, name, action }, '');
}

export async function packageUpdate(connId: string): Promise<string> {
  return safeInvoke<string>('package_update', { connId }, 'Updated');
}

export async function packageUpgradable(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('package_upgradable', { connId }, []);
  } catch {
    return [];
  }
}

export async function packageSearch(connId: string, query: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('package_search', { connId, query }, []);
  } catch {
    return [];
  }
}

export async function packageDetectManager(connId: string): Promise<string> {
  return safeInvoke<string>('package_detect_manager', { connId }, 'apt');
}

export async function userList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('user_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function userAdd(connId: string, username: string, password?: string, shell?: string, groups?: string[]): Promise<void> {
  return safeInvoke<void>('user_add', { connId, username, password: password || undefined, shell, groups }, undefined);
}

export async function userSetPassword(connId: string, username: string, password: string): Promise<void> {
  return safeInvoke<void>('user_set_password', { connId, username, password }, undefined);
}

export async function userToggleSudo(connId: string, username: string, grant: boolean): Promise<void> {
  return safeInvoke<void>('user_toggle_sudo', { connId, username, grant }, undefined);
}

export async function userDelete(connId: string, username: string, removeHome: boolean = false): Promise<void> {
  return safeInvoke<void>('user_delete', { connId, username, removeHome }, undefined);
}

export async function userLock(connId: string, username: string): Promise<void> {
  return safeInvoke<void>('user_lock', { connId, username }, undefined);
}

export async function userUnlock(connId: string, username: string): Promise<void> {
  return safeInvoke<void>('user_unlock', { connId, username }, undefined);
}

export async function groupList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('group_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function groupAdd(connId: string, name: string): Promise<void> {
  return safeInvoke<void>('group_add', { connId, name }, undefined);
}

export async function groupDelete(connId: string, name: string): Promise<void> {
  return safeInvoke<void>('group_delete', { connId, name }, undefined);
}

export async function groupAddUser(connId: string, group: string, username: string): Promise<void> {
  return safeInvoke<void>('group_add_user', { connId, group, username }, undefined);
}

export async function groupRemoveUser(connId: string, group: string, username: string): Promise<void> {
  return safeInvoke<void>('group_remove_user', { connId, group, username }, undefined);
}

export async function whoIsLoggedIn(connId: string): Promise<string> {
  return safeInvoke<string>('who_is_logged_in', { connId }, '');
}

export async function cronList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('cron_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function cronAdd(connId: string, schedule: string, command: string): Promise<void> {
  return safeInvoke<void>('cron_add', { connId, schedule, command }, undefined);
}

export async function cronRemove(connId: string, lineNumber: number): Promise<void> {
  return safeInvoke<void>('cron_remove', { connId, lineNumber }, undefined);
}

export async function cronRollback(connId: string): Promise<string> {
  return safeInvoke<string>('cron_rollback', { connId }, 'Crontab restored from previous snapshot.');
}

export async function logsJournal(connId: string, unit?: string, lines: number = 100): Promise<string> {
  return safeInvoke<string>('logs_journal', { connId, unit, lines }, '');
}

export async function logsFile(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('logs_file', { connId, path }, '');
}

export async function logsDmesg(connId: string): Promise<string> {
  return safeInvoke<string>('logs_dmesg', { connId }, '');
}

export interface FirewallStatusInfo {
  backend: 'ufw' | 'firewalld' | 'iptables' | 'none';
  installed: boolean;
  active: boolean;
  ufw_installed: boolean;
  ufw_active: boolean;
  firewalld_installed: boolean;
  firewalld_active: boolean;
  default_incoming: string;
  default_outgoing: string;
  default_routed: string;
  active_zone?: string;
  all_zones: string[];
  raw_status: string;
}

export interface FirewallRuleItem {
  id: string;
  number: number;
  action: 'ALLOW' | 'DENY' | 'REJECT' | 'LIMIT';
  direction: 'IN' | 'OUT' | 'BOTH';
  from_ip: string;
  to_port: string;
  protocol: string;
  zone?: string;
  comment: string;
}

export interface AddRuleRequest {
  port: string;
  protocol: string;
  action: string;
  direction?: string;
  from_ip?: string;
  backend?: string;
  zone?: string;
  comment?: string;
}

export async function firewallDetectBackend(connId: string): Promise<FirewallStatusInfo> {
  return safeInvoke<FirewallStatusInfo>('firewall_detect_backend', { connId }, {
    backend: 'ufw',
    installed: true,
    active: true,
    ufw_installed: true,
    ufw_active: true,
    firewalld_installed: false,
    firewalld_active: false,
    default_incoming: 'deny',
    default_outgoing: 'allow',
    default_routed: 'disabled',
    all_zones: [],
    raw_status: '',
  });
}

export async function firewallStatus(connId: string): Promise<string> {
  return safeInvoke<string>('firewall_status', { connId }, 'Status: active');
}

export async function firewallRules(connId: string): Promise<FirewallRuleItem[]> {
  try {
    return await safeInvoke<FirewallRuleItem[]>('firewall_rules', { connId }, []);
  } catch {
    return [];
  }
}

export async function firewallAddRule(connId: string, port: string, protocol: string, action: string): Promise<string> {
  return safeInvoke<string>('firewall_add_rule', { connId, port, protocol, action }, '');
}

export async function firewallAddRuleAdvanced(connId: string, payload: AddRuleRequest): Promise<string> {
  return safeInvoke<string>('firewall_add_rule_advanced', { connId, payload }, '');
}

export async function firewallDeleteRule(connId: string, ruleNumber: number): Promise<string> {
  return safeInvoke<string>('firewall_delete_rule', { connId, ruleNumber }, '');
}

export async function firewallDeleteRuleAdvanced(
  connId: string,
  ruleNumber: number,
  port?: string,
  protocol?: string,
  backend?: string,
  zone?: string
): Promise<string> {
  return safeInvoke<string>('firewall_delete_rule_advanced', { connId, ruleNumber, port, protocol, backend, zone }, '');
}

export async function firewallToggle(connId: string, enable: boolean): Promise<string> {
  return safeInvoke<string>('firewall_toggle', { connId, enable }, '');
}

export async function firewallInstall(connId: string, tool: 'ufw' | 'firewalld'): Promise<string> {
  return safeInvoke<string>('firewall_install', { connId, tool }, '');
}

export async function firewallSetDefaultPolicy(
  connId: string,
  direction: 'incoming' | 'outgoing',
  policy: 'allow' | 'deny'
): Promise<string> {
  return safeInvoke<string>('firewall_set_default_policy', { connId, direction, policy }, '');
}

export async function firewallReset(connId: string): Promise<string> {
  return safeInvoke<string>('firewall_reset', { connId }, '');
}

export async function firewallReload(connId: string): Promise<string> {
  return safeInvoke<string>('firewall_reload', { connId }, '');
}

export interface BlockDeviceInfo {
  name: string;
  kname?: string;
  path?: string;
  size: string;
  size_bytes?: number;
  type_name: string;
  fstype?: string;
  label?: string;
  uuid?: string;
  mountpoint?: string;
  model?: string;
  ro?: boolean;
  pttype?: string;
  parttype?: string;
  children?: BlockDeviceInfo[];
  is_system?: boolean;
}

export interface FstabEntry {
  spec: string;
  file: string;
  vfstype: string;
  mntops: string;
  freq: number;
  passno: number;
}

export async function diskList(connId: string): Promise<BlockDeviceInfo[]> {
  try {
    return await safeInvoke<BlockDeviceInfo[]>('disk_list', { connId }, []);
  } catch {
    return [];
  }
}

export async function diskUsage(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('disk_usage', { connId }, []);
  } catch {
    return [];
  }
}

export async function diskSmart(connId: string, device: string): Promise<string> {
  return safeInvoke<string>('disk_smart', { connId, device }, '');
}

export async function diskLargestDirs(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('disk_largest_dirs', { connId, path }, '');
}

export async function diskMount(
  connId: string,
  device: string,
  mountPoint: string,
  fstype?: string,
  options?: string,
  persistFstab: boolean = false
): Promise<string> {
  return safeInvoke<string>('disk_mount', { connId, device, mountPoint, fstype, options, persistFstab }, '');
}

export async function diskUnmount(
  connId: string,
  target: string,
  force: boolean = false,
  lazy: boolean = false,
  removeFromFstab: boolean = false
): Promise<string> {
  return safeInvoke<string>('disk_unmount', { connId, target, force, lazy, removeFromFstab }, '');
}

export async function diskRemount(
  connId: string,
  mountPoint: string,
  options: string
): Promise<string> {
  return safeInvoke<string>('disk_remount', { connId, mountPoint, options }, '');
}

export async function diskGetFstab(connId: string): Promise<FstabEntry[]> {
  try {
    return await safeInvoke<FstabEntry[]>('disk_get_fstab', { connId }, []);
  } catch {
    return [];
  }
}

export async function diskCreateLabel(
  connId: string,
  device: string,
  labelType: 'gpt' | 'msdos'
): Promise<string> {
  return safeInvoke<string>('disk_create_label', { connId, device, labelType }, '');
}

export async function diskCreatePartition(
  connId: string,
  device: string,
  partType: string,
  start: string,
  end: string,
  fstype?: string,
  label?: string
): Promise<string> {
  return safeInvoke<string>('disk_create_partition', { connId, device, partType, start, end, fstype, label }, '');
}

export async function diskDeletePartition(
  connId: string,
  device: string,
  partNumber: number,
  partDevice?: string
): Promise<string> {
  return safeInvoke<string>('disk_delete_partition', { connId, device, partNumber, partDevice }, '');
}

export async function diskResizePartition(
  connId: string,
  device: string,
  partNumber: number,
  newEnd: string,
  partDevice?: string,
  fstype?: string
): Promise<string> {
  return safeInvoke<string>('disk_resize_partition', { connId, device, partNumber, newEnd, partDevice, fstype }, '');
}

export async function diskSetPartitionFlag(
  connId: string,
  device: string,
  partNumber: number,
  flag: string,
  stateOn: boolean
): Promise<string> {
  return safeInvoke<string>('disk_set_partition_flag', { connId, device, partNumber, flag, stateOn }, '');
}

export async function diskFormatFilesystem(
  connId: string,
  device: string,
  fstype: string,
  label?: string,
  quick: boolean = true
): Promise<string> {
  return safeInvoke<string>('disk_format_filesystem', { connId, device, fstype, label, quick }, '');
}

export async function diskSetLabel(
  connId: string,
  device: string,
  fstype: string,
  label: string
): Promise<string> {
  return safeInvoke<string>('disk_set_label', { connId, device, fstype, label }, '');
}

export async function diskCheckFilesystem(
  connId: string,
  device: string,
  fstype?: string,
  repair: boolean = false
): Promise<string> {
  return safeInvoke<string>('disk_check_filesystem', { connId, device, fstype, repair }, '');
}

export interface SwapInfo {
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  total_formatted: string;
  used_formatted: string;
  free_formatted: string;
  active_file?: string;
  is_enabled: boolean;
}

export interface TmpInfo {
  mount_point: string;
  filesystem: string;
  is_tmpfs: boolean;
  total_bytes: number;
  used_bytes: number;
  avail_bytes: number;
  size_formatted: string;
  used_formatted: string;
  avail_formatted: string;
  percent: number;
}

export async function diskGetSwapInfo(connId: string): Promise<SwapInfo> {
  return safeInvoke<SwapInfo>('disk_get_swap_info', { connId }, {
    total_bytes: 0,
    used_bytes: 0,
    free_bytes: 0,
    total_formatted: '0 B',
    used_formatted: '0 B',
    free_formatted: '0 B',
    is_enabled: false,
  });
}

export async function diskManageSwap(
  connId: string,
  action: 'set_size' | 'enable' | 'disable',
  sizeMb?: number
): Promise<string> {
  return safeInvoke<string>('disk_manage_swap', { connId, action, sizeMb }, '');
}

export async function diskGetTmpInfo(connId: string): Promise<TmpInfo> {
  return safeInvoke<TmpInfo>('disk_get_tmp_info', { connId }, {
    mount_point: '/tmp',
    filesystem: 'tmpfs',
    is_tmpfs: true,
    total_bytes: 0,
    used_bytes: 0,
    avail_bytes: 0,
    size_formatted: '0 B',
    used_formatted: '0 B',
    avail_formatted: '0 B',
    percent: 0,
  });
}

export async function diskManageTmp(
  connId: string,
  size: string,
  persist: boolean = true
): Promise<string> {
  return safeInvoke<string>('disk_manage_tmp', { connId, size, persist }, '');
}

// ----------------- Store Commands -----------------
export async function storeSaveConnection(connection: any): Promise<void> {
  return safeInvoke<void>('store_save_connection', { connection }, undefined);
}

export async function storeListConnections(): Promise<any[]> {
  return safeInvoke<any[]>('store_list_connections', {}, []);
}

export async function storeDeleteConnection(id: string): Promise<void> {
  return safeInvoke<void>('store_delete_connection', { id }, undefined);
}

export async function storeSecretSave(key: string, value: string): Promise<boolean> {
  return safeInvoke<boolean>('store_secret_save', { key, value }, false);
}

export async function storeSecretLoad(key: string): Promise<string | null> {
  return safeInvoke<string | null>('store_secret_load', { key }, null);
}

export async function storeSecretDelete(key: string): Promise<boolean> {
  return safeInvoke<boolean>('store_secret_delete', { key }, false);
}

export async function settingsGet(): Promise<any> {
  return safeInvoke<any>('settings_get', {}, { theme: 'catppuccin-mocha', accentColor: 'blue', fontSize: 14 });
}

export async function settingsSave(settings: any): Promise<void> {
  return safeInvoke<void>('settings_save', { settings }, undefined);
}

export async function pickKeyFile(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'PEM Private Key (*.pem)',
            extensions: ['pem']
          }
        ]
      });
      if (selected && typeof selected === 'string') {
        return selected;
      }
    } catch (e) {
      console.warn('[SSH Desktop] Failed to open native file picker:', e);
    }
  }

  // Web Browser mode: Open standard browser file selector dialog
  // Strict PEM only & Zero disk writes: Kept in memory only
  return new Promise<string | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pem';
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.top = '-9999px';
    input.style.opacity = '0';
    document.body.appendChild(input);

    let resolved = false;

    const cleanup = () => {
      setTimeout(() => {
        if (input.parentNode) {
          document.body.removeChild(input);
        }
      }, 500);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
        cleanup();
        return;
      }

      if (!file.name.toLowerCase().endsWith('.pem')) {
        alert('Only .pem private key files are supported. Please select a valid .pem key.');
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
        cleanup();
        return;
      }

      // Read key file content directly into browser memory
      // Strictly in-memory: NEVER write or upload key to server disk!
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = ((e.target?.result as string) || '').trim();
        if (!resolved) {
          resolved = true;
          resolve(text);
        }
        cleanup();
      };

      reader.onerror = () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
        cleanup();
      };

      reader.readAsText(file);
    };

    input.oncancel = () => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
      cleanup();
    };

    input.click();
  });
}

// ----------------- Native Database Commands (Direct Drivers + SSH Tunnel) -----------------
export interface DatabaseConnectionConfig {
  id: string;
  name: string;
  engine: 'mysql' | 'mariadb' | 'postgresql' | 'sqlite' | 'mssql' | 'mongodb' | 'redis' | 'dynamodb' | 'cosmos' | 'cassandra' | 'oracle' | 'db2' | string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  schema?: string;
  use_ssl?: boolean;
  ssl_verify?: boolean;
  use_ssh?: boolean;
  ssh_connection_id?: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_path?: string;
  sqlite_path?: string;
  access_key_id?: string;
  secret_access_key?: string;
  region?: string;
  endpoint_url?: string;
  keyspace?: string;
  sid?: string;
  read_only?: boolean;
  timeout_seconds?: number;
}

export interface ColumnMeta {
  name: string;
  data_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  referenced_table?: string | null;
  referenced_column?: string | null;
  default_value?: string | null;
  extra?: string | null;
}

export interface BatchStatementResult {
  statement: string;
  columns: ColumnMeta[];
  rows: any[];
  affected_rows: number;
  last_insert_id?: number | null;
  execution_time_ms: number;
  error?: string | null;
}

export interface QueryResult {
  columns: ColumnMeta[];
  rows: any[];
  affected_rows: number;
  last_insert_id?: number | null;
  execution_time_ms: number;
  command_type: string;
  server_version?: string | null;
  warnings: string[];
  all_results?: BatchStatementResult[] | null;
}

export interface ServerCapabilities {
  engine: string;
  server_version: string;
  supports_transactions: boolean;
  supports_schemas: boolean;
  supports_procedures: boolean;
  supports_functions: boolean;
  supports_triggers: boolean;
  supports_views: boolean;
  supports_indexes: boolean;
  supports_foreign_keys: boolean;
  supports_explain: boolean;
  supports_process_list: boolean;
  read_only: boolean;
  supports_rename_table?: boolean;
  supports_alter_column?: boolean;
}

export interface ColumnSpec {
  name: string;
  data_type: string;
  nullable?: boolean;
  primary_key?: boolean;
  auto_increment?: boolean;
  default_value?: string;
}

export type DatabaseOperation =
  | { operation: 'create_table'; database?: string; schema?: string; table: string; columns: ColumnSpec[] }
  | { operation: 'rename_object'; database?: string; schema?: string; object_type: string; old_name: string; new_name: string }
  | { operation: 'drop_object'; database?: string; schema?: string; object_type: string; name: string }
  | { operation: 'truncate_table'; database?: string; schema?: string; table: string }
  | { operation: 'add_column'; database?: string; schema?: string; table: string; column: ColumnSpec }
  | { operation: 'drop_column'; database?: string; schema?: string; table: string; column_name: string }
  | { operation: 'create_index'; database?: string; schema?: string; table: string; index_name: string; columns: string[]; is_unique: boolean }
  | { operation: 'drop_index'; database?: string; schema?: string; table: string; index_name: string };

export interface OperationResult {
  success: boolean;
  message: string;
  affected_rows: number;
  execution_time_ms: number;
  generated_sql?: string;
  definition?: string;
}

export interface DatabaseObject {
  name: string;
  object_type: string; // 'table' | 'view' | 'procedure' | 'function' | 'trigger' | 'index' | 'collection'
  schema?: string | null;
  row_count?: number | null;
  size_bytes?: number | null;
  definition?: string | null;
}

export interface RedisKeyItem {
  key: string;
  key_type: string;
  ttl: number;
  size?: number | null;
}

export interface RedisValueItem {
  key: string;
  key_type: string;
  ttl: number;
  value: any;
}

export async function dbConnect(config: DatabaseConnectionConfig): Promise<ServerCapabilities> {
  return safeInvoke<ServerCapabilities>('db_connect', { config }, {
    engine: config.engine,
    server_version: '1.0.0',
    supports_transactions: true,
    supports_schemas: true,
    supports_procedures: true,
    supports_functions: true,
    supports_triggers: true,
    supports_views: true,
    supports_indexes: true,
    supports_foreign_keys: true,
    supports_explain: true,
    supports_process_list: true,
    read_only: false,
  });
}

export async function dbDisconnect(connectionId: string): Promise<void> {
  return safeInvoke<void>('db_disconnect', { connectionId }, undefined);
}

export async function dbTestConnection(config: DatabaseConnectionConfig): Promise<ServerCapabilities> {
  return safeInvoke<ServerCapabilities>('db_test_connection', { config }, {
    engine: config.engine,
    server_version: '1.0.0',
    supports_transactions: true,
    supports_schemas: true,
    supports_procedures: true,
    supports_functions: true,
    supports_triggers: true,
    supports_views: true,
    supports_indexes: true,
    supports_foreign_keys: true,
    supports_explain: true,
    supports_process_list: true,
    read_only: false,
  });
}

export async function dbExecuteQuery(connectionId: string, query: string, maxRows?: number): Promise<QueryResult> {
  return safeInvoke<QueryResult>('db_execute_query', { connectionId, query, maxRows: maxRows || 500 }, {
    columns: [],
    rows: [],
    affected_rows: 0,
    execution_time_ms: 0,
    command_type: 'SELECT',
    warnings: [],
  });
}

export async function dbListTables(connectionId: string, schema?: string): Promise<DatabaseObject[]> {
  return safeInvoke<DatabaseObject[]>('db_list_tables', { connectionId, schema: schema || null }, []);
}

export async function dbGetTableColumns(connectionId: string, tableName: string, schema?: string): Promise<ColumnMeta[]> {
  return safeInvoke<ColumnMeta[]>('db_get_table_columns', { connectionId, tableName, schema: schema || null }, []);
}

export async function redisScanKeys(connectionId: string, pattern?: string, count?: number): Promise<RedisKeyItem[]> {
  return safeInvoke<RedisKeyItem[]>('redis_scan_keys', { connectionId, pattern: pattern || '*', count: count || 100 }, []);
}

export async function redisGetValue(connectionId: string, key: string): Promise<RedisValueItem> {
  return safeInvoke<RedisValueItem>('redis_get_value', { connectionId, key }, {
    key,
    key_type: 'none',
    ttl: -1,
    value: null,
  });
}

export async function redisSetValue(connectionId: string, key: string, value: string, ttl?: number): Promise<void> {
  return safeInvoke<void>('redis_set_value', { connectionId, key, value, ttl: ttl || null }, undefined);
}

export async function redisDeleteKey(connectionId: string, key: string): Promise<boolean> {
  return safeInvoke<boolean>('redis_delete_key', { connectionId, key }, true);
}

export async function mongodbListCollections(connectionId: string, database?: string): Promise<string[]> {
  return safeInvoke<string[]>('mongodb_list_collections', { connectionId, database: database || null }, []);
}

export async function mongodbFindDocuments(
  connectionId: string,
  collection: string,
  filterJson?: string,
  skip?: number,
  limit?: number
): Promise<QueryResult> {
  return safeInvoke<QueryResult>(
    'mongodb_find_documents',
    { connectionId, collection, filterJson: filterJson || null, skip: skip || null, limit: limit || 100 },
    {
      columns: [{ name: 'document', data_type: 'BSON Document', nullable: true, is_primary_key: false, is_foreign_key: false }],
      rows: [],
      affected_rows: 0,
      execution_time_ms: 0,
      command_type: 'MongoDB Find',
      warnings: [],
    }
  );
}

export async function mongodbInsertDocument(
  connectionId: string,
  collection: string,
  docJson: string | object
): Promise<string> {
  const jsonStr = typeof docJson === 'string' ? docJson : JSON.stringify(docJson);
  return safeInvoke<string>('mongodb_insert_document', { connectionId, collection, docJson: jsonStr }, '');
}

export async function sendDesktopNotification(title: string, body: string): Promise<void> {
  if (!isTauri()) {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch {}
    }
    return;
  }
  return safeInvoke<void>('send_desktop_notification', { title, body }, undefined);
}

export async function sftpCreateZipPure(
  connId: string,
  baseDir: string,
  items: string[],
  outputFilename: string
): Promise<string> {
  return safeInvoke<string>('sftp_create_zip_pure', { connId, baseDir, items, outputFilename }, '');
}

export async function sftpExtractArchivePure(
  connId: string,
  archivePath: string,
  destDir: string
): Promise<string> {
  return safeInvoke<string>('sftp_extract_archive_pure', { connId, archivePath, destDir }, '');
}

export async function dbExecuteOperation(
  connectionId: string,
  operation: DatabaseOperation
): Promise<OperationResult> {
  return safeInvoke<OperationResult>('db_execute_operation', { connectionId, operation }, {
    success: false,
    message: 'Operation not executed',
    affected_rows: 0,
    execution_time_ms: 0,
  });
}

export async function dbGetObjectDefinition(
  connectionId: string,
  objectType: string,
  name: string,
  schema?: string
): Promise<string> {
  return safeInvoke<string>('db_get_object_definition', { connectionId, objectType, name, schema: schema || null }, '');
}

export async function dbGetCapabilities(connectionId: string): Promise<ServerCapabilities> {
  return safeInvoke<ServerCapabilities>('db_get_capabilities', { connectionId }, {
    engine: 'unknown',
    server_version: '',
    supports_transactions: false,
    supports_schemas: false,
    supports_procedures: false,
    supports_functions: false,
    supports_triggers: false,
    supports_views: false,
    supports_indexes: false,
    supports_foreign_keys: false,
    supports_explain: false,
    supports_process_list: false,
    read_only: true,
    supports_rename_table: false,
    supports_alter_column: false,
  });
}

// ----------------- SSH Port Forwarding Tunnel Commands -----------------
export interface SshTunnelInfo {
  tunnel_id: string;
  conn_id: string;
  local_port: number;
  remote_host: string;
  remote_port: number;
  created_at: number;
}

export async function sshStartTunnel(
  connId: string,
  localPort: number = 0,
  remoteHost: string = '127.0.0.1',
  remotePort: number,
  tunnelType?: 'local' | 'remote' | 'dynamic'
): Promise<number> {
  return safeInvoke<number>(
    'ssh_start_tunnel',
    {
      connId,
      localPort: Number(localPort) || 0,
      remoteHost: remoteHost || '127.0.0.1',
      remotePort: Number(remotePort),
      tunnelType: tunnelType || 'local',
    },
    0
  );
}

export async function sshStopTunnel(tunnelId: string): Promise<void> {
  return safeInvoke<void>('ssh_stop_tunnel', { tunnelId }, undefined);
}

export async function sshListTunnels(): Promise<SshTunnelInfo[]> {
  return safeInvoke<SshTunnelInfo[]>('ssh_list_tunnels', {}, []);
}

export async function sshStartSocks5(
  connId: string,
  preferredPort?: number,
  username?: string,
  password?: string,
  requireAuth?: boolean
): Promise<number> {
  return safeInvoke<number>(
    'ssh_start_socks5',
    {
      connId,
      preferredPort: preferredPort ? Number(preferredPort) : undefined,
      username,
      password,
      requireAuth,
    },
    0
  );
}

export async function sshStopSocks5(connId: string): Promise<void> {
  return safeInvoke<void>('ssh_stop_socks5', { connId }, undefined);
}

export async function sshGetSocks5(connId: string): Promise<number | null> {
  return safeInvoke<number | null>('ssh_get_socks5', { connId }, null);
}

export async function openBrowserWindow(
  url: string,
  title?: string,
  proxyUrl?: string,
  windowId?: string
): Promise<string> {
  return safeInvoke<string>(
    'open_browser_window',
    { url, title, proxyUrl, windowId },
    ''
  );
}

export async function closeBrowserWindow(windowId: string): Promise<void> {
  return safeInvoke<void>('close_browser_window', { windowId }, undefined);
}

export async function focusBrowserWindow(windowId: string): Promise<void> {
  return safeInvoke<void>('focus_browser_window', { windowId }, undefined);
}

/**
 * Resolves a target URL into a proxied gateway URL when running in Web Mode (!isTauri()).
 * Routes requests through the remote SSH backend so the user's local PC browser
 * can reach localhost ports, internal services, and private subnets.
 */
export function getProxiedBrowserUrl(url: string, connId?: string | null): string {
  try {
    const trimmed = (url || '').trim();
    if (!trimmed || trimmed === 'about:blank' || trimmed === 'about:newtab') return trimmed;
    const fullUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `http://${trimmed}`;
    const parsed = new URL(fullUrl);
    const proto = parsed.protocol.replace(':', '');
    const port = parsed.port || (proto === 'https' ? '443' : '80');
    const targetConn = connId || 'default';
    const pathAndQuery = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    return `/api/browser/gateway/${encodeURIComponent(targetConn)}/${proto}/${parsed.hostname}:${port}${pathAndQuery}`;
  } catch {
    return url;
  }
}

export async function openExternalUrl(
  url: string,
  connId?: string | null,
  forceGateway?: boolean
): Promise<void> {
  try {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    }
  } catch (err) {
    console.warn('openExternalUrl plugin-shell failed:', err);
  }

  // In Web Mode (!isTauri()):
  // If target URL is localhost, 127.0.0.1, private server IP, or forceGateway is requested:
  // Route through the server's HTTP gateway so the user's PC browser tab reaches the remote server's service!
  const isLocalOrPrivate = 
    url.includes('localhost') || 
    url.includes('127.0.0.1') || 
    url.includes('0.0.0.0') ||
    /^(https?:\/\/)?(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(url);

  if (forceGateway || isLocalOrPrivate) {
    const proxiedUrl = getProxiedBrowserUrl(url, connId);
    window.open(proxiedUrl, '_blank');
    return;
  }

  window.open(url, '_blank');
}

// ----------------- API Studio (Native HTTP over SSH Tunnel) -----------------
export interface ApiHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiQueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiFormDataItem {
  key: string;
  value: string;
  item_type: 'text' | 'file';
  enabled: boolean;
}

export interface ApiRequestPayload {
  id?: string;
  conn_id?: string;
  use_ssh_tunnel: boolean;
  method: string;
  url: string;
  headers: ApiHeader[];
  query_params: ApiQueryParam[];
  body_type: 'none' | 'json' | 'text' | 'form-data' | 'x-www-form-urlencoded' | 'raw';
  raw_body?: string;
  form_data?: ApiFormDataItem[];
  timeout_seconds?: number;
  follow_redirects?: boolean;
  verify_ssl?: boolean;
}

export interface ApiResponsePayload {
  status: number;
  status_text: string;
  headers: Record<string, string>;
  body: string;
  is_json: boolean;
  is_binary: boolean;
  size_bytes: number;
  duration_ms: number;
  tunnel_used: boolean;
  tunneled_target?: string;
  effective_url: string;
}

export async function apiSendRequest(req: ApiRequestPayload): Promise<ApiResponsePayload> {
  return safeInvoke<ApiResponsePayload>('api_send_request', { req }, {
    status: 0,
    status_text: 'Failed to send request',
    headers: {},
    body: 'Error: Request could not be sent. Please ensure the backend is running.',
    is_json: false,
    is_binary: false,
    size_bytes: 0,
    duration_ms: 0,
    tunnel_used: false,
    effective_url: req.url,
  });
}

// ----------------- Web Auth & Server Security (1-Hour Expiration) -----------------
export interface AuthStatusResponse {
  is_configured: boolean;
  is_authenticated: boolean;
  must_change_password: boolean;
  totp_enabled?: boolean;
  is_first_login?: boolean;
  initial_credentials_cmd?: string;
  username: string;
  storage_path: string;
  expires_in_seconds?: number;
  session_duration_seconds?: number;
  session_expired?: boolean;
}

export interface AuthActionResult {
  success: boolean;
  must_change_password: boolean;
  mfa_required?: boolean;
  username: string;
  token?: string;
  expires_at?: number;
  expires_in_seconds?: number;
  message?: string;
}

export interface TotpSetupResponse {
  secret: string;
  otpauth_url: string;
  totp_enabled: boolean;
}

export interface ScopedApiToken {
  id: string;
  name: string;
  role: 'admin' | 'operator' | 'read_only';
  prefix: string;
  createdAt?: string;
  created_at?: string;
  expiresAt?: string | null;
  expires_at?: string | null;
  revoked: boolean;
}

export async function authGetStatus(): Promise<AuthStatusResponse> {
  const hasChanged = localStorage.getItem('sshdesktop_credentials_changed') === 'true';
  const customUser = localStorage.getItem('sshdesktop_custom_uname');
  return safeInvoke<AuthStatusResponse>('auth_get_status', {}, {
    is_configured: true,
    is_authenticated: false,
    must_change_password: !hasChanged,
    is_first_login: !hasChanged,
    initial_credentials_cmd: 'sudo cat /var/lib/sshdesktop/initial-admin-credentials.txt',
    username: hasChanged ? (customUser || '') : 'admin',
    storage_path: '/var/lib/sshdesktop/auth.json',
  });
}

export async function authLogin(username: string, password: string, totpCode?: string): Promise<AuthActionResult> {
  return safeInvoke<AuthActionResult>('auth_login', {
    username,
    password,
    totpCode: totpCode || undefined,
    totp_code: totpCode || undefined,
  }, {
    success: false,
    must_change_password: false,
    username,
    message: 'Authentication unavailable',
  });
}

export async function authTotpSetup(): Promise<TotpSetupResponse> {
  return safeInvoke<TotpSetupResponse>('auth_totp_setup', {}, {
    secret: '',
    otpauth_url: '',
    totp_enabled: false,
  });
}

export async function authTotpEnable(secret: string, code: string): Promise<boolean> {
  return safeInvoke<boolean>('auth_totp_enable', { secret, code }, false);
}

export async function authTotpDisable(password: string, code: string): Promise<boolean> {
  return safeInvoke<boolean>('auth_totp_disable', { password, code }, false);
}

export async function authChangeCredentials(currentPassword: string, newUsername: string, newPassword: string): Promise<AuthActionResult> {
  return safeInvoke<AuthActionResult>('auth_change_credentials', {
    currentPassword,
    newUsername,
    newPassword,
  }, {
    success: false,
    must_change_password: false,
    username: newUsername,
    message: 'Change credentials unavailable',
  });
}

export async function authLogout(): Promise<boolean> {
  const session = getStoredSession();
  clearStoredSession();
  return safeInvoke<boolean>('auth_logout', { token: session?.token }, true);
}

// ----------------- Browser Reverse Proxy -----------------
export interface ProxiedPageResponse {
  status: number;
  content_type: string;
  body: string;
  final_url: string;
}

export async function browserProxyFetch(url: string): Promise<ProxiedPageResponse> {
  return safeInvoke<ProxiedPageResponse>('browser_proxy_fetch', { url }, {
    status: 500,
    content_type: 'text/html',
    body: '<html><body><h3>Proxy unavailable</h3></body></html>',
    final_url: url,
  });
}





// ----------------- OpenSSH Standard Authentication & Config -----------------

export interface SshConfigHost {
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identity_file?: string;
  identities_only?: boolean;
  proxy_jump?: string;
}

export interface HostKeyVerification {
  status: 'trusted' | 'not_found' | 'changed' | 'failed' | 'error';
  key_type?: string;
  fingerprint_sha256?: string;
  raw_public_key_b64?: string;
  known_key_type?: string;
  known_fingerprint_sha256?: string;
  message: string;
}

export interface GeneratedKeyPair {
  private_key_path: string;
  public_key_path: string;
  public_key_content: string;
  fingerprint_sha256: string;
}

export interface LocalKeyInfo {
  filename: string;
  full_path: string;
  has_public: boolean;
  key_type: string;
  fingerprint_sha256?: string;
}

export interface AgentKey {
  bits: string;
  fingerprint: string;
  comment: string;
  algorithm: string;
}

export interface SshAgentStatus {
  is_running: boolean;
  keys: AgentKey[];
  message: string;
}

export async function sshConfigGetPath(): Promise<string> {
  return safeInvoke<string>('ssh_config_get_path', {}, '');
}

export async function sshConfigReadHosts(): Promise<SshConfigHost[]> {
  return safeInvoke<SshConfigHost[]>('ssh_config_read_hosts', {}, []);
}

export async function sshConfigSaveHost(host: SshConfigHost): Promise<void> {
  return safeInvoke<void>('ssh_config_save_host', { host }, undefined);
}

export async function sshVerifyHostKey(host: string, port: number = 22): Promise<HostKeyVerification> {
  return safeInvoke<HostKeyVerification>('ssh_verify_host_key', { host, port }, {
    status: 'failed',
    message: 'Host key verification failed or unavailable',
  });
}

export async function sshTrustHostKey(
  host: string,
  port: number,
  keyType: string,
  publicKeyB64: string,
): Promise<void> {
  return safeInvoke<void>('ssh_trust_host_key', {
    host,
    port,
    keyType,
    publicKeyB64,
  }, undefined);
}

export async function sshGenerateKeyPair(
  filename?: string,
  comment?: string,
  passphrase?: string,
): Promise<GeneratedKeyPair> {
  return safeInvoke<GeneratedKeyPair>('ssh_generate_key_pair', {
    filename,
    comment,
    passphrase,
  }, {
    private_key_path: '',
    public_key_path: '',
    public_key_content: '',
    fingerprint_sha256: '',
  });
}

export async function sshListLocalKeys(): Promise<LocalKeyInfo[]> {
  return safeInvoke<LocalKeyInfo[]>('ssh_list_local_keys', {}, []);
}

export async function sshInstallPublicKey(connId: string, publicKey: string): Promise<string> {
  return safeInvoke<string>('ssh_install_public_key', { connId, publicKey }, '');
}

export async function sshAgentGetStatus(): Promise<SshAgentStatus> {
  return safeInvoke<SshAgentStatus>('ssh_agent_get_status', {}, {
    is_running: false,
    keys: [],
    message: 'SSH agent status unavailable',
  });
}

// ----------------- Enterprise Governance: Audit Trail, Policy, Capabilities & Backup -----------------
export interface WorkspaceAuditEntry {
  ts: string;
  event: string;
  username?: string;
  target?: string;
  status?: string;
  details?: string;
  ip?: string;
  prev_hash?: string;
  hash?: string;
}

export interface AuditChainVerification {
  valid: boolean;
  total: number;
  verified: number;
  brokenAt?: number | null;
  broken_at?: number | null;
  reason?: string | null;
}

export interface WorkspaceSecurityPolicy {
  role: 'admin' | 'operator' | 'read_only';
  blockMetadataEgress: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
}

export async function auditGetLogs(limit = 200): Promise<WorkspaceAuditEntry[]> {
  return safeInvoke<WorkspaceAuditEntry[]>('audit_get_logs', { limit }, []);
}

export async function auditVerifyChain(): Promise<AuditChainVerification> {
  return safeInvoke<AuditChainVerification>('audit_verify_chain', {}, {
    valid: false,
    total: 0,
    verified: 0,
    reason: 'Verification unavailable',
  });
}

export async function auditExportSiem(format: 'cef' | 'syslog' | 'ndjson'): Promise<string> {
  return safeInvoke<string>('audit_export_siem', { format }, '');
}

export async function policyGetMode(): Promise<WorkspaceSecurityPolicy> {
  return safeInvoke<WorkspaceSecurityPolicy>('policy_get_mode', {}, {
    role: 'admin',
    blockMetadataEgress: true,
  });
}

export async function policySetMode(role: 'admin' | 'operator' | 'read_only', blockMetadataEgress = true): Promise<WorkspaceSecurityPolicy> {
  return safeInvoke<WorkspaceSecurityPolicy>('policy_set_mode', {
    role,
    block_metadata_egress: blockMetadataEgress,
    blockMetadataEgress,
  }, { role, blockMetadataEgress });
}

export async function getRuntimeCapabilities(): Promise<any> {
  return safeInvoke<any>('runtime_capabilities', {}, null);
}

export async function backupExportConfig(): Promise<any> {
  return safeInvoke<any>('backup_export_config', {}, null);
}

export async function backupImportConfig(bundle: any): Promise<any> {
  return safeInvoke<any>('backup_import_config', { bundle }, { imported: false });
}

export async function tokensList(): Promise<ScopedApiToken[]> {
  return safeInvoke<ScopedApiToken[]>('tokens_list', {}, []);
}

export async function tokensCreate(
  name: string,
  role: 'admin' | 'operator' | 'read_only',
  expiresInDays?: number,
): Promise<ScopedApiToken & { token: string }> {
  return safeInvoke<ScopedApiToken & { token: string }>('tokens_create', {
    name,
    role,
    expiresInDays,
    expires_in_days: expiresInDays,
  }, {
    id: '',
    name,
    role,
    prefix: '',
    token: '',
    revoked: false,
  });
}

export async function tokensRevoke(id: string): Promise<boolean> {
  return safeInvoke<boolean>('tokens_revoke', { id }, false);
}

export async function vaultRotateKey(): Promise<{ rotated: boolean; entriesReencrypted?: number }> {
  return safeInvoke<{ rotated: boolean; entriesReencrypted?: number }>('vault_rotate_key', {}, { rotated: false });
}

export interface TeamMember {
  username: string;
  role: 'admin' | 'operator' | 'read_only';
  disabled: boolean;
  created_at: number;
  last_login_at?: number | null;
}

export interface SsoOidcConfig {
  enabled: boolean;
  provider_name: string;
  issuer_url: string;
  client_id: string;
  redirect_uri: string;
  default_role: 'admin' | 'operator' | 'read_only';
}

export interface CommandApprovalRecord {
  id: string;
  action: string;
  target: string;
  reason: string;
  requested_by: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by?: string | null;
  created_at: string;
  decided_at?: string | null;
}

export interface SessionRecordingMeta {
  id: string;
  title: string;
  host: string;
  bytes: number;
  created_at: string;
}

export async function teamList(): Promise<TeamMember[]> {
  return safeInvoke<TeamMember[]>('team_list', {}, []);
}

export async function teamAdd(
  username: string,
  password: string,
  role: 'admin' | 'operator' | 'read_only',
): Promise<TeamMember> {
  return safeInvoke<TeamMember>('team_add', { username, password, role }, {
    username,
    role,
    disabled: false,
    created_at: 0,
  });
}

export async function teamSetRole(
  username: string,
  role: 'admin' | 'operator' | 'read_only',
  disabled?: boolean,
): Promise<boolean> {
  return safeInvoke<boolean>('team_set_role', { username, role, disabled }, false);
}

export async function teamRemove(username: string): Promise<boolean> {
  return safeInvoke<boolean>('team_remove', { username }, false);
}

export async function ssoGetConfig(): Promise<SsoOidcConfig> {
  return safeInvoke<SsoOidcConfig>('sso_get_config', {}, {
    enabled: false,
    provider_name: 'OIDC Identity Provider',
    issuer_url: '',
    client_id: '',
    redirect_uri: '',
    default_role: 'read_only',
  });
}

export async function ssoSetConfig(config: SsoOidcConfig): Promise<SsoOidcConfig> {
  return safeInvoke<SsoOidcConfig>('sso_set_config', { config, ...config }, config);
}

export async function approvalRequest(action: string, target: string, reason = ''): Promise<CommandApprovalRecord> {
  return safeInvoke<CommandApprovalRecord>('approval_request', { action, target, reason }, {
    id: '',
    action,
    target,
    reason,
    requested_by: '',
    status: 'pending',
    created_at: new Date().toISOString(),
  });
}

export async function approvalList(): Promise<CommandApprovalRecord[]> {
  return safeInvoke<CommandApprovalRecord[]>('approval_list', {}, []);
}

export async function approvalDecide(
  id: string,
  decision: 'approved' | 'rejected',
): Promise<CommandApprovalRecord | null> {
  return safeInvoke<CommandApprovalRecord | null>('approval_decide', { id, decision }, null);
}

export async function recordingsList(): Promise<SessionRecordingMeta[]> {
  return safeInvoke<SessionRecordingMeta[]>('recordings_list', {}, []);
}

export async function recordingsSave(
  title: string,
  host: string,
  contentCast: string,
): Promise<SessionRecordingMeta> {
  return safeInvoke<SessionRecordingMeta>('recordings_save', {
    title,
    host,
    contentCast,
    content_cast: contentCast,
  }, {
    id: '',
    title,
    host,
    bytes: contentCast.length,
    created_at: new Date().toISOString(),
  });
}

export async function recordingsGet(id: string): Promise<string> {
  return safeInvoke<string>('recordings_get', { id }, '');
}

export async function sshRotateServerKey(
  connId: string,
  oldPublicKey?: string,
  filename?: string,
  comment?: string,
  passphrase?: string,
): Promise<GeneratedKeyPair> {
  return safeInvoke<GeneratedKeyPair>('ssh_rotate_server_key', {
    connId,
    oldPublicKey,
    old_public_key: oldPublicKey,
    filename,
    comment,
    passphrase,
  }, {
    private_key_path: '',
    public_key_path: '',
    public_key_content: '',
    fingerprint_sha256: '',
  });
}

// ----------------- Centralized Application Lifecycle & Shutdown -----------------
export async function appExitClean(): Promise<void> {
  if (isTauri()) {
    try {
      await safeInvoke<void>('app_request_shutdown', {}, undefined);
    } catch {
      try {
        const { exit } = await import('@tauri-apps/api/app');
        await exit(0);
      } catch {
        window.close();
      }
    }
  } else {
    window.close();
  }
}

