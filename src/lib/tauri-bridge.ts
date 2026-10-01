import { invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function safeInvoke<T>(cmd: string, args: Record<string, any> = {}, fallback: T): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err) {
      console.error(`[CloudDesk Tauri] Command '${cmd}' failed:`, err);
      throw err;
    }
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

// ----------------- Terminal Commands -----------------
export async function terminalCreate(connId: string, rows: number = 24, cols: number = 80): Promise<string> {
  return safeInvoke<string>('terminal_create', { connId, rows, cols }, 'term-1');
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
  try {
    return await safeInvoke<any[]>('sftp_list_dir', { connId, path }, []);
  } catch {
    return [];
  }
}

export async function sftpReadTextFile(connId: string, path: string): Promise<string> {
  return safeInvoke<string>('sftp_read_text_file', { connId, path }, '');
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

export async function groupList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('group_list', { connId }, []);
  } catch {
    return [];
  }
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

export async function firewallStatus(connId: string): Promise<string> {
  return safeInvoke<string>('firewall_status', { connId }, 'Status: active');
}

export async function firewallRules(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('firewall_rules', { connId }, []);
  } catch {
    return [];
  }
}

export async function firewallAddRule(connId: string, port: string, protocol: string, action: string): Promise<string> {
  return safeInvoke<string>('firewall_add_rule', { connId, port, protocol, action }, '');
}

export async function firewallDeleteRule(connId: string, ruleNumber: number): Promise<string> {
  return safeInvoke<string>('firewall_delete_rule', { connId, ruleNumber }, '');
}

export async function firewallToggle(connId: string, enable: boolean): Promise<string> {
  return safeInvoke<string>('firewall_toggle', { connId, enable }, '');
}

export async function diskList(connId: string): Promise<any[]> {
  try {
    return await safeInvoke<any[]>('disk_list', { connId }, []);
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
