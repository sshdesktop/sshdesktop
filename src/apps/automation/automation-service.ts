import { sshExec, sshConnect, sftpReadTextFile, sftpWriteTextFile, sftpMkdir } from '../../lib/tauri-bridge';
import { SavedConnection } from '../../lib/types';
import {
  AutomationRecipe,
  ServerExecutionResult,
  TargetHealth,
  AutomationExecutionRun,
  ExecutionMode,
  AutomationServerData,
  FleetMatrixData,
  FleetOrganization,
  FleetGroup,
  FleetServer,
  TargetServer,
} from './types';

// ==========================================
// BUILT-IN RECIPES
// ==========================================
export const BUILT_IN_RECIPES: AutomationRecipe[] = [
  {
    id: 'fleet-telemetry',
    title: 'Fleet Health & Metric Matrix',
    description: 'Query OS, kernel, uptime, load averages, memory and disk utilization across all nodes.',
    category: 'system',
    icon: 'Activity',
    command: `echo "---BEGIN_TELEMETRY---"
echo "OS=$(grep '^PRETTY_NAME=' /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -s)"
echo "KERNEL=$(uname -r)"
echo "UPTIME=$(uptime -p 2>/dev/null || uptime | awk -F'( |,|:)+' '{print $6,"hrs,",$7,"min"}')"
echo "LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || uptime | awk -F'load average:' '{print $2}')"
echo "MEM=$(free -h 2>/dev/null | awk '/Mem:/ {print $3 " / " $2}' || vmstat -s 2>/dev/null | head -2 | tail -1 | awk '{print $1}')"
echo "DISK=$(df -h / 2>/dev/null | awk 'NR==2 {print $3 " / " $2 " (" $5 ")"}')"
echo "---END_TELEMETRY---"`,
    isSudo: false,
    timeoutSeconds: 30,
    isBuiltIn: true,
  },
  {
    id: 'fleet-upgrade',
    title: 'Fleet OS Package Upgrade',
    description: 'Update repositories and apply all pending security and distribution updates across Ubuntu/Debian, RHEL/Rocky, Arch, or Alpine.',
    category: 'maintenance',
    icon: 'Package',
    command: `if [ -f /etc/debian_version ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y && apt-get upgrade -y
elif [ -f /etc/redhat-release ] || [ -f /etc/rocky-release ] || [ -f /etc/almalinux-release ]; then
  dnf upgrade -y || yum upgrade -y
elif [ -f /etc/arch-release ]; then
  pacman -Syu --noconfirm
elif [ -f /etc/alpine-release ]; then
  apk update && apk upgrade
else
  echo "Unsupported distribution for automated package upgrade." && exit 1
fi`,
    isSudo: true,
    timeoutSeconds: 300,
    stopOnError: false,
    isBuiltIn: true,
  },
  {
    id: 'fleet-security-audit',
    title: 'Fleet Security & SSH Audit',
    description: 'Audit SSH root logins, password auth, recent failed intrusions, listening sockets, and firewall configuration.',
    category: 'security',
    icon: 'ShieldCheck',
    command: `echo "=== SSH CONFIGURATION AUDIT ==="
grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port)" /etc/ssh/sshd_config 2>/dev/null || echo "Default or unmodified sshd configuration"

echo ""
echo "=== RECENT FAILED LOGIN ATTEMPTS ==="
if [ -f /var/log/auth.log ]; then
  grep "Failed password" /var/log/auth.log 2>/dev/null | tail -n 8 || echo "No failed attempts recorded in auth.log"
elif command -v journalctl >/dev/null 2>&1; then
  journalctl _COMM=sshd -n 25 2>/dev/null | grep -i "failed" | tail -n 8 || echo "No failed attempts recorded in journalctl"
else
  echo "No standard auth log found"
fi

echo ""
echo "=== ACTIVE LISTENING NETWORK PORTS ==="
if command -v ss >/dev/null 2>&1; then
  ss -tulnp | head -n 12
elif command -v netstat >/dev/null 2>&1; then
  netstat -tulnp | head -n 12
fi

echo ""
echo "=== FIREWALL STATUS ==="
if command -v ufw >/dev/null 2>&1; then
  ufw status verbose
elif command -v iptables >/dev/null 2>&1; then
  iptables -L -n -v | head -n 12
fi`,
    isSudo: true,
    timeoutSeconds: 45,
    isBuiltIn: true,
  },
  {
    id: 'docker-fleet-prune',
    title: 'Docker Fleet Cleanup & Prune',
    description: 'Inspect Docker system disk usage and clean stopped containers, dangling images, build cache, and unused networks.',
    category: 'docker',
    icon: 'Container',
    command: `if command -v docker >/dev/null 2>&1; then
  echo "=== DOCKER SYSTEM USAGE BEFORE ==="
  docker system df
  echo ""
  echo "=== PRUNING DANGLING IMAGES & CONTAINERS ==="
  docker system prune -af --volumes
  echo ""
  echo "=== DOCKER SYSTEM USAGE AFTER ==="
  docker system df
else
  echo "Docker engine is not installed on this host."
fi`,
    isSudo: true,
    timeoutSeconds: 120,
    isBuiltIn: true,
  },
  {
    id: 'fleet-journal-vacuum',
    title: 'Disk Cleanup & Systemd Journal Vacuum',
    description: 'Vacuum systemd journal logs older than 3 days, clean stale files in /tmp, and report recovered space.',
    category: 'cleanup',
    icon: 'Trash2',
    command: `echo "=== DISK USAGE BEFORE CLEANUP ==="
df -h /

echo ""
echo "=== VACUUMING SYSTEMD JOURNALS (> 3 DAYS) ==="
if command -v journalctl >/dev/null 2>&1; then
  journalctl --vacuum-time=3d
else
  echo "journalctl not available"
fi

echo ""
echo "=== REMOVING STALE TMP FILES (> 3 DAYS) ==="
find /tmp -type f -atime +3 -delete 2>/dev/null || true

echo ""
echo "=== DISK USAGE AFTER CLEANUP ==="
df -h /`,
    isSudo: true,
    timeoutSeconds: 60,
    isBuiltIn: true,
  },
  {
    id: 'webserver-reload',
    title: 'Web Server Graceful Fleet Reload',
    description: 'Verify syntax on Nginx, Apache2, or Caddy configuration and gracefully reload without dropping connection traffic.',
    category: 'web',
    icon: 'Globe',
    command: `if command -v nginx >/dev/null 2>&1; then
  echo "Testing Nginx configuration syntax..."
  nginx -t && systemctl reload nginx && echo "✓ Nginx reloaded gracefully."
elif command -v apache2 >/dev/null 2>&1; then
  echo "Testing Apache2 configuration syntax..."
  apache2ctl configtest && systemctl reload apache2 && echo "✓ Apache2 reloaded gracefully."
elif command -v httpd >/dev/null 2>&1; then
  echo "Testing HTTPD configuration syntax..."
  httpd -t && systemctl reload httpd && echo "✓ HTTPD reloaded gracefully."
elif command -v caddy >/dev/null 2>&1; then
  echo "Reloading Caddy..."
  caddy reload && echo "✓ Caddy reloaded gracefully."
else
  echo "No supported web server found (nginx/apache2/httpd/caddy)."
fi`,
    isSudo: true,
    timeoutSeconds: 30,
    isBuiltIn: true,
  },
  {
    id: 'ssh-key-sync',
    title: 'Push Authorized SSH Key',
    description: 'Append or verify an authorized SSH public key in ~/.ssh/authorized_keys across every selected server with secure permissions (0600).',
    category: 'security',
    icon: 'KeyRound',
    command: `KEY="{{publicKey}}"
if [ -z "$KEY" ]; then
  echo "Error: 'publicKey' parameter cannot be empty." >&2
  exit 1
fi

mkdir -p ~/.ssh && chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys

if grep -Fq "$KEY" ~/.ssh/authorized_keys 2>/dev/null; then
  echo "SSH Public Key is already authorized on this server."
else
  echo "$KEY" >> ~/.ssh/authorized_keys
  echo "✓ Successfully installed SSH public key into ~/.ssh/authorized_keys."
fi`,
    isSudo: false,
    timeoutSeconds: 30,
    variables: [
      {
        name: 'publicKey',
        label: 'SSH Public Key (ssh-ed25519 or ssh-rsa)',
        defaultValue: '',
        placeholder: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI... user@desktop',
        description: 'The public key to append to ~/.ssh/authorized_keys',
      },
    ],
    isBuiltIn: true,
  },
  {
    id: 'service-restart',
    title: 'Fleet Service Restart & Status',
    description: 'Check active status and perform a clean restart of any systemd service across the cluster.',
    category: 'system',
    icon: 'Server',
    command: `SVC="{{serviceName}}"
if [ -z "$SVC" ]; then
  echo "Error: Service name parameter is required." >&2
  exit 1
fi

echo "Current status of $SVC:"
systemctl is-active "$SVC" || true

echo "Restarting service $SVC..."
systemctl restart "$SVC"

echo ""
echo "Post-restart status:"
systemctl status "$SVC" --no-pager -l`,
    isSudo: true,
    timeoutSeconds: 45,
    variables: [
      {
        name: 'serviceName',
        label: 'Service Name',
        defaultValue: 'nginx',
        placeholder: 'e.g. nginx, docker, postgresql, redis',
        description: 'Name of the systemd unit to restart and check',
      },
    ],
    isBuiltIn: true,
  },
  {
    id: 'drop-caches',
    title: 'Flush Kernel PageCache & Dentries',
    description: 'Safely sync all unwritten filesystem buffers and free non-dirty page cache, dentries, and inodes.',
    category: 'maintenance',
    icon: 'Zap',
    command: `echo "Free memory before flush:"
free -h
echo "Syncing filesystem buffers..."
sync
echo 3 > /proc/sys/vm/drop_caches
echo "✓ Kernel cache dropped."
echo "Free memory after flush:"
free -h`,
    isSudo: true,
    timeoutSeconds: 30,
    isBuiltIn: true,
  },
];

