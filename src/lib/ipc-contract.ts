export type AppErrorCode =
  | 'POLICY_DENIED'
  | 'UNSUPPORTED_IN_WEB_MODE'
  | 'SESSION_EXPIRED'
  | 'CONFLICT_DETECTED'
  | 'PROCESS_IDENTITY_MISMATCH'
  | 'HOST_KEY_UNTRUSTED'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

export class SshDesktopError extends Error {
  readonly code: AppErrorCode;
  readonly command?: string;
  readonly httpStatus?: number;

  constructor(code: AppErrorCode, message: string, command?: string, httpStatus?: number) {
    super(message);
    this.name = 'SshDesktopError';
    this.code = code;
    this.command = command;
    this.httpStatus = httpStatus;
  }
}

export function parseAppError(err: unknown, command?: string, httpStatus?: number): SshDesktopError {
  if (err instanceof SshDesktopError) return err;
  const rawMsg = err instanceof Error ? err.message : String(err ?? 'Unknown IPC error');
  const upper = rawMsg.toUpperCase();

  let code: AppErrorCode = 'UNKNOWN';
  if (err instanceof Error && err.name === 'AbortError') {
    code = 'CANCELLED';
  } else if (httpStatus === 401 || upper.includes('SESSION_EXPIRED') || upper.includes('SESSION HAS EXPIRED')) {
    code = 'SESSION_EXPIRED';
  } else if (upper.includes('POLICY_DENIED')) {
    code = 'POLICY_DENIED';
  } else if (upper.includes('UNSUPPORTED_IN_WEB_MODE')) {
    code = 'UNSUPPORTED_IN_WEB_MODE';
  } else if (upper.includes('CONFLICT_DETECTED')) {
    code = 'CONFLICT_DETECTED';
  } else if (upper.includes('PROCESS_IDENTITY_MISMATCH')) {
    code = 'PROCESS_IDENTITY_MISMATCH';
  } else if (upper.includes('HOST_KEY') || upper.includes('KNOWN_HOSTS') || upper.includes('SECURITY ALERT')) {
    code = 'HOST_KEY_UNTRUSTED';
  } else if (upper.includes('TIMED OUT') || upper.includes('TIMEOUT')) {
    code = 'TIMEOUT';
  } else if (upper.includes('FAILED TO FETCH') || upper.includes('NETWORKERROR') || upper.includes('ECONNREFUSED')) {
    code = 'NETWORK_ERROR';
  }

  return new SshDesktopError(code, rawMsg, command, httpStatus);
}

export interface RetryTimeoutOptions {
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
}

export async function withRetryAndTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: RetryTimeoutOptions = {},
): Promise<T> {
  const timeoutMs = Math.max(250, options.timeoutMs ?? 30_000);
  const maxRetries = Math.max(0, Math.min(4, options.retries ?? 0));
  const baseDelayMs = Math.max(50, options.baseDelayMs ?? 300);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) {
      throw new SshDesktopError('CANCELLED', 'Operation was cancelled.');
    }

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race<T>([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            'abort',
            () => {
              const err = options.signal?.aborted
                ? new SshDesktopError('CANCELLED', 'Operation cancelled by caller.')
                : new SshDesktopError('TIMEOUT', `Operation timed out after ${timeoutMs}ms.`);
              reject(err);
            },
            { once: true },
          );
        }),
      ]);
      return result;
    } catch (err) {
      lastErr = err;
      const parsed = parseAppError(err);
      if (parsed.code === 'CANCELLED' || parsed.code === 'POLICY_DENIED' || parsed.code === 'SESSION_EXPIRED' || attempt === maxRetries) {
        throw parsed;
      }
      const jitter = Math.floor(Math.random() * 80);
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt + jitter));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onParentAbort);
    }
  }
  throw parseAppError(lastErr);
}

export interface CommandContractSpec {
  domain:
    | 'auth'
    | 'audit'
    | 'ssh'
    | 'terminal'
    | 'sftp'
    | 'system'
    | 'process'
    | 'service'
    | 'docker'
    | 'network'
    | 'package'
    | 'user'
    | 'cron'
    | 'logs'
    | 'firewall'
    | 'disk'
    | 'store'
    | 'database'
    | 'api'
    | 'browser'
    | 'app';
  mutating: boolean;
  webSupported: boolean;
  defaultTimeoutMs: number;
}

/**
 * Canonical cross-backend IPC command registry enforced identically
 * across src-tauri/src/main.rs (Rust) and server.js (Node.js).
 */
