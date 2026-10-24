import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SshKeyItem, SshTunnelRule, SshSnippet, SshAuditLog, SshConfigEntry } from './types';

const DEFAULT_SNIPPETS: SshSnippet[] = [
  {
    id: 'snip-1',
    title: 'System Health Overview',
    category: 'system',
    description: 'Check CPU, memory, load average and disk utilization',
    command: 'uname -a && uptime && free -h && df -h /',
    shortcut: '⌘1',
  },
  {
    id: 'snip-2',
    title: 'Docker Prune & Clean',
    category: 'docker',
    description: 'Prune unused docker containers, images, and networks',
    command: 'docker system df && docker system prune -af --volumes',
    shortcut: '⌘2',
  },
  {
    id: 'snip-3',
    title: 'Top Memory & CPU Consumers',
    category: 'system',
    description: 'Display top 10 processes consuming memory and CPU',
    command: 'ps aux --sort=-%mem | head -n 11',
  },
  {
    id: 'snip-4',
    title: 'Active Listening Ports (ss)',
    category: 'network',
    description: 'Show all listening TCP/UDP sockets with process names',
    command: 'sudo ss -tulnp',
  },
  {
    id: 'snip-5',
    title: 'Recent Failed Logins (Security)',
    category: 'security',
    description: 'Inspect failed SSH login attempts from auth.log/journalctl',
    command: 'sudo grep "Failed password" /var/log/auth.log 2>/dev/null || sudo journalctl _COMM=sshd -n 50 | grep -i "Failed"',
  },
  {
    id: 'snip-6',
    title: 'Nginx Configuration Test & Reload',
    category: 'system',
    description: 'Validate Nginx syntax and gracefully reload worker processes',
    command: 'sudo nginx -t && sudo systemctl reload nginx',
  },
  {
    id: 'snip-7',
    title: 'Find Largest Files (>100MB)',
    category: 'storage',
    description: 'Locate top large files consuming disk space',
    command: 'sudo find / -type f -size +100M -exec ls -lh {} + 2>/dev/null | awk \'{ print $9 ": " $5 }\' | head -n 20',
  },
  {
    id: 'snip-8',
    title: 'Flush DNS Cache & Test Connectivity',
    category: 'network',
    description: 'Flush systemd-resolved DNS cache and ping Cloudflare DNS',
    command: 'sudo resolvectl flush-caches 2>/dev/null || sudo systemd-resolve --flush-caches 2>/dev/null; ping -c 4 1.1.1.1',
  },
  {
    id: 'snip-9',
    title: 'UFW Firewall Status & Rules',
    category: 'security',
    description: 'Display verbose status and numbered firewall rules',
    command: 'sudo ufw status verbose && sudo ufw status numbered',
  },
  {
    id: 'snip-10',
    title: 'Database Service Status',
    category: 'database',
    description: 'Check status of PostgreSQL, MySQL, Redis, MongoDB services',
    command: 'systemctl is-active postgresql mysql mariadb redis redis-server mongod 2>/dev/null || true',
  },
];

const DEFAULT_TUNNELS: SshTunnelRule[] = [
  {
    id: 'tun-web-80',
    name: 'Web Application (HTTP Port 80)',
    type: 'local',
    localPort: 8080,
    remoteHost: '127.0.0.1',
    remotePort: 80,
    description: 'Forward remote Apache / Nginx port 80 to localhost:8080',
    status: 'inactive',
    createdAt: Date.now() - 120000000,
  },
  {
    id: 'tun-pg',
    name: 'PostgreSQL Direct Forward',
    type: 'local',
    localPort: 5432,
    remoteHost: '127.0.0.1',
    remotePort: 5432,
    description: 'Connect local pgAdmin / DBeaver to remote PostgreSQL',
    status: 'inactive',
    createdAt: Date.now() - 86400000,
  },
  {
    id: 'tun-mysql',
    name: 'MySQL / MariaDB Remote',
    type: 'local',
    localPort: 3306,
    remoteHost: '127.0.0.1',
    remotePort: 3306,
    description: 'Forward remote MySQL database port to localhost:3306',
    status: 'inactive',
    createdAt: Date.now() - 43200000,
  },
  {
    id: 'tun-socks',
    name: 'Dynamic SOCKS5 Proxy',
    type: 'dynamic',
    localPort: 1080,
    remoteHost: '127.0.0.1',
    remotePort: 1080,
    description: 'Route browser traffic through encrypted SSH SOCKS5 proxy',
    status: 'inactive',
    createdAt: Date.now() - 10000000,
  },
];

