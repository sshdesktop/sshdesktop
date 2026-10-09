import { invoke } from '@tauri-apps/api/core';

export function isTauri(): boolean {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

export async function safeInvoke<T>(cmd: string, args: Record<string, any> = {}, fallback: T): Promise<T> {
  if (isTauri()) {
    try {
      return await invoke<T>(cmd, args);
    } catch (err: any) {
      console.error(`[CloudDesk Tauri] Command '${cmd}' failed:`, err);
      const errMsg = String(err?.message || err);
      if (
        errMsg.includes('No active SSH connection') || 
        errMsg.includes('Connection closed') || 
        errMsg.includes('connection reset') || 
        errMsg.includes('broken pipe')
      ) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('clouddesk-ssh-disconnected', { detail: { reason: errMsg } }));
        }
      }
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

export async function sshLaunchPutty(connId: string, remoteDir?: string): Promise<void> {
  return safeInvoke<void>('ssh_launch_putty', { connId, remoteDir: remoteDir || null }, undefined);
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

export async function pickKeyFile(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'SSH Private Keys (*.pem, *.ppk, id_rsa, id_ed25519)',
            extensions: ['pem', 'ppk', 'key', 'id_rsa', 'id_ed25519', '*']
          }
        ]
      });
      if (selected && typeof selected === 'string') {
        return selected;
      }
    } catch (e) {
      console.warn('[CloudDesk] Failed to open native file picker:', e);
    }
  }
  return null;
}

// ----------------- Native Database Commands (Direct Drivers + SSH Tunnel) -----------------
export interface DatabaseConnectionConfig {
  id: string;
  name: string;
  engine: 'mysql' | 'mariadb' | 'postgresql' | 'sqlite' | 'mssql' | 'mongodb' | 'redis' | string;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  schema?: string;
  use_ssh?: boolean;
  ssh_connection_id?: string;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_password?: string;
  ssh_key_path?: string;
  sqlite_path?: string;
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

export interface QueryResult {
  columns: ColumnMeta[];
  rows: any[];
  affected_rows: number;
  last_insert_id?: number | null;
  execution_time_ms: number;
  command_type: string;
  server_version?: string | null;
  warnings: string[];
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

export async function dbGetTableColumns(connectionId: string, tableName: string): Promise<ColumnMeta[]> {
  return safeInvoke<ColumnMeta[]>('db_get_table_columns', { connectionId, tableName }, []);
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

export async function mongodbListCollections(connectionId: string): Promise<string[]> {
  return safeInvoke<string[]>('mongodb_list_collections', { connectionId }, []);
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
  docJson: string
): Promise<string> {
  return safeInvoke<string>('mongodb_insert_document', { connectionId, collection, docJson }, '');
}