export const UNIFIED_COMMAND_CONTRACT: Record<string, CommandContractSpec> = {
  // Authentication & Security Policy
  auth_get_status: { domain: 'auth', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  auth_login: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  auth_change_credentials: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  auth_logout: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  auth_totp_setup: { domain: 'auth', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  auth_totp_enable: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  auth_totp_disable: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  audit_get_logs: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  audit_verify_chain: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  audit_export_siem: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  policy_get_mode: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  policy_set_mode: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  runtime_capabilities: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  backup_export_config: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  backup_import_config: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  tokens_list: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  tokens_create: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  tokens_revoke: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  vault_rotate_key: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  team_list: { domain: 'auth', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  team_add: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  team_set_role: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  team_remove: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  sso_get_config: { domain: 'auth', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  sso_set_config: { domain: 'auth', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  approval_request: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  approval_list: { domain: 'audit', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  approval_decide: { domain: 'audit', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  recordings_list: { domain: 'terminal', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  recordings_save: { domain: 'terminal', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  recordings_get: { domain: 'terminal', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },

  // SSH Connections, Keys, Tunnels & Execution
  ssh_connect: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  ssh_disconnect: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_list_connections: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_test_connection: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  ssh_get_user_privilege: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_exec: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 60_000 },
  ssh_exec_stream: { domain: 'ssh', mutating: true, webSupported: false, defaultTimeoutMs: 60_000 },
  ssh_exec_stop: { domain: 'ssh', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  ssh_start_tunnel: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_stop_tunnel: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_list_tunnels: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_start_socks5: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_stop_socks5: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_get_socks5: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_verify_host_key: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_trust_host_key: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_generate_key_pair: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_list_local_keys: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_install_public_key: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  ssh_rotate_server_key: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  ssh_config_get_path: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_config_read_hosts: { domain: 'ssh', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_config_save_host: { domain: 'ssh', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_agent_get_status: { domain: 'ssh', mutating: false, webSupported: false, defaultTimeoutMs: 10_000 },

  // Terminal
  terminal_create: { domain: 'terminal', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  terminal_write: { domain: 'terminal', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  terminal_resize: { domain: 'terminal', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  terminal_close: { domain: 'terminal', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  ssh_launch_putty: { domain: 'terminal', mutating: false, webSupported: false, defaultTimeoutMs: 10_000 },

  // SFTP & Archives
  sftp_list_dir: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  sftp_read_file: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  sftp_read_text_file: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  sftp_read_file_base64: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 45_000 },
  sftp_write_file: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 45_000 },
  sftp_write_text_file: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 45_000 },
  sftp_mkdir: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  sftp_delete: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  sftp_rename: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  sftp_chmod: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  sftp_chown: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  sftp_stat: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  sftp_folder_size: { domain: 'sftp', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  sftp_create_zip_pure: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 120_000 },
  sftp_extract_archive_pure: { domain: 'sftp', mutating: true, webSupported: true, defaultTimeoutMs: 120_000 },
  sftp_download: { domain: 'sftp', mutating: false, webSupported: false, defaultTimeoutMs: 60_000 },
  sftp_download_to_downloads: { domain: 'sftp', mutating: false, webSupported: false, defaultTimeoutMs: 60_000 },
  sftp_upload: { domain: 'sftp', mutating: true, webSupported: false, defaultTimeoutMs: 60_000 },

  // System Monitoring, Processes, Services, Docker, Network, Packages, Users, Cron, Logs, Firewall, Disk
  system_get_stats: { domain: 'system', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  system_get_disks: { domain: 'system', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  system_get_network: { domain: 'system', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  process_list: { domain: 'process', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  process_kill: { domain: 'process', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  process_renice: { domain: 'process', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  service_list: { domain: 'service', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  service_action: { domain: 'service', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  service_status: { domain: 'service', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  service_logs: { domain: 'service', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  docker_containers: { domain: 'docker', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  docker_action: { domain: 'docker', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  docker_logs: { domain: 'docker', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  docker_images: { domain: 'docker', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  docker_exec: { domain: 'docker', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  docker_stats: { domain: 'docker', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  docker_image_remove: { domain: 'docker', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  network_ports: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  network_connections: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  network_interfaces: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  network_ping: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  network_dns_lookup: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  network_kill_port: { domain: 'network', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  network_bandwidth_stats: { domain: 'network', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  package_list: { domain: 'package', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  package_search: { domain: 'package', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  package_install: { domain: 'package', mutating: true, webSupported: true, defaultTimeoutMs: 180_000 },
  package_remove: { domain: 'package', mutating: true, webSupported: true, defaultTimeoutMs: 120_000 },
  package_preview: { domain: 'package', mutating: false, webSupported: true, defaultTimeoutMs: 60_000 },
  package_update: { domain: 'package', mutating: true, webSupported: true, defaultTimeoutMs: 180_000 },
  package_upgradable: { domain: 'package', mutating: false, webSupported: true, defaultTimeoutMs: 45_000 },
  package_detect_manager: { domain: 'package', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  user_list: { domain: 'user', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  user_add: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  user_set_password: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  user_toggle_sudo: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  user_delete: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  user_modify: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  user_lock: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  user_unlock: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  group_list: { domain: 'user', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  group_add: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  group_delete: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  group_add_user: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  group_remove_user: { domain: 'user', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  who_is_logged_in: { domain: 'user', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  last_logins: { domain: 'user', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  cron_list: { domain: 'cron', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  cron_list_all: { domain: 'cron', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  cron_add: { domain: 'cron', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  cron_remove: { domain: 'cron', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  cron_rollback: { domain: 'cron', mutating: true, webSupported: true, defaultTimeoutMs: 15_000 },
  logs_journal: { domain: 'logs', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  logs_file: { domain: 'logs', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  logs_dmesg: { domain: 'logs', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  logs_stream_start: { domain: 'logs', mutating: true, webSupported: false, defaultTimeoutMs: 15_000 },
  logs_stream_stop: { domain: 'logs', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  firewall_status: { domain: 'firewall', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  firewall_rules: { domain: 'firewall', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  firewall_add_rule: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_delete_rule: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_toggle: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_detect_backend: { domain: 'firewall', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  firewall_add_rule_advanced: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_delete_rule_advanced: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_install: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 120_000 },
  firewall_set_default_policy: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_reset: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  firewall_reload: { domain: 'firewall', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_list: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_usage: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_smart: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_largest_dirs: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_mount: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_unmount: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_remount: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_get_fstab: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  disk_create_label: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_create_partition: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_delete_partition: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_resize_partition: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_set_partition_flag: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_format_filesystem: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 60_000 },
  disk_set_label: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },
  disk_check_filesystem: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 60_000 },
  disk_get_swap_info: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  disk_manage_swap: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 30_000 },
  disk_get_tmp_info: { domain: 'disk', mutating: false, webSupported: true, defaultTimeoutMs: 15_000 },
  disk_manage_tmp: { domain: 'disk', mutating: true, webSupported: true, defaultTimeoutMs: 20_000 },

  // Store & Vault Secrets
  store_save_connection: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  store_list_connections: { domain: 'store', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  store_delete_connection: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  store_update_connection: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  store_secret_save: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  store_secret_load: { domain: 'store', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  store_secret_delete: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },
  settings_get: { domain: 'store', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },
  settings_save: { domain: 'store', mutating: true, webSupported: true, defaultTimeoutMs: 10_000 },

  // Database Drivers (Native desktop drivers; Web mode reports UNSUPPORTED_IN_WEB_MODE)
  db_connect: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 30_000 },
  db_disconnect: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  db_test_connection: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  db_execute_query: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 30_000 },
  db_list_tables: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  db_get_table_columns: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  redis_scan_keys: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  redis_get_value: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 15_000 },
  redis_set_value: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 15_000 },
  redis_delete_key: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 15_000 },
  mongodb_list_collections: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  mongodb_find_documents: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  mongodb_insert_document: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 20_000 },
  db_execute_operation: { domain: 'database', mutating: true, webSupported: false, defaultTimeoutMs: 30_000 },
  db_get_object_definition: { domain: 'database', mutating: false, webSupported: false, defaultTimeoutMs: 20_000 },
  db_get_capabilities: { domain: 'database', mutating: false, webSupported: true, defaultTimeoutMs: 10_000 },

  // API Studio, Browser Gateway, Notifications & App Lifecycle
  api_send_request: { domain: 'api', mutating: true, webSupported: true, defaultTimeoutMs: 60_000 },
  send_desktop_notification: { domain: 'app', mutating: false, webSupported: false, defaultTimeoutMs: 10_000 },
  open_browser_window: { domain: 'browser', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  close_browser_window: { domain: 'browser', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  focus_browser_window: { domain: 'browser', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
  browser_proxy_fetch: { domain: 'browser', mutating: false, webSupported: true, defaultTimeoutMs: 30_000 },
  app_request_shutdown: { domain: 'app', mutating: true, webSupported: false, defaultTimeoutMs: 10_000 },
};

export type ContractCommandName = keyof typeof UNIFIED_COMMAND_CONTRACT;