interface SshStoreState {
  keys: SshKeyItem[];
  tunnels: SshTunnelRule[];
  snippets: SshSnippet[];
  auditLogs: SshAuditLog[];
  configHosts: SshConfigEntry[];
  terminalFontSize: number;
  terminalTheme: 'catppuccin' | 'dracula' | 'nord' | 'one-dark' | 'solarized';
  
  // Key Vault Actions
  addKey: (key: SshKeyItem) => void;
  removeKey: (id: string) => void;
  markKeyPushedToServer: (keyId: string, serverHost: string) => void;

  // Tunnel Actions
  setTunnels: (tunnels: SshTunnelRule[]) => void;
  addTunnel: (tunnel: SshTunnelRule) => void;
  updateTunnel: (id: string, updates: Partial<SshTunnelRule>) => void;
  removeTunnel: (id: string) => void;
  setTunnelStatus: (id: string, status: 'active' | 'inactive' | 'error', error?: string) => void;

  // Snippets
  addSnippet: (snippet: SshSnippet) => void;
  updateSnippet: (id: string, updates: Partial<SshSnippet>) => void;
  removeSnippet: (id: string) => void;

  // Audit Logs
  addAuditLog: (log: Omit<SshAuditLog, 'id' | 'timestamp'>) => void;
  clearAuditLogs: () => void;

  // Preferences
  setTerminalFontSize: (size: number) => void;
  setTerminalTheme: (theme: 'catppuccin' | 'dracula' | 'nord' | 'one-dark' | 'solarized') => void;
}

// Migrate legacy store if present
if (typeof localStorage !== 'undefined' && !localStorage.getItem('sshdesktop_ssh_studio_store') && localStorage.getItem('clouddesk_ssh_studio_store')) {
  try {
    localStorage.setItem('sshdesktop_ssh_studio_store', localStorage.getItem('clouddesk_ssh_studio_store')!);
  } catch {}
}

export const useSshStore = create<SshStoreState>()(
  persist(
    (set, get) => ({
      keys: [],
      tunnels: DEFAULT_TUNNELS,
      snippets: DEFAULT_SNIPPETS,
      auditLogs: [],
      configHosts: [],
      terminalFontSize: 14,
      terminalTheme: 'catppuccin',

      addKey: (key) => set((s) => ({ keys: [key, ...s.keys.filter(k => k.id !== key.id)] })),
      removeKey: (id) => set((s) => ({ keys: s.keys.filter(k => k.id !== id) })),
      markKeyPushedToServer: (keyId, serverHost) => set((s) => ({
        keys: s.keys.map(k => {
          if (k.id !== keyId) return k;
          const pushed = k.pushedServers || [];
          if (pushed.includes(serverHost)) return k;
          return { ...k, pushedServers: [...pushed, serverHost] };
        })
      })),

      setTunnels: (tunnels) => set({ tunnels }),
      addTunnel: (tunnel) => set((s) => ({ tunnels: [tunnel, ...s.tunnels.filter(t => t.id !== tunnel.id)] })),
      updateTunnel: (id, updates) => set((s) => ({
        tunnels: s.tunnels.map(t => t.id === id ? { ...t, ...updates } : t)
      })),
      removeTunnel: (id) => set((s) => ({ tunnels: s.tunnels.filter(t => t.id !== id) })),
      setTunnelStatus: (id, status, error) => set((s) => ({
        tunnels: s.tunnels.map(t => t.id === id ? { ...t, status, error: error || undefined } : t)
      })),

      addSnippet: (snippet) => set((s) => ({ snippets: [snippet, ...s.snippets.filter(sn => sn.id !== snippet.id)] })),
      updateSnippet: (id, updates) => set((s) => ({
        snippets: s.snippets.map(sn => sn.id === id ? { ...sn, ...updates } : sn)
      })),
      removeSnippet: (id) => set((s) => ({ snippets: s.snippets.filter(sn => sn.id !== id) })),

      addAuditLog: (log) => set((s) => ({
        auditLogs: [
          {
            ...log,
            id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
          },
          ...s.auditLogs.slice(0, 99) // keep latest 100 entries
        ]
      })),
      clearAuditLogs: () => set({ auditLogs: [] }),

      setTerminalFontSize: (size) => set({ terminalFontSize: Math.max(9, Math.min(28, size)) }),
      setTerminalTheme: (theme) => set({ terminalTheme: theme }),
    }),
    {
      name: 'sshdesktop_ssh_studio_store',
    }
  )
);