// ==========================================
// VARIABLE INTERPOLATION
// ==========================================
export function interpolateCommand(
  template: string,
  server: TargetServer,
  customVars: Record<string, string> = {}
): string {
  let result = template;

  // Built-in server variables
  const replacements: Record<string, string> = {
    '{{SERVER_NAME}}': server.name || server.host,
    '{{SERVER_HOST}}': server.host,
    '{{SERVER_PORT}}': String(server.port || 22),
    '{{SERVER_USER}}': server.username,
    '{{SERVER_GROUP}}': server.group || 'default',
    '{{DATE}}': new Date().toISOString().split('T')[0],
    '{{TIMESTAMP}}': String(Date.now()),
    ...Object.fromEntries(
      Object.entries(customVars).map(([k, v]) => [`{{${k}}}`, v])
    ),
  };

  for (const [key, val] of Object.entries(replacements)) {
    result = result.split(key).join(val);
  }

  return result;
}

// ==========================================
// INDIVIDUAL SERVER EXECUTION
// ==========================================
export async function executeOnServer(
  server: TargetServer,
  command: string,
  isSudo: boolean = false
): Promise<ServerExecutionResult> {
  const startedAt = Date.now();

  // If server is marked inactive, immediately return a skipped/failed result and do not execute
  if (server.status === 'inactive') {
    return {
      serverId: server.id,
      serverName: server.name || server.host,
      host: server.host,
      port: server.port,
      username: server.username,
      status: 'failed',
      stdout: '',
      stderr: `[DEACTIVATED] Server "${server.name || server.host}" (${server.host}:${server.port}) is marked inactive in Fleet Matrix. Execution skipped.`,
      exitCode: 1,
      durationMs: 0,
      startedAt,
      finishedAt: Date.now(),
      error: 'Server is deactivated',
    };
  }

  let preparedCommand = command.trim();

  // If sudo is required and command does not already contain sudo
  if (isSudo && !preparedCommand.startsWith('sudo')) {
    // If multi-line or contains pipes/redirects, wrap inside sudo bash -c
    if (preparedCommand.includes('\n') || preparedCommand.includes('|') || preparedCommand.includes('&&') || preparedCommand.includes('||')) {
      const escaped = preparedCommand.replace(/'/g, `'\\''`);
      preparedCommand = `sudo bash -c '${escaped}'`;
    } else {
      preparedCommand = `sudo ${preparedCommand}`;
    }
  }

  try {
    let res = await sshExec(server.id, preparedCommand);

    // If connection was not ready or dropped, try auto-connecting and retry once
    if (
      res.exit_code === -1 &&
      (res.stderr.includes('No active SSH connection') || res.stdout.includes('No active SSH connection'))
    ) {
      try {
        await sshConnect({
          id: server.id,
          name: server.name || `${server.username}@${server.host}`,
          host: server.host,
          port: Number(server.port) || 22,
          username: server.username,
          password: server.password,
          private_key_path: (server as any).privateKeyPath || (server as any).private_key_path || (server as any).privateKey,
          auth_method: server.authType === 'privateKey' || (server as any).authMethod === 'key' ? 'key' : 'password',
          color: (server as any).color,
          group: server.group,
          tags: server.tags || [],
        });
        // Retry execution
        res = await sshExec(server.id, preparedCommand);
      } catch (connErr: any) {
        return {
          serverId: server.id,
          serverName: server.name || server.host,
          host: server.host,
          port: server.port,
          username: server.username,
          status: 'failed',
          stdout: '',
          stderr: connErr?.message || String(connErr) || 'SSH connection failed',
          exitCode: -1,
          durationMs: Date.now() - startedAt,
          startedAt,
          finishedAt: Date.now(),
          error: connErr?.message || 'Connection failed',
        };
      }
    }

    const durationMs = Date.now() - startedAt;
    const isSuccess = res.exit_code === 0 && !res.stderr.includes('No active SSH connection') && !res.stderr.includes('Network is unreachable') && !res.stderr.includes('Connection refused');

    return {
      serverId: server.id,
      serverName: server.name || server.host,
      host: server.host,
      port: server.port,
      username: server.username,
      status: isSuccess ? 'success' : 'failed',
      stdout: res.stdout || '',
      stderr: res.stderr || (isSuccess ? '' : `Failed to execute on ${server.name || server.host} (${server.host}:${server.port}). Node is unreachable or returned exit code ${res.exit_code}.`),
      exitCode: isSuccess ? 0 : (res.exit_code === 0 ? 1 : res.exit_code),
      durationMs,
      startedAt,
      finishedAt: Date.now(),
    };
  } catch (err: any) {
    return {
      serverId: server.id,
      serverName: server.name || server.host,
      host: server.host,
      port: server.port,
      username: server.username,
      status: 'failed',
      stdout: '',
      stderr: err?.message || String(err),
      exitCode: -1,
      durationMs: Date.now() - startedAt,
      startedAt,
      finishedAt: Date.now(),
      error: err?.message || 'Command execution failed',
    };
  }
}

// ==========================================
// PARALLEL EXECUTION WITH CONCURRENCY POOL
// ==========================================
export async function executeParallelFleet(
  servers: TargetServer[],
  commandTemplate: string,
  isSudo: boolean,
  variables: Record<string, string>,
  concurrency: number = 5,
  onServerStart: (serverId: string) => void,
  onServerFinish: (serverId: string, result: ServerExecutionResult) => void,
  isCancelled: () => boolean
): Promise<Record<string, ServerExecutionResult>> {
  const results: Record<string, ServerExecutionResult> = {};
  const queue = [...servers];
  const maxWorkers = Math.max(1, Math.min(concurrency, queue.length));

  async function worker() {
    while (queue.length > 0) {
      if (isCancelled()) break;
      const server = queue.shift();
      if (!server) break;

      onServerStart(server.id);
      const interpolatedCmd = interpolateCommand(commandTemplate, server, variables);
      const res = await executeOnServer(server, interpolatedCmd, isSudo);
      results[server.id] = res;
      onServerFinish(server.id, res);
    }
  }

  const workers = Array.from({ length: maxWorkers }, () => worker());
  await Promise.all(workers);

  // If cancelled, mark any unreached as skipped
  for (const s of servers) {
    if (!results[s.id]) {
      results[s.id] = {
        serverId: s.id,
        serverName: s.name || s.host,
        host: s.host,
        port: s.port,
        username: s.username,
        status: 'skipped',
        stdout: '',
        stderr: 'Execution was cancelled by user.',
        exitCode: -1,
        durationMs: 0,
      };
      onServerFinish(s.id, results[s.id]);
    }
  }

  return results;
}

// ==========================================
// ROLLING / SEQUENTIAL EXECUTION
// ==========================================
export async function executeRollingFleet(
  servers: TargetServer[],
  commandTemplate: string,
  isSudo: boolean,
  variables: Record<string, string>,
  stopOnError: boolean,
  onServerStart: (serverId: string) => void,
  onServerFinish: (serverId: string, result: ServerExecutionResult) => void,
  isCancelled: () => boolean
): Promise<Record<string, ServerExecutionResult>> {
  const results: Record<string, ServerExecutionResult> = {};
  let shouldStop = false;

  for (let i = 0; i < servers.length; i++) {
    const server = servers[i];

    if (isCancelled() || shouldStop) {
      const skippedResult: ServerExecutionResult = {
        serverId: server.id,
        serverName: server.name || server.host,
        host: server.host,
        port: server.port,
        username: server.username,
        status: 'skipped',
        stdout: '',
        stderr: shouldStop
          ? 'Execution halted: Previous server failed and Stop-On-Error is enabled.'
          : 'Execution cancelled by user.',
        exitCode: -1,
        durationMs: 0,
      };
      results[server.id] = skippedResult;
      onServerFinish(server.id, skippedResult);
      continue;
    }

    onServerStart(server.id);
    const interpolatedCmd = interpolateCommand(commandTemplate, server, variables);
    const res = await executeOnServer(server, interpolatedCmd, isSudo);
    results[server.id] = res;
    onServerFinish(server.id, res);

    if (stopOnError && res.status === 'failed') {
      shouldStop = true;
    }
  }

  return results;
}

// ==========================================
// TELEMETRY PROBE FOR FLEET HEALTH MATRIX
// ==========================================
export async function probeFleetTelemetry(
  servers: TargetServer[],
  onServerUpdate?: (health: TargetHealth) => void
): Promise<TargetHealth[]> {
  const telemetryCommand = BUILT_IN_RECIPES[0].command;

  const probePromises = servers.map(async (server) => {
    if (server.status === 'inactive') {
      const item: TargetHealth = {
        serverId: server.id,
        reachable: false,
        latencyMs: 0,
        error: 'Server is deactivated in Fleet Matrix',
        lastChecked: Date.now(),
      };
      onServerUpdate?.(item);
      return item;
    }

    const started = Date.now();
    try {
      const res = await executeOnServer(server, telemetryCommand, false);
      const latencyMs = res.durationMs || (Date.now() - started);

      if (res.exitCode !== 0 && !res.stdout.includes('---BEGIN_TELEMETRY---')) {
        const item: TargetHealth = {
          serverId: server.id,
          reachable: false,
          latencyMs,
          error: res.stderr || 'Host unreachable or SSH timeout',
          lastChecked: Date.now(),
        };
        onServerUpdate?.(item);
        return item;
      }

      // Parse telemetry output
      const raw = res.stdout;
      const getVal = (key: string) => {
        const match = raw.match(new RegExp(`${key}=(.*)`));
        return match ? match[1].trim() : undefined;
      };

      const item: TargetHealth = {
        serverId: server.id,
        reachable: true,
        os: getVal('OS') || server.osType || 'Linux',
        kernel: getVal('KERNEL') || 'Unknown',
        uptime: getVal('UPTIME') || 'Up',
        loadAvg: getVal('LOAD') || '0.00, 0.00, 0.00',
        memUsage: getVal('MEM') || 'N/A',
        diskUsage: getVal('DISK') || 'N/A',
        latencyMs,
        lastChecked: Date.now(),
      };
      onServerUpdate?.(item);
      return item;
    } catch (e: any) {
      const item: TargetHealth = {
        serverId: server.id,
        reachable: false,
        latencyMs: Date.now() - started,
        error: e?.message || 'Probe failed',
        lastChecked: Date.now(),
      };
      onServerUpdate?.(item);
      return item;
    }
  });

  return Promise.all(probePromises);
}

// ==========================================
// LOCAL STORAGE PERSISTENCE
// ==========================================
const STORAGE_KEY_RECIPES = 'sshdesktop_automation_custom_recipes';
const STORAGE_KEY_HISTORY = 'sshdesktop_automation_history';
const STORAGE_KEY_SCHEDULES = 'sshdesktop_automation_schedules';

export function loadStoredRecipes(): AutomationRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECIPES);
    const custom: AutomationRecipe[] = raw ? JSON.parse(raw) : [];
    return [...BUILT_IN_RECIPES, ...custom];
  } catch (err) {
    console.error('Failed to parse custom recipes:', err);
    return BUILT_IN_RECIPES;
  }
}

export function saveCustomRecipe(recipe: AutomationRecipe): AutomationRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECIPES);
    const custom: AutomationRecipe[] = raw ? JSON.parse(raw) : [];
    const index = custom.findIndex(r => r.id === recipe.id);
    if (index >= 0) {
      custom[index] = recipe;
    } else {
      custom.push(recipe);
    }
    localStorage.setItem(STORAGE_KEY_RECIPES, JSON.stringify(custom));
    return [...BUILT_IN_RECIPES, ...custom];
  } catch (err) {
    console.error('Failed to save custom recipe:', err);
    return BUILT_IN_RECIPES;
  }
}

export function deleteCustomRecipe(id: string): AutomationRecipe[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_RECIPES);
    const custom: AutomationRecipe[] = raw ? JSON.parse(raw) : [];
    const filtered = custom.filter(r => r.id !== id);
    localStorage.setItem(STORAGE_KEY_RECIPES, JSON.stringify(filtered));
    return [...BUILT_IN_RECIPES, ...filtered];
  } catch (err) {
    console.error('Failed to delete custom recipe:', err);
    return BUILT_IN_RECIPES;
  }
}

export function loadStoredHistory(): AutomationExecutionRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to load automation history:', err);
    return [];
  }
}

export function saveHistoryEntry(entry: AutomationExecutionRun): AutomationExecutionRun[] {
  try {
    const current = loadStoredHistory();
    // Keep last 50 runs to preserve local storage space
    const updated = [entry, ...current.slice(0, 49)];
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
    return updated;
  } catch (err) {
    console.error('Failed to save history entry:', err);
    return [];
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_HISTORY);
  } catch (err) {
    console.error('Failed to clear history:', err);
  }
}

// ==========================================
// ENTERPRISE FLEET MATRIX STORAGE
// ==========================================
const STORAGE_KEY_FLEET_MATRIX = 'sshdesktop_automation_fleet_matrix';

export function getDefaultFleetMatrix(connections: SavedConnection[] = []): FleetMatrixData {
  const defaultOrgId = 'org-default';
  const defaultGroupId = 'grp-default';

  const defaultServers: FleetServer[] = connections.map(c => ({
    id: c.id,
    organizationId: defaultOrgId,
    groupId: defaultGroupId,
    name: c.name || `${c.username}@${c.host}`,
    host: c.host,
    port: Number(c.port) || 22,
    username: c.username,
    password: c.password,
    authType: (c as any).authMethod === 'key' ? 'privateKey' : 'password',
    tags: c.tags || [],
    status: 'active',
    createdAt: Date.now(),
  }));

  return {
    organizations: [
      {
        id: defaultOrgId,
        name: 'Primary Enterprise Fleet',
        description: 'Default infrastructure organization for managed servers',
        color: '#6366f1',
        createdAt: Date.now(),
      },
    ],
    groups: [
      {
        id: defaultGroupId,
        organizationId: defaultOrgId,
        name: 'Core Nodes',
        description: 'Primary production and utility compute instances',
        color: '#3b82f6',
        createdAt: Date.now(),
      },
    ],
    servers: defaultServers,
    mappings: {},
  };
}

export function loadStoredFleetMatrix(connections: SavedConnection[] = []): FleetMatrixData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FLEET_MATRIX);
    if (!raw) return getDefaultFleetMatrix(connections);
    const parsed = JSON.parse(raw) as FleetMatrixData;
    if (!parsed.organizations || parsed.organizations.length === 0) {
      return getDefaultFleetMatrix(connections);
    }
    if (!Array.isArray(parsed.servers)) {
      parsed.servers = [];
    }
    // If parsed servers is empty but user has saved connections, auto-seed
    if (parsed.servers.length === 0 && connections.length > 0) {
      const defaultOrgId = parsed.organizations[0]?.id || 'org-default';
      const defaultGroupId = parsed.groups[0]?.id || 'grp-default';
      parsed.servers = connections.map(c => ({
        id: c.id,
        organizationId: defaultOrgId,
        groupId: defaultGroupId,
        name: c.name || `${c.username}@${c.host}`,
        host: c.host,
        port: Number(c.port) || 22,
        username: c.username,
        password: c.password,
        authType: (c as any).authMethod === 'key' ? 'privateKey' : 'password',
        tags: c.tags || [],
        status: 'active',
        createdAt: Date.now(),
      }));
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse fleet matrix:', err);
    return getDefaultFleetMatrix(connections);
  }
}

export function saveStoredFleetMatrix(data: FleetMatrixData): FleetMatrixData {
  try {
    localStorage.setItem(STORAGE_KEY_FLEET_MATRIX, JSON.stringify(data));
    return data;
  } catch (err) {
    console.error('Failed to save fleet matrix:', err);
    return data;
  }
}

// ==========================================
// REMOTE SERVER PERSISTENCE (~/.sshdesktop/automation.json)
// ==========================================

export function getAutomationServerFilePath(homeDir: string): string {
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/root';
  return `${cleanHome}/.sshdesktop/automation.json`;
}

/**
 * Saves all automation application data (custom recipes, history, fleet matrix)
 * directly to the remote server at ~/.sshdesktop/automation.json for the login user (e.g. /home/sharuk/.sshdesktop/automation.json).
 */
export async function saveAutomationToServer(
  connId: string,
  homeDir: string,
  data: {
    username?: string;
    customRecipes: AutomationRecipe[];
    history: AutomationExecutionRun[];
    fleetMatrix?: FleetMatrixData;
    lastTargetServerIds?: string[];
  }
): Promise<{ success: boolean; path: string; timestamp: string; error?: string }> {
  const timestamp = new Date().toISOString();
  if (!connId || !homeDir) {
    return { success: false, path: '', error: 'No active connection or home directory provided', timestamp };
  }

  const filePath = getAutomationServerFilePath(homeDir);
  const dirPath = `${homeDir.replace(/\/+$/, '')}/.sshdesktop`;

  try {
    // 1. Ensure remote ~/.sshdesktop directory exists
    await sshExec(connId, `mkdir -p "${dirPath}"`).catch(() => {});
    await sftpMkdir(connId, dirPath).catch(() => {});

    // 2. Build complete server data payload
    const payload: AutomationServerData = {
      user: data.username || 'user',
      version: '2.0',
      updated_at: timestamp,
      custom_recipes: data.customRecipes,
      history: data.history.slice(0, 50), // keep latest 50
      fleet_matrix: data.fleetMatrix,
      last_target_server_ids: data.lastTargetServerIds || [],
      client: 'SSH Desktop Multi-Server Enterprise Orchestrator',
    };

    const jsonStr = JSON.stringify(payload, null, 2);

    // 3. Write file via SFTP with fallback to base64 sshExec
    let wroteOk = false;
    try {
      await sftpWriteTextFile(connId, filePath, jsonStr);
      wroteOk = true;
    } catch (sftpErr) {
      console.warn('[Automation Server Storage] SFTP write failed, attempting base64 sshExec fallback:', sftpErr);
    }

    if (!wroteOk) {
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
      const res = await sshExec(
        connId,
        `mkdir -p "${dirPath}" && printf '%s' '${b64}' | base64 -d > "${filePath}" && chmod 600 "${filePath}"`
      );
      wroteOk = res.exit_code === 0;
      if (!wroteOk) {
        throw new Error(res.stderr || 'Failed to write automation.json to server');
      }
    }

    // Ensure proper user-only read/write permissions
    await sshExec(connId, `chmod 600 "${filePath}" 2>/dev/null || true`).catch(() => {});

    // Also update local storage cache
    localStorage.setItem(STORAGE_KEY_RECIPES, JSON.stringify(data.customRecipes));
    localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(data.history.slice(0, 50)));
    if (data.fleetMatrix) {
      localStorage.setItem(STORAGE_KEY_FLEET_MATRIX, JSON.stringify(data.fleetMatrix));
    }

    return { success: true, path: filePath, timestamp };
  } catch (err: any) {
    return { success: false, path: filePath, error: String(err?.message || err), timestamp };
  }
}

/**
 * Loads and parses automation data from ~/.sshdesktop/automation.json on the remote server.
 */
export async function loadAutomationFromServer(
  connId: string,
  homeDir: string
): Promise<{
  success: boolean;
  data?: AutomationServerData;
  path: string;
  rawJson?: string;
  error?: string;
}> {
  if (!connId || !homeDir) {
    return { success: false, path: '', error: 'No active connection or home directory provided' };
  }

  const filePath = getAutomationServerFilePath(homeDir);

  try {
    let content = await sftpReadTextFile(connId, filePath).catch(() => '');

    if (!content) {
      const res = await sshExec(connId, `cat "${filePath}" 2>/dev/null`).catch(() => null);
      if (res && res.exit_code === 0 && res.stdout.trim()) {
        content = res.stdout;
      }
    }

    if (!content || !content.trim().startsWith('{')) {
      return { success: false, path: filePath, error: `No automation data file found at ${filePath}` };
    }

    const parsed = JSON.parse(content) as AutomationServerData;

    // Cache into local storage
    if (Array.isArray(parsed.custom_recipes)) {
      localStorage.setItem(STORAGE_KEY_RECIPES, JSON.stringify(parsed.custom_recipes));
    }
    if (Array.isArray(parsed.history)) {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(parsed.history));
    }
    if (parsed.fleet_matrix) {
      localStorage.setItem(STORAGE_KEY_FLEET_MATRIX, JSON.stringify(parsed.fleet_matrix));
    }

    return { success: true, data: parsed, path: filePath, rawJson: content };
  } catch (err: any) {
    return { success: false, path: filePath, error: String(err?.message || err) };
  }
}

/**
 * Checks metadata of remote ~/.sshdesktop/automation.json (exists, file size, last modified)
 */
export async function checkAutomationServerFileStatus(
  connId: string,
  homeDir: string
): Promise<{
  exists: boolean;
  path: string;
  size?: number;
  modified?: string;
  rawJson?: string;
}> {
  const filePath = getAutomationServerFilePath(homeDir);
  if (!connId || !homeDir) {
    return { exists: false, path: filePath };
  }

  try {
    const res = await sshExec(
      connId,
      `if [ -f "${filePath}" ]; then stat -c "%s %Y" "${filePath}" 2>/dev/null || stat -f "%z %m" "${filePath}" 2>/dev/null || wc -c < "${filePath}"; fi`
    );

    if (res.exit_code === 0 && res.stdout.trim()) {
      const parts = res.stdout.trim().split(/\s+/);
      const size = Number(parts[0]) || 0;
      const modTimestamp = parts[1] ? Number(parts[1]) * 1000 : Date.now();
      const modified = new Date(modTimestamp).toLocaleString();

      const catRes = await sshExec(connId, `cat "${filePath}" 2>/dev/null`);
      const rawJson = catRes.exit_code === 0 ? catRes.stdout : undefined;

      return {
        exists: true,
        path: filePath,
        size,
        modified,
        rawJson,
      };
    }

    return { exists: false, path: filePath };
  } catch {
    return { exists: false, path: filePath };
  }
}

