import { invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function safeInvoke<T>(cmd: string, args: Record<string, any> = {}, fallback: T): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      console.warn(`[CloudDesk Tauri] Command '${cmd}' failed:`, err);
      return fallback;
    }
  }
  return fallback;
}

// ----------------- SSH Commands -----------------
export async function sshConnect(config: any): Promise<string> {
  return safeInvoke<string>('ssh_connect', { config }, 'demo-conn-id');
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
  return safeInvoke('ssh_exec', { connId, command }, {
    stdout: `Executed: ${command}\n`,
    stderr: '',
    exit_code: 0,
    duration_ms: 24,
  });
}

// ----------------- Terminal Commands -----------------
export async function terminalCreate(connId: string, rows: number = 24, cols: number = 80): Promise<string> {
  return safeInvoke<string>('terminal_create', { connId, rows, cols }, 'term-default');
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
  return safeInvoke<string>('sftp_read_text_file', { connId, path }, '# Empty file\n');
}

export async function sftpWriteTextFile(connId: string, path: string, content: string): Promise<void> {
  return safeInvoke<void>('sftp_write_text_file', { connId, path, content }, undefined);
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

// ----------------- System Commands -----------------
export async function systemGetStats(connId: string = 'default'): Promise<any> {
  return safeInvoke<any>('system_get_stats', { connId }, {
    cpu_percent: [18.4, 14.2, 22.1, 16.5],
    ram_total: 16 * 1024 * 1024 * 1024,
    ram_used: 6 * 1024 * 1024 * 1024,
    ram_free: 7 * 1024 * 1024 * 1024,
    ram_cached: 3 * 1024 * 1024 * 1024,
    swap_total: 2 * 1024 * 1024 * 1024,
    swap_used: 0,
    load_avg: [0.14, 0.08, 0.05],
    uptime_seconds: 32 * 86400,
    hostname: 'clouddesk-node',
    os_name: 'Ubuntu',
    os_version: '24.04 LTS',
    kernel: '6.8.0-generic',
    arch: 'x86_64',
  });
}

export async function systemGetDisks(connId: string = 'default'): Promise<any[]> {
  return safeInvoke<any[]>('system_get_disks', { connId }, []);
}

export async function systemGetNetwork(connId: string = 'default'): Promise<any[]> {
  return safeInvoke<any[]>('system_get_network', { connId }, []);
}

export async function processList(connId: string = 'default'): Promise<any[]> {
  return safeInvoke<any[]>('process_list', { connId }, []);
}

export async function processKill(connId: string, pid: number, signal: string): Promise<void> {
  return safeInvoke<void>('process_kill', { connId, pid, signal }, undefined);
}

export async function processRenice(connId: string, pid: number, value: number): Promise<void> {
  return safeInvoke<void>('process_renice', { connId, pid, value }, undefined);
}

export async function serviceList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('service_list', { connId }, []);
}

export async function serviceAction(connId: string, name: string, action: string): Promise<string> {
  return safeInvoke<string>('service_action', { connId, name, action }, `Action ${action} executed`);
}

export async function serviceStatus(connId: string, name: string): Promise<string> {
  return safeInvoke<string>('service_status', { connId, name }, '');
}

export async function serviceLogs(connId: string, name: string, lines: number): Promise<string> {
  return safeInvoke<string>('service_logs', { connId, name, lines }, '');
}

export async function dockerContainers(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('docker_containers', { connId }, []);
}

export async function dockerAction(connId: string, containerId: string, action: string): Promise<string> {
  return safeInvoke<string>('docker_action', { connId, containerId, action }, `Docker ${action} completed`);
}

export async function dockerLogs(connId: string, containerId: string, lines: number): Promise<string> {
  return safeInvoke<string>('docker_logs', { connId, containerId, lines }, '');
}

export async function dockerImages(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('docker_images', { connId }, []);
}

export async function networkPorts(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('network_ports', { connId }, []);
}

export async function networkConnections(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('network_connections', { connId }, []);
}

export async function networkPing(connId: string, host: string): Promise<string> {
  return safeInvoke<string>('network_ping', { connId, host }, '');
}

export async function networkDnsLookup(connId: string, domain: string): Promise<string> {
  return safeInvoke<string>('network_dns_lookup', { connId, domain }, '');
}

export async function packageList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('package_list', { connId }, []);
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
  return safeInvoke<any[]>('package_upgradable', { connId }, []);
}

export async function userList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('user_list', { connId }, []);
}

export async function userAdd(connId: string, username: string, shell?: string, groups?: string[]): Promise<void> {
  return safeInvoke<void>('user_add', { connId, username, shell, groups }, undefined);
}

export async function userDelete(connId: string, username: string, removeHome: boolean = false): Promise<void> {
  return safeInvoke<void>('user_delete', { connId, username, removeHome }, undefined);
}

export async function groupList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('group_list', { connId }, []);
}

export async function cronList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('cron_list', { connId }, []);
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

export async function firewallStatus(connId: string): Promise<string> {
  return safeInvoke<string>('firewall_status', { connId }, 'Status: active');
}

export async function firewallRules(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('firewall_rules', { connId }, []);
}

export async function firewallAddRule(connId: string, port: string, protocol: string, action: string): Promise<string> {
  return safeInvoke<string>('firewall_add_rule', { connId, port, protocol, action }, 'Rule added');
}

export async function firewallDeleteRule(connId: string, ruleNumber: number): Promise<string> {
  return safeInvoke<string>('firewall_delete_rule', { connId, ruleNumber }, 'Rule deleted');
}

export async function firewallToggle(connId: string, enable: boolean): Promise<string> {
  return safeInvoke<string>('firewall_toggle', { connId, enable }, `Firewall ${enable ? 'enabled' : 'disabled'}`);
}

export async function diskList(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('disk_list', { connId }, []);
}

export async function diskUsage(connId: string): Promise<any[]> {
  return safeInvoke<any[]>('disk_usage', { connId }, []);
}

export async function diskSmart(connId: string, device: string): Promise<string> {
  return safeInvoke<string>('disk_smart', { connId, device }, 'SMART Status: PASSED');
}

export async function diskLargestDirs(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('disk_largest_dirs', { connId, path }, '');
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
