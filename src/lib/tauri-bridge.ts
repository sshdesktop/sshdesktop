import { invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function safeInvoke<T>(cmd: string, args: Record<string, any> = {}, fallback: T): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err: any) {
      console.error(`[SSH Desktop Tauri] Command '${cmd}' failed:`, err);
      const errMsg = String(err?.message || err);
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

      if (isConnectionLoss && cmd !== 'ssh_test_connection' && cmd !== 'ssh_disconnect' && cmd !== 'store_delete_connection') {
        if (typeof window !== 'undefined') {
          const detail = { 
            connId: args?.connId,
            command: cmd,
            reason: errMsg 
          };
          window.dispatchEvent(new CustomEvent('sshdesktop-ssh-disconnected', { detail }));
          window.dispatchEvent(new CustomEvent('clouddesk-ssh-disconnected', { detail }));
        }
      }
      throw err;
    }
  }

  // When running in a standard web browser (http://localhost:1420) without native Tauri runtime:
  if (cmd === 'ssh_connect' || cmd === 'ssh_test_connection' || cmd === 'terminal_create') {
    throw new Error(
      'Native Desktop Runtime Required: Standard web browser tabs (http://localhost:1420) cannot open raw SSH sockets (port 22) or spawn PTY processes directly. Please launch the SSH Desktop application (sshdesktop.exe) or run "npm run tauri:dev".'
    );
  }
  return fallback;
}

// ----------------- SSH Commands -----------------
export async function sshConnect(config: any): Promise<string> {
  return safeInvoke<string>('ssh_connect', { config }, '');
}

export async function sshDisconnect(connId: string): Promise<void> {
  return safeInvoke<void>('ssh_disconnect', { connId }, undefined);
}

export async function sshListConnections(): Promise<any[]> {
  return safeInvoke<any[]>('ssh_list_connections', {}, []);
}

export async function sshTestConnection(config: any): Promise<boolean> {
  return safeInvoke<boolean>('ssh_test_connection', { config }, true);
}

export async function sshExec(connId: string, command: string): Promise<{ stdout: string; stderr: string; exit_code: number; duration_ms: number }> {
  try {
    return await safeInvoke('ssh_exec', { connId, command }, {
      stdout: '',
      stderr: '',
      exit_code: 0,
      duration_ms: 0,
    });
  } catch (err: any) {
    return {
      stdout: '',
      stderr: String(err?.message || err),
      exit_code: 1,
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
  return safeInvoke<string>('terminal_create', { connId, rows, cols, terminalId }, terminalId || 'term-1');
}

export async function terminalWrite(terminalId: string, data: number[]): Promise<void> {
  return safeInvoke<void>('terminal_write', { terminalId, data }, undefined);
}

export async function terminalResize(terminalId: string, rows: number, cols: number): Promise<void> {
  return safeInvoke<void>('terminal_resize', { terminalId, rows, cols }, undefined);
}

export async function terminalClose(terminalId: string): Promise<void> {
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

export async function sftpWriteTextFile(connId: string, path: string, content: string): Promise<void> {
  return safeInvoke<void>('sftp_write_text_file', { connId, path, content }, undefined);
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

export async function processKill(connId: string, pid: number, signal: string): Promise<void> {
  return safeInvoke<void>('process_kill', { connId, pid, signal }, undefined);
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

export async function userAdd(connId: string, username: string, shell?: string, groups?: string[]): Promise<void> {
  return safeInvoke<void>('user_add', { connId, username, shell, groups }, undefined);
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
            name: 'OpenSSH Private Keys (*.pem, id_rsa, id_ed25519)',
            extensions: ['pem', 'key', 'id_rsa', 'id_ed25519', 'id_ecdsa', '*']
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
  return null;
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
    engine: 'mysql',
    server_version: '',
    supports_transactions: true,
    supports_schemas: false,
    supports_procedures: true,
    supports_functions: true,
    supports_triggers: true,
    supports_views: true,
    supports_indexes: true,
    supports_foreign_keys: true,
    supports_explain: true,
    supports_process_list: true,
    read_only: false,
    supports_rename_table: true,
    supports_alter_column: true,
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
  preferredPort?: number
): Promise<number> {
  return safeInvoke<number>(
    'ssh_start_socks5',
    {
      connId,
      preferredPort: preferredPort ? Number(preferredPort) : undefined,
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

export async function openExternalUrl(url: string): Promise<void> {
  try {
    if (isTauri()) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    }
  } catch (err) {
    console.warn('openExternalUrl plugin-shell failed:', err);
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



