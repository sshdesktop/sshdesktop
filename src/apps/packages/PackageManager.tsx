import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Package, Search, Download, Trash2, ArrowUpCircle, CheckCircle, 
  RefreshCw, Plus, X, AlertCircle, ShieldCheck, Terminal, Layers, 
  ExternalLink, Check, Sparkles, Server, Database, Globe, Cpu, 
  FileCode, Play, Eye, RotateCw, ArrowRight, HardDrive, Shield,
  Cloud, TerminalSquare, Copy, CheckCircle2, AlertTriangle, Filter,
  Box, Key, Zap, CheckCheck, Loader2
} from 'lucide-react';
import { 
  packageList, packageUpgradable, packageInstall, packageRemove, 
  packageUpdate, packageSearch, packageDetectManager, sshExec 
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { useUserPrivilege } from '../../lib/permissions';
import PermissionAlertBanner from '../../components/PermissionAlertBanner';
import PermissionAlertModal from '../../components/PermissionAlertModal';
import { PortalContextMenu } from '../../components/PortalContextMenu';

export interface PackageItem {
  name: string;
  version: string;
  arch: string;
  size: string;
  description: string;
  upgradable?: boolean;
  newVersion?: string;
  section?: string;
}

export interface CuratedApp {
  name: string;
  aptPackage: string;
  dnfPackage: string;
  category: 'CLI Tools' | 'Cloud & DevOps' | 'DB Clients' | 'Database' | 'Web & Proxy' | 'Development' | 'Containers' | 'Security' | 'Monitoring';
  description: string;
  icon: any;
  iconBg: string;
}

export const CURATED_CATEGORIES = [
  'All',
  'CLI Tools',
  'Cloud & DevOps',
  'DB Clients',
  'Database',
  'Web & Proxy',
  'Development',
  'Containers',
  'Security',
  'Monitoring',
] as const;

export type CuratedCategory = typeof CURATED_CATEGORIES[number];

export const CURATED_APPS: CuratedApp[] = [
  // ⚡ 1. Modern CLI Power Tools
  { name: 'fzf', aptPackage: 'fzf', dnfPackage: 'fzf', category: 'CLI Tools', description: 'General-purpose command-line fuzzy finder for files & history', icon: Search, iconBg: 'from-blue-600 to-indigo-800' },
  { name: 'ripgrep (rg)', aptPackage: 'ripgrep', dnfPackage: 'ripgrep', category: 'CLI Tools', description: 'Ultra-fast line-oriented search tool replacing grep', icon: Zap, iconBg: 'from-amber-600 to-orange-700' },
  { name: 'jq', aptPackage: 'jq', dnfPackage: 'jq', category: 'CLI Tools', description: 'Lightweight and flexible command-line JSON processor', icon: FileCode, iconBg: 'from-purple-600 to-pink-700' },
  { name: 'bat', aptPackage: 'bat', dnfPackage: 'bat', category: 'CLI Tools', description: 'Cat clone with syntax highlighting and Git integration', icon: Layers, iconBg: 'from-rose-500 to-red-700' },
  { name: 'eza / exa', aptPackage: 'eza', dnfPackage: 'eza', category: 'CLI Tools', description: 'Modern, colorful replacement for ls with tree view & git status', icon: Sparkles, iconBg: 'from-cyan-600 to-blue-700' },
  { name: 'zsh', aptPackage: 'zsh', dnfPackage: 'zsh', category: 'CLI Tools', description: 'Advanced programmable command interpreter & interactive shell', icon: Terminal, iconBg: 'from-slate-600 to-zinc-800' },
  { name: 'tree', aptPackage: 'tree', dnfPackage: 'tree', category: 'CLI Tools', description: 'Recursive directory listing producing a depth-indented file tree', icon: Layers, iconBg: 'from-emerald-600 to-teal-800' },
  { name: 'tldr', aptPackage: 'tldr', dnfPackage: 'tldr', category: 'CLI Tools', description: 'Simplified, community-driven man pages with real-world examples', icon: TerminalSquare, iconBg: 'from-indigo-600 to-purple-800' },
  { name: 'duf', aptPackage: 'duf', dnfPackage: 'duf', category: 'CLI Tools', description: 'Modern, colorful Disk Usage and Free space monitor', icon: HardDrive, iconBg: 'from-sky-500 to-blue-700' },
  { name: 'dust', aptPackage: 'dust', dnfPackage: 'dust', category: 'CLI Tools', description: 'Intuitive graphical-like terminal representation of disk usage', icon: HardDrive, iconBg: 'from-amber-500 to-yellow-700' },
  { name: 'ranger', aptPackage: 'ranger', dnfPackage: 'ranger', category: 'CLI Tools', description: 'Console file manager with vi keybindings and preview panels', icon: Package, iconBg: 'from-orange-600 to-red-800' },
  { name: 'Midnight Commander', aptPackage: 'mc', dnfPackage: 'mc', category: 'CLI Tools', description: 'Visual file manager with dual-panel layout and file viewer', icon: Layers, iconBg: 'from-blue-700 to-indigo-900' },

  // ☁️ 2. Cloud & DevOps Tools
  { name: 'kubectl', aptPackage: 'kubectl', dnfPackage: 'kubectl', category: 'Cloud & DevOps', description: 'Official Kubernetes command-line tool for controlling clusters', icon: Cloud, iconBg: 'from-blue-500 to-cyan-700' },
  { name: 'k9s', aptPackage: 'k9s', dnfPackage: 'k9s', category: 'Cloud & DevOps', description: 'Fast terminal-based UI to interact with Kubernetes clusters', icon: Terminal, iconBg: 'from-emerald-600 to-green-800' },
  { name: 'Helm', aptPackage: 'helm', dnfPackage: 'helm', category: 'Cloud & DevOps', description: 'Package manager for deploying Kubernetes applications and charts', icon: Box, iconBg: 'from-sky-600 to-indigo-700' },
  { name: 'Terraform', aptPackage: 'terraform', dnfPackage: 'terraform', category: 'Cloud & DevOps', description: 'Infrastructure as Code tool to build, change, and version resources', icon: Server, iconBg: 'from-purple-600 to-indigo-800' },
  { name: 'GitHub CLI (gh)', aptPackage: 'gh', dnfPackage: 'gh', category: 'Cloud & DevOps', description: 'GitHub on the command line (pull requests, issues, actions)', icon: Globe, iconBg: 'from-slate-700 to-zinc-900' },
  { name: 'AWS CLI', aptPackage: 'awscli', dnfPackage: 'awscli', category: 'Cloud & DevOps', description: 'Unified command-line tool to manage Amazon Web Services', icon: Cloud, iconBg: 'from-amber-600 to-orange-800' },
  { name: 'Ansible', aptPackage: 'ansible', dnfPackage: 'ansible', category: 'Cloud & DevOps', description: 'Radically simple IT automation, provisioning, and deployment', icon: Zap, iconBg: 'from-red-600 to-rose-800' },

  // 🔍 3. Database Clients & Tools
  { name: 'pgcli', aptPackage: 'pgcli', dnfPackage: 'pgcli', category: 'DB Clients', description: 'Smart PostgreSQL terminal client with auto-completion & syntax highlight', icon: Database, iconBg: 'from-blue-600 to-cyan-800' },
  { name: 'mycli', aptPackage: 'mycli', dnfPackage: 'mycli', category: 'DB Clients', description: 'Smart MySQL/MariaDB terminal client with auto-completion', icon: Database, iconBg: 'from-teal-600 to-emerald-800' },
  { name: 'redis-tools', aptPackage: 'redis-tools', dnfPackage: 'redis', category: 'DB Clients', description: 'CLI tools including redis-cli and benchmark utilities', icon: Database, iconBg: 'from-red-600 to-rose-700' },
  { name: 'sqlite3', aptPackage: 'sqlite3', dnfPackage: 'sqlite', category: 'DB Clients', description: 'Interactive command-line client for SQLite databases', icon: Database, iconBg: 'from-sky-600 to-blue-800' },
  { name: 'Adminer', aptPackage: 'adminer', dnfPackage: 'adminer', category: 'DB Clients', description: 'Full-featured database management tool in a single PHP file', icon: Globe, iconBg: 'from-indigo-600 to-purple-800' },

  // 🗄️ 4. Database Servers
  { name: 'PostgreSQL', aptPackage: 'postgresql', dnfPackage: 'postgresql-server', category: 'Database', description: 'Advanced open-source object-relational database server', icon: Database, iconBg: 'from-blue-600 to-indigo-800' },
  { name: 'MySQL Server', aptPackage: 'mysql-server', dnfPackage: 'mysql-server', category: 'Database', description: 'World standard relational database management system', icon: Database, iconBg: 'from-orange-600 to-amber-800' },
  { name: 'MariaDB Server', aptPackage: 'mariadb-server', dnfPackage: 'mariadb-server', category: 'Database', description: 'Fast, community-developed drop-in replacement for MySQL', icon: Database, iconBg: 'from-amber-600 to-yellow-800' },
  { name: 'Redis Server', aptPackage: 'redis-server', dnfPackage: 'redis', category: 'Database', description: 'In-memory data structure store for caching & message queues', icon: Database, iconBg: 'from-red-500 to-rose-700' },
  { name: 'MongoDB', aptPackage: 'mongodb-org', dnfPackage: 'mongodb-org', category: 'Database', description: 'Document-oriented NoSQL database for modern high-load apps', icon: Database, iconBg: 'from-emerald-600 to-green-800' },
  { name: 'Memcached', aptPackage: 'memcached', dnfPackage: 'memcached', category: 'Database', description: 'High-performance distributed memory object caching system', icon: Cpu, iconBg: 'from-cyan-600 to-teal-800' },

  // 🌐 5. Web Servers & Proxies
  { name: 'Nginx', aptPackage: 'nginx', dnfPackage: 'nginx', category: 'Web & Proxy', description: 'High-performance HTTP server, reverse proxy, and load balancer', icon: Globe, iconBg: 'from-emerald-500 to-green-700' },
  { name: 'Apache2 / httpd', aptPackage: 'apache2', dnfPackage: 'httpd', category: 'Web & Proxy', description: 'Reliable and extensible modular open-source HTTP server', icon: Globe, iconBg: 'from-red-600 to-amber-700' },
  { name: 'Caddy', aptPackage: 'caddy', dnfPackage: 'caddy', category: 'Web & Proxy', description: 'Modern web server with automatic HTTPS via Let\'s Encrypt', icon: Globe, iconBg: 'from-cyan-500 to-blue-700' },
  { name: 'HAProxy', aptPackage: 'haproxy', dnfPackage: 'haproxy', category: 'Web & Proxy', description: 'High-availability TCP/HTTP load balancer and proxy server', icon: Server, iconBg: 'from-blue-600 to-indigo-800' },
  { name: 'Traefik', aptPackage: 'traefik', dnfPackage: 'traefik', category: 'Web & Proxy', description: 'Cloud-native application proxy and ingress controller', icon: Cloud, iconBg: 'from-sky-500 to-blue-700' },

  // 💻 6. Languages & Runtimes
  { name: 'Node.js & NPM', aptPackage: 'nodejs', dnfPackage: 'nodejs', category: 'Development', description: 'JavaScript runtime built on Chrome\'s V8 engine with npm', icon: FileCode, iconBg: 'from-green-600 to-emerald-800' },
  { name: 'Python 3 & PIP', aptPackage: 'python3', dnfPackage: 'python3', category: 'Development', description: 'Interpreted high-level language for scripts, AI, and APIs', icon: FileCode, iconBg: 'from-blue-500 to-amber-600' },
  { name: 'Go (Golang)', aptPackage: 'golang', dnfPackage: 'golang', category: 'Development', description: 'Fast, statically typed compiled language designed by Google', icon: Zap, iconBg: 'from-cyan-600 to-blue-800' },
  { name: 'Rust & Cargo', aptPackage: 'rustc', dnfPackage: 'rust', category: 'Development', description: 'Memory-safe systems programming language and build system', icon: Cpu, iconBg: 'from-orange-600 to-amber-800' },
  { name: 'OpenJDK Java', aptPackage: 'default-jdk', dnfPackage: 'java-17-openjdk-devel', category: 'Development', description: 'Standard Java Development Kit and execution runtime', icon: FileCode, iconBg: 'from-red-600 to-rose-800' },
  { name: 'PHP & PHP-FPM', aptPackage: 'php', dnfPackage: 'php', category: 'Development', description: 'Server-side scripting language for dynamic web applications', icon: Globe, iconBg: 'from-indigo-600 to-purple-800' },
  { name: 'Git', aptPackage: 'git', dnfPackage: 'git', category: 'Development', description: 'Fast, scalable, distributed revision control system', icon: Layers, iconBg: 'from-orange-500 to-amber-700' },
  { name: 'Neovim', aptPackage: 'neovim', dnfPackage: 'neovim', category: 'Development', description: 'Hyperextensible Vim-based text editor for developers', icon: FileCode, iconBg: 'from-teal-500 to-emerald-700' },

  // 🐳 7. Containers & Virtualization
  { name: 'Docker Engine', aptPackage: 'docker.io', dnfPackage: 'docker-ce', category: 'Containers', description: 'Industry standard containerization platform for apps', icon: Server, iconBg: 'from-blue-500 to-cyan-600' },
  { name: 'Docker Compose', aptPackage: 'docker-compose-plugin', dnfPackage: 'docker-compose-plugin', category: 'Containers', description: 'Multi-container Docker orchestration tool', icon: Layers, iconBg: 'from-blue-600 to-indigo-700' },
  { name: 'Podman', aptPackage: 'podman', dnfPackage: 'podman', category: 'Containers', description: 'Daemonless, rootless container engine for OCI containers', icon: Box, iconBg: 'from-purple-600 to-pink-700' },
  { name: 'QEMU / KVM', aptPackage: 'qemu-kvm', dnfPackage: 'qemu-kvm', category: 'Containers', description: 'Hardware virtualization and machine emulator', icon: Cpu, iconBg: 'from-rose-600 to-red-800' },

  // 🛡️ 8. Security & Firewalls
  { name: 'UFW / Firewalld', aptPackage: 'ufw', dnfPackage: 'firewalld', category: 'Security', description: 'Host-based firewall configuration tool for Linux iptables', icon: Shield, iconBg: 'from-amber-500 to-orange-700' },
  { name: 'Fail2ban', aptPackage: 'fail2ban', dnfPackage: 'fail2ban', category: 'Security', description: 'Monitors logs and automatically bans brute-force IP attackers', icon: ShieldCheck, iconBg: 'from-rose-500 to-pink-700' },
  { name: 'Certbot (SSL)', aptPackage: 'certbot', dnfPackage: 'certbot', category: 'Security', description: 'Automated Let\'s Encrypt SSL/TLS certificates tool', icon: Key, iconBg: 'from-emerald-500 to-teal-700' },
  { name: 'WireGuard', aptPackage: 'wireguard', dnfPackage: 'wireguard-tools', category: 'Security', description: 'Extremely fast, modern, and secure VPN tunnel', icon: Shield, iconBg: 'from-blue-600 to-indigo-800' },
  { name: 'Lynis', aptPackage: 'lynis', dnfPackage: 'lynis', category: 'Security', description: 'Security auditing, vulnerability scan, and system hardening', icon: ShieldCheck, iconBg: 'from-indigo-600 to-violet-800' },
  { name: 'ClamAV', aptPackage: 'clamav', dnfPackage: 'clamav', category: 'Security', description: 'Open-source antivirus engine for servers and mail gateways', icon: Shield, iconBg: 'from-teal-600 to-cyan-800' },

  // 📊 9. Monitoring & Diagnostics
  { name: 'htop', aptPackage: 'htop', dnfPackage: 'htop', category: 'Monitoring', description: 'Interactive, real-time process viewer and system monitor', icon: Cpu, iconBg: 'from-cyan-500 to-teal-700' },
  { name: 'btop', aptPackage: 'btop', dnfPackage: 'btop', category: 'Monitoring', description: 'Modern resource monitor showing CPU, memory, disks, and network', icon: Cpu, iconBg: 'from-purple-500 to-pink-700' },
  { name: 'Glances', aptPackage: 'glances', dnfPackage: 'glances', category: 'Monitoring', description: 'Curses-based system monitoring tool with optional web interface', icon: Eye, iconBg: 'from-blue-500 to-sky-700' },
  { name: 'Netdata', aptPackage: 'netdata', dnfPackage: 'netdata', category: 'Monitoring', description: 'Real-time performance and health monitoring dashboards', icon: ActivityIcon, iconBg: 'from-emerald-500 to-green-700' },
  { name: 'Tmux', aptPackage: 'tmux', dnfPackage: 'tmux', category: 'Monitoring', description: 'Terminal multiplexer to keep background sessions alive', icon: Terminal, iconBg: 'from-purple-500 to-indigo-700' },
  { name: 'Ncdu', aptPackage: 'ncdu', dnfPackage: 'ncdu', category: 'Monitoring', description: 'Disk usage analyzer with an interactive ncurses interface', icon: HardDrive, iconBg: 'from-yellow-600 to-amber-800' },
  { name: 'Iperf3', aptPackage: 'iperf3', dnfPackage: 'iperf3', category: 'Monitoring', description: 'Active measurement tool for maximum achievable IP network bandwidth', icon: Globe, iconBg: 'from-indigo-500 to-blue-700' },
  { name: 'Speedtest CLI', aptPackage: 'speedtest-cli', dnfPackage: 'speedtest-cli', category: 'Monitoring', description: 'Command-line internet download/upload speed test utility', icon: Zap, iconBg: 'from-orange-500 to-amber-700' },
];

function ActivityIcon(props: any) {
  return <Cpu {...props} />;
}

interface ExecutionModalState {
  isOpen: boolean;
  packageName: string;
  operationType: 'install' | 'remove' | 'update' | 'upgrade-all';
  status: 'running' | 'success' | 'failed';
  title: string;
  command: string;
  output: string;
  exitCode?: number;
  errorMessage?: string;
}

export default function PackageManager() {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [tab, setTab] = useState<'curated' | 'installed' | 'upgrades' | 'search'>('curated');
  const [curatedCategory, setCuratedCategory] = useState<CuratedCategory>('All');
  const [curatedSearch, setCuratedSearch] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedPkgName, setSelectedPkgName] = useState<string | null>(null);
  const [pkgManager, setPkgManager] = useState<string>('apt');

  // Search Online Repo
  const [onlineQuery, setOnlineQuery] = useState('');
  const [onlineResults, setOnlineResults] = useState<PackageItem[]>([]);
  const [searchingOnline, setSearchingOnline] = useState(false);

  // Button loading states (track which package is being acted on)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Execution Modal state (MANDATORY clear SUCCESS or FAILED)
  const [execModal, setExecModal] = useState<ExecutionModalState | null>(null);

  // Notice Toast
  const [actionNotice, setActionNotice] = useState<{ text: string; isError: boolean } | null>(null);

  // Custom Package Install Modal
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [manualPkgInput, setManualPkgInput] = useState('');
  const [inspectPkg, setInspectPkg] = useState<PackageItem | null>(null);
  const [restrictedAction, setRestrictedAction] = useState<string | null>(null);

  // Row Right-Click Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; pkg: PackageItem } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const terminalLogRef = useRef<HTMLDivElement | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { hasSudo, isRoot, username } = useUserPrivilege();
  const { openApp } = useWindowManager();
  const { runTerminalCommand } = useEditorStore();

  // Detect Linux package manager on connection change
  useEffect(() => {
    packageDetectManager(activeConnId).then(pm => {
      if (pm && pm !== 'unknown') {
        setPkgManager(pm.toLowerCase());
      }
    }).catch(() => {});
  }, [activeConnId]);

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Auto-scroll terminal log in execution modal
  useEffect(() => {
    if (terminalLogRef.current) {
      terminalLogRef.current.scrollTop = terminalLogRef.current.scrollHeight;
    }
  }, [execModal?.output]);

  const loadPackages = useCallback(async () => {
    setLoading(true);
    try {
      const [allPkgs, upPkgs] = await Promise.all([
        packageList(activeConnId),
        packageUpgradable(activeConnId)
      ]);

      const upMap = new Map<string, string>();
      if (upPkgs && Array.isArray(upPkgs)) {
        upPkgs.forEach((p: any) => upMap.set(p.name, p.version));
      }

      if (allPkgs && Array.isArray(allPkgs)) {
        setPackages(allPkgs.map((p: any) => ({
          name: p.name,
          version: p.version,
          arch: p.arch || 'amd64',
          size: p.size ? `${(p.size / 1024).toFixed(0)} KB` : '—',
          description: p.description || '',
          upgradable: upMap.has(p.name),
          newVersion: upMap.get(p.name)
        })));
      } else {
        setPackages([]);
      }
    } catch (err) {
      console.warn('Failed to load packages:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const upgrades = useMemo(() => packages.filter(p => p.upgradable), [packages]);

  const installedMap = useMemo(() => {
    const set = new Set<string>();
    packages.forEach(p => {
      set.add(p.name.toLowerCase());
      // Also match without architecture or prefixes
      const baseName = p.name.split(':')[0].toLowerCase();
      set.add(baseName);
    });
    return set;
  }, [packages]);

  // Helper: Resolve effective package name based on detected Linux package manager (APT vs DNF)
  const getPackageName = useCallback((app: CuratedApp): string => {
    if (pkgManager === 'dnf' || pkgManager === 'yum') {
      return app.dnfPackage || app.aptPackage;
    }
    return app.aptPackage || app.dnfPackage;
  }, [pkgManager]);

  // Check if a curated app is installed
  const isAppInstalled = useCallback((app: CuratedApp): boolean => {
    const apt = app.aptPackage.toLowerCase();
    const dnf = app.dnfPackage.toLowerCase();
    const cleanName = app.name.toLowerCase();
    return installedMap.has(apt) || installedMap.has(dnf) || installedMap.has(cleanName);
  }, [installedMap]);

  // ────────────────────────────────────────────────────────────────────────────
  // EXECUTION ACTIONS (WITH MANDATORY SUCCESS / FAILED VERIFICATION)
  // ────────────────────────────────────────────────────────────────────────────

  // 1. Upgrade ALL packages
  const handleUpgradeAll = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Upgrade All System Packages');
      return;
    }
    setActionInProgress('all');
    const cmdStr = pkgManager === 'dnf' ? 'dnf upgrade -y' : 'apt-get update && apt-get upgrade -y';
    setExecModal({
      isOpen: true,
      packageName: 'all',
      operationType: 'upgrade-all',
      status: 'running',
      title: 'Full System Upgrade',
      command: cmdStr,
      output: `[SSH Desktop Package Manager]\r\nInitiating full system upgrade via ${pkgManager.toUpperCase()}...\r\nRunning: ${cmdStr}\r\nPlease wait while packages are being downloaded and configured...\r\n\r\n`
    });

    try {
      const res = await packageUpdate(activeConnId);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'success',
        exitCode: 0,
        output: prev.output + (res || 'All system packages upgraded successfully.\r\n') + '\r\n[Process completed successfully with exit code 0]'
      } : null);
      setActionNotice({ text: 'All packages successfully updated to latest versions!', isError: false });
      await loadPackages();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'failed',
        exitCode: 1,
        errorMessage: errMsg,
        output: prev.output + `\r\n[ERROR] Upgrade operation failed:\r\n${errMsg}\r\n[Process terminated with error]`
      } : null);
      setActionNotice({ text: `Upgrade error: ${errMsg}`, isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  // 2. Upgrade SINGLE package
  const handleUpgradeSingle = async (name: string) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Upgrade Package '${name}'`);
      return;
    }
    setActionInProgress(name);
    const cmdStr = pkgManager === 'dnf' ? `dnf upgrade -y '${name}'` : `apt-get install --only-upgrade -y '${name}'`;
    setExecModal({
      isOpen: true,
      packageName: name,
      operationType: 'update',
      status: 'running',
      title: `Upgrading Package '${name}'`,
      command: cmdStr,
      output: `[SSH Desktop Package Manager]\r\nUpgrading '${name}' to latest repository version...\r\nRunning: ${cmdStr}\r\nPlease wait...\r\n\r\n`
    });

    try {
      const res = await packageInstall(activeConnId, name);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'success',
        exitCode: 0,
        output: prev.output + (res || `Package '${name}' upgraded successfully.\r\n`) + '\r\n[Process completed successfully with exit code 0]'
      } : null);
      setActionNotice({ text: `Package '${name}' upgraded successfully!`, isError: false });
      await loadPackages();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'failed',
        exitCode: 1,
        errorMessage: errMsg,
        output: prev.output + `\r\n[ERROR] Upgrade failed for '${name}':\r\n${errMsg}\r\n[Process terminated with error]`
      } : null);
      setActionNotice({ text: `Error updating ${name}: ${errMsg}`, isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  // 3. Install package
  const handleInstallPackage = async (name: string) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Install Package '${name}'`);
      return;
    }
    setActionInProgress(name);
    setShowInstallModal(false);
    setContextMenu(null);
    const cmdStr = pkgManager === 'dnf' ? `dnf install -y '${name}'` : `DEBIAN_FRONTEND=noninteractive apt-get install -y '${name}'`;
    setExecModal({
      isOpen: true,
      packageName: name,
      operationType: 'install',
      status: 'running',
      title: `Installing Package '${name}'`,
      command: cmdStr,
      output: `[SSH Desktop Package Manager]\r\nTarget OS Manager: ${pkgManager.toUpperCase()}\r\nRunning: ${cmdStr}\r\nResolving dependencies and downloading packages from distribution mirrors...\r\n\r\n`
    });

    try {
      const res = await packageInstall(activeConnId, name);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'success',
        exitCode: 0,
        output: prev.output + (res || `Package '${name}' installed successfully.\r\n`) + '\r\n=========================================\r\n[✓ SUCCESS] Package installed successfully!\r\n========================================='
      } : null);
      setActionNotice({ text: `Package '${name}' installed successfully!`, isError: false });
      await loadPackages();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'failed',
        exitCode: 1,
        errorMessage: errMsg,
        output: prev.output + `\r\n=========================================\r\n[✕ FAILED] Install encountered an error:\r\n${errMsg}\r\n=========================================`
      } : null);
      setActionNotice({ text: `Failed to install ${name}: ${errMsg}`, isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  // 4. Uninstall package
  const handleRemovePackage = async (name: string) => {
    setContextMenu(null);
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Uninstall Package '${name}'`);
      return;
    }
    if (!confirm(`Are you sure you want to uninstall '${name}' from server?`)) return;
    setActionInProgress(name);
    const cmdStr = pkgManager === 'dnf' ? `dnf remove -y '${name}'` : `apt-get remove -y '${name}'`;
    setExecModal({
      isOpen: true,
      packageName: name,
      operationType: 'remove',
      status: 'running',
      title: `Uninstalling Package '${name}'`,
      command: cmdStr,
      output: `[SSH Desktop Package Manager]\r\nUninstalling '${name}' via ${pkgManager.toUpperCase()}...\r\nRunning: ${cmdStr}\r\nRemoving package binaries and updating system package database...\r\n\r\n`
    });

    try {
      const res = await packageRemove(activeConnId, name);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'success',
        exitCode: 0,
        output: prev.output + (res || `Package '${name}' uninstalled.\r\n`) + '\r\n=========================================\r\n[✓ SUCCESS] Package uninstalled successfully!\r\n========================================='
      } : null);
      setPackages(prev => prev.filter(p => p.name !== name));
      setActionNotice({ text: `Package '${name}' uninstalled.`, isError: false });
      if (inspectPkg?.name === name) setInspectPkg(null);
      await loadPackages();
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setExecModal(prev => prev ? {
        ...prev,
        status: 'failed',
        exitCode: 1,
        errorMessage: errMsg,
        output: prev.output + `\r\n=========================================\r\n[✕ FAILED] Removal failed for '${name}':\r\n${errMsg}\r\n=========================================`
      } : null);
      setActionNotice({ text: `Failed to remove ${name}: ${errMsg}`, isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  // Online Package Search
  const handleOnlineSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onlineQuery.trim()) return;
    setSearchingOnline(true);
    try {
      const res = await packageSearch(activeConnId, onlineQuery.trim());
      if (res && Array.isArray(res)) {
        setOnlineResults(res.map((p: any) => ({
          name: p.name,
          version: p.version || 'latest',
          arch: p.arch || 'all',
          size: p.size ? `${(p.size / 1024).toFixed(0)} KB` : '—',
          description: p.description || 'Package from remote distribution repository'
        })));
      } else {
        setOnlineResults([]);
      }
    } catch (err: any) {
      console.warn('Search error:', err);
    } finally {
      setSearchingOnline(false);
    }
  };

  // Filtered packages for Installed / Upgrades tab
  const filteredInstalled = useMemo(() => {
    return packages.filter(p => {
      if (tab === 'upgrades') return p.upgradable;
      return p.name.toLowerCase().includes(search.toLowerCase()) || 
             p.description.toLowerCase().includes(search.toLowerCase());
    });
  }, [packages, tab, search]);

  // Filtered Curated App Store
  const filteredCuratedApps = useMemo(() => {
    return CURATED_APPS.filter(app => {
      const matchesCategory = curatedCategory === 'All' || app.category === curatedCategory;
      const effectivePkg = getPackageName(app);
      const matchesSearch = !curatedSearch.trim() || 
        app.name.toLowerCase().includes(curatedSearch.toLowerCase()) ||
        effectivePkg.toLowerCase().includes(curatedSearch.toLowerCase()) ||
        app.description.toLowerCase().includes(curatedSearch.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [curatedCategory, curatedSearch, getPackageName]);

  // Safe Close for Execution Modal: Warn if operation is currently running!
  const handleCloseExecModal = () => {
    if (execModal?.status === 'running') {
      if (!confirm('The package operation is still running on the remote server. Closing this window will not stop the background task. Are you sure you want to close?')) {
        return;
      }
    }
    setExecModal(null);
  };

  const isGlobalBusy = loading || searchingOnline || !!actionInProgress;

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative ${isGlobalBusy ? 'cursor-wait' : ''}`}>
      {/* Top Active Progress Bar */}
      {isGlobalBusy && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-pulse z-40 pointer-events-none" />
      )}

      {/* macOS Top Navigation Toolbar */}
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3 overflow-x-auto scrollbar-thin">
        {/* Segmented Tab Controls */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="mac-segmented-container">
            <button
              onClick={() => setTab('curated')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${tab === 'curated' ? 'active' : ''}`}
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-400" />
              <span>App Store</span>
            </button>
            <button
              onClick={() => setTab('installed')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${tab === 'installed' ? 'active' : ''}`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Installed ({packages.length})</span>
            </button>
            <button
              onClick={() => setTab('upgrades')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${tab === 'upgrades' ? 'active' : ''}`}
            >
              <ArrowUpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Updates</span>
              {upgrades.length > 0 && (
                <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center ml-1">
                  {upgrades.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setTab('search')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${tab === 'search' ? 'active' : ''}`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search Repo</span>
            </button>
          </div>

          {/* OS Package Manager Badge */}
          <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-mono text-gray-400 hidden sm:inline-block" title="Detected Server Package Manager">
            backend: <strong className="text-blue-400 uppercase">{pkgManager}</strong>
          </span>
        </div>

        {/* Right Tools: Install Package, Search, Refresh */}
        <div className="flex items-center space-x-2 shrink-0">
          {tab === 'upgrades' && upgrades.length > 0 && (
            <button
              onClick={handleUpgradeAll}
              disabled={actionInProgress === 'all'}
              className="mac-btn mac-btn-success mac-btn-sheen flex items-center space-x-1.5 active:scale-95 disabled:opacity-50"
            >
              {actionInProgress === 'all' ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              <span>Upgrade All ({upgrades.length})</span>
            </button>
          )}

          <button
            onClick={() => setShowInstallModal(true)}
            className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5 active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Install Custom</span>
          </button>

          {['installed', 'upgrades'].includes(tab) && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter packages..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-36 focus:w-48 transition-all shadow-inner"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          <button
            onClick={loadPackages}
            disabled={loading}
            className="mac-btn-icon active:scale-95"
            title="Refresh Packages"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice Toast */}
      {actionNotice && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-xl text-xs flex items-center justify-between animate-in fade-in slide-in-from-top-1 ${
          actionNotice.isError ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}>
          <span className="font-mono">{actionNotice.text}</span>
          <button onClick={() => setActionNotice(null)} className="text-gray-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 bg-[#161622] flex flex-col overflow-hidden relative">
        <div className="px-4 pt-3 shrink-0">
          <PermissionAlertBanner appName="Package Manager" />
        </div>

        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {/* 1. CURATED APP STORE TAB (POPULAR SOFTWARES WITH CATEGORIES)                 */}
        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {tab === 'curated' && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Category Filter Pills & App Store Search */}
            <div className="bg-[#141420]/80 backdrop-blur-md px-5 py-2.5 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              {/* Category Pills */}
              <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-0.5 max-w-full">
                {CURATED_CATEGORIES.map(cat => {
                  const isActive = curatedCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setCuratedCategory(cat)}
                      className={`px-3 py-1 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer active:scale-95 ${
                        isActive 
                          ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-500/20 border border-blue-400/40' 
                          : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 border border-white/5'
                      }`}
                    >
                      {cat}
                    </button>
                  );
                })}
              </div>

              {/* App Store Filter Input */}
              <div className="relative shrink-0">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter store apps..."
                  value={curatedSearch}
                  onChange={e => setCuratedSearch(e.target.value)}
                  className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-44 focus:w-56 transition-all"
                />
                {curatedSearch && (
                  <button onClick={() => setCuratedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* App Store Grid */}
            <div className="flex-1 overflow-y-auto p-5 scrollbar-thin">
              <div className="max-w-6xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-blue-400" />
                      <span>Popular Linux Applications & Tools</span>
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      Curated server software, CLI power tools, cloud utilities, and databases with automatic <strong>{pkgManager.toUpperCase()}</strong> resolution.
                    </p>
                  </div>
                  <span className="text-xs text-gray-500 font-mono">
                    Showing {filteredCuratedApps.length} apps
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 pb-6">
                  {filteredCuratedApps.map(app => {
                    const effectivePkg = getPackageName(app);
                    const isInstalled = isAppInstalled(app);
                    const isBusy = actionInProgress === effectivePkg;
                    const Icon = app.icon;

                    return (
                      <div 
                        key={app.name}
                        className={`bg-[#1a1d2e] border rounded-2xl p-4 flex flex-col justify-between space-y-3 transition-all hover:bg-[#20243a] shadow-sm ${
                          isInstalled ? 'border-emerald-500/25 bg-[#17202a]/60' : 'border-white/[0.08] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-start space-x-3">
                          <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${app.iconBg} flex items-center justify-center text-white shrink-0 shadow-md border border-white/20`}>
                            <Icon className="w-6 h-6 drop-shadow" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-sm text-white truncate" title={app.name}>{app.name}</h4>
                              <span className="text-[10px] text-gray-400 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 font-medium shrink-0 ml-1">
                                {app.category}
                              </span>
                            </div>
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2 leading-relaxed font-sans" title={app.description}>
                              {app.description}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs">
                          <span className="font-mono text-[11px] text-gray-400 truncate max-w-[130px]" title={`Package: ${effectivePkg}`}>
                            {effectivePkg}
                          </span>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {isInstalled ? (
                              <>
                                <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold flex items-center space-x-1">
                                  <Check className="w-3 h-3" />
                                  <span>Installed</span>
                                </span>
                                <button
                                  onClick={() => handleInstallPackage(effectivePkg)}
                                  disabled={isBusy}
                                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all active:scale-95"
                                  title="Reinstall / Reconfigure"
                                >
                                  {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" /> : <RotateCw className="w-3.5 h-3.5" />}
                                </button>
                                <button
                                  onClick={() => handleRemovePackage(effectivePkg)}
                                  disabled={isBusy}
                                  className="p-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-all active:scale-95"
                                  title="Uninstall"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleInstallPackage(effectivePkg)}
                                disabled={isBusy}
                                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center space-x-1 cursor-pointer"
                              >
                                {isBusy ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Installing...</span>
                                  </>
                                ) : (
                                  <>
                                    <Download className="w-3.5 h-3.5" />
                                    <span>Get</span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {/* 2. INSTALLED & UPGRADES TAB (WITH ROW RIGHT-CLICK CONTEXT MENU)              */}
        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {['installed', 'upgrades'].includes(tab) && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Package Name</th>
                  <th className="py-2.5 px-3 w-40">Installed Version</th>
                  <th className="py-2.5 px-3 w-24">Arch</th>
                  <th className="py-2.5 px-3 w-28">Size</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 text-right w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredInstalled.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Querying package database...' : tab === 'upgrades' ? 'All packages are up to date!' : 'No matching packages found'}
                    </td>
                  </tr>
                ) : (
                  filteredInstalled.map((pkg, idx) => {
                    const isSelected = selectedPkgName === pkg.name;
                    const isUpgradable = pkg.upgradable;
                    const isBusy = actionInProgress === pkg.name;

                    return (
                      <tr
                        key={pkg.name}
                        onClick={() => setSelectedPkgName(pkg.name)}
                        onDoubleClick={() => setInspectPkg(pkg)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: Math.min(e.clientX, window.innerWidth - 240),
                            y: Math.min(e.clientY, window.innerHeight - 280),
                            pkg
                          });
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium'
                            : idx % 2 === 1
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-bold text-white flex items-center space-x-2">
                          <Package className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="truncate max-w-xs">{pkg.name}</span>
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-gray-300">{pkg.version}</span>
                            {isUpgradable && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                                ➜ {pkg.newVersion}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-gray-400">{pkg.arch}</td>
                        <td className="py-2 px-3 text-gray-400">{pkg.size}</td>
                        <td className="py-2 px-3 text-gray-400 truncate max-w-sm font-sans" title={pkg.description}>
                          {pkg.description || '—'}
                        </td>
                        <td className="py-2 px-3 text-right space-x-1.5">
                          {isUpgradable && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpgradeSingle(pkg.name);
                              }}
                              disabled={isBusy}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold transition-all active:scale-95 disabled:opacity-50"
                              title="Update this package specifically"
                            >
                              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update'}
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemovePackage(pkg.name);
                            }}
                            disabled={isBusy}
                            className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors disabled:opacity-50"
                            title="Uninstall Package"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {/* 3. REPOSITORY SEARCH TAB                                                     */}
        {/* ──────────────────────────────────────────────────────────────────────────── */}
        {tab === 'search' && (
          <div className="flex-1 p-5 flex flex-col space-y-4 overflow-y-auto scrollbar-thin">
            <div className="bg-[#1a1d2e] border border-white/[0.08] p-4 rounded-2xl max-w-2xl shadow-sm">
              <h3 className="font-bold text-sm text-white mb-1">Search Linux Remote Repositories</h3>
              <p className="text-xs text-gray-400 mb-3">
                Query packages available from your remote distribution mirrors ({pkgManager === 'dnf' ? 'dnf search' : 'apt-cache search'}).
              </p>

              <form onSubmit={handleOnlineSearch} className="flex items-center space-x-2">
                <input
                  type="text"
                  value={onlineQuery}
                  onChange={e => setOnlineQuery(e.target.value)}
                  placeholder="e.g. htop, ffmpeg, redis, golang, ruby"
                  className="bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 flex-1 font-mono"
                />
                <button
                  type="submit"
                  disabled={searchingOnline || !onlineQuery.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 flex items-center space-x-1.5"
                >
                  {searchingOnline ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>{searchingOnline ? 'Searching...' : 'Search'}</span>
                </button>
              </form>
            </div>

            {/* Results Grid */}
            <div className="flex-1 max-w-2xl space-y-2">
              {onlineResults.length === 0 ? (
                <div className="text-center py-12 text-gray-500 text-xs">
                  {searchingOnline ? 'Scanning repository index...' : 'Type a package query above to search online package index.'}
                </div>
              ) : (
                onlineResults.map(p => {
                  const isInstalled = installedMap.has(p.name.toLowerCase());
                  const isBusy = actionInProgress === p.name;

                  return (
                    <div 
                      key={p.name}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: Math.min(e.clientX, window.innerWidth - 240),
                          y: Math.min(e.clientY, window.innerHeight - 280),
                          pkg: p
                        });
                      }}
                      className="bg-[#1a1d2e] border border-white/[0.06] rounded-xl p-3 flex items-center justify-between hover:border-white/20 transition-all"
                    >
                      <div className="min-w-0 pr-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-xs text-white">{p.name}</span>
                          <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded-full">{p.version}</span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1 truncate max-w-lg">{p.description}</p>
                      </div>

                      <div className="shrink-0">
                        {isInstalled ? (
                          <div className="flex items-center space-x-2">
                            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-semibold flex items-center space-x-1">
                              <Check className="w-3 h-3" />
                              <span>Installed</span>
                            </span>
                            <button
                              onClick={() => handleRemovePackage(p.name)}
                              disabled={isBusy}
                              className="text-gray-500 hover:text-rose-400 p-1"
                              title="Uninstall"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleInstallPackage(p.name)}
                            disabled={isBusy}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1"
                          >
                            {isBusy ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span>Installing...</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                <span>Install</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* 4. ROW RIGHT-CLICK CONTEXT MENU                                              */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {contextMenu && (
        <PortalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="bg-[#1e2030]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-1.5 min-w-[210px] text-xs font-sans text-gray-200"
        >
          <div className="px-2.5 py-1.5 border-b border-white/10 mb-1">
            <span className="font-mono font-bold text-white block truncate">{contextMenu.pkg.name}</span>
            <span className="text-[10px] text-gray-400 font-sans block truncate">{contextMenu.pkg.version || 'Package Option'}</span>
          </div>

          <button
            onClick={() => {
              setInspectPkg(contextMenu.pkg);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-600/30 text-gray-200 hover:text-white flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-blue-400" />
            <span>View Package Details</span>
          </button>

          <button
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.pkg.name);
              setActionNotice({ text: `Copied '${contextMenu.pkg.name}' to clipboard`, isError: false });
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-600/30 text-gray-200 hover:text-white flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5 text-gray-400" />
            <span>Copy Package Name</span>
          </button>

          <button
            onClick={() => {
              const cmd = pkgManager === 'dnf' ? `dnf info '${contextMenu.pkg.name}'` : `dpkg -s '${contextMenu.pkg.name}'`;
              runTerminalCommand(cmd);
              openApp('terminal', 'Terminal');
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-600/30 text-gray-200 hover:text-white flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Inspect in Terminal</span>
          </button>

          <div className="my-1 border-t border-white/10" />

          {contextMenu.pkg.upgradable ? (
            <button
              onClick={() => {
                handleUpgradeSingle(contextMenu.pkg.name);
                setContextMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-amber-600/30 text-amber-300 hover:text-amber-200 flex items-center space-x-2 transition-colors cursor-pointer"
            >
              <ArrowUpCircle className="w-3.5 h-3.5 text-amber-400" />
              <span>Upgrade Package</span>
            </button>
          ) : (
            <button
              onClick={() => {
                handleInstallPackage(contextMenu.pkg.name);
                setContextMenu(null);
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-blue-600/30 text-gray-200 hover:text-white flex items-center space-x-2 transition-colors cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-400" />
              <span>Reinstall Package</span>
            </button>
          )}

          <button
            onClick={() => {
              handleRemovePackage(contextMenu.pkg.name);
              setContextMenu(null);
            }}
            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-600/30 text-rose-300 hover:text-rose-200 flex items-center space-x-2 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Uninstall Package</span>
          </button>
        </PortalContextMenu>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* 5. PACKAGE DETAILS INSPECT MODAL                                             */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {inspectPkg && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">{inspectPkg.name}</h3>
                  <span className="text-xs text-gray-400 font-mono">v{inspectPkg.version} ({inspectPkg.arch})</span>
                </div>
              </div>
              <button onClick={() => setInspectPkg(null)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 block font-medium mb-1">Description</label>
                <div className="bg-[#101018] border border-white/10 rounded-xl p-3 text-gray-200 leading-relaxed font-sans max-h-36 overflow-y-auto">
                  {inspectPkg.description || 'No detailed description available for this package.'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 font-mono">
                <div className="bg-[#101018] p-2.5 rounded-xl border border-white/5">
                  <span className="text-gray-500 block text-[10px]">INSTALLED SIZE</span>
                  <span className="text-gray-200 font-semibold">{inspectPkg.size || '—'}</span>
                </div>
                <div className="bg-[#101018] p-2.5 rounded-xl border border-white/5">
                  <span className="text-gray-500 block text-[10px]">ARCHITECTURE</span>
                  <span className="text-gray-200 font-semibold">{inspectPkg.arch}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-white/10">
              <button
                onClick={() => {
                  const cmd = pkgManager === 'dnf' ? `dnf info '${inspectPkg.name}'` : `dpkg -s '${inspectPkg.name}'`;
                  runTerminalCommand(cmd);
                  openApp('terminal', 'Terminal');
                  setInspectPkg(null);
                }}
                className="px-3.5 py-2 rounded-xl text-xs bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white flex items-center space-x-1.5"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Open in Terminal</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleRemovePackage(inspectPkg.name)}
                  className="px-3.5 py-2 rounded-xl text-xs bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold"
                >
                  Uninstall
                </button>
                <button
                  onClick={() => setInspectPkg(null)}
                  className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* 6. INSTALL CUSTOM LINUX PACKAGE MODAL                                        */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              if (manualPkgInput.trim()) {
                handleInstallPackage(manualPkgInput.trim());
                setManualPkgInput('');
              }
            }}
            className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Package className="w-4 h-4 text-blue-400" />
                <span>Install Custom Linux Package</span>
              </div>
              <button type="button" onClick={() => setShowInstallModal(false)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs text-gray-300 block mb-1 font-medium">Package Name</label>
              <input
                type="text"
                autoFocus
                required
                value={manualPkgInput}
                onChange={e => setManualPkgInput(e.target.value)}
                placeholder="e.g. nginx, git, htop, curl, nodejs, build-essential"
                className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">
                Will execute native package installer ({pkgManager === 'dnf' ? 'dnf install -y' : 'apt-get install -y'})
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!manualPkgInput.trim()}
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 font-semibold text-white shadow-md transition-all active:scale-95 cursor-pointer"
              >
                Install Now
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {/* 7. MANDATORY SUCCESS / FAILED EXECUTION OUTPUT MODAL                         */}
      {/* ──────────────────────────────────────────────────────────────────────────── */}
      {execModal?.isOpen && (
        <div 
          className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200"
          onClick={handleCloseExecModal}
        >
          <div 
            className="bg-[#181a2c] border border-white/20 rounded-3xl w-full max-w-2xl h-[520px] flex flex-col shadow-2xl overflow-hidden font-sans"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-white/10 bg-[#121422] flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-3">
                <div className="flex space-x-1.5 items-center mr-1">
                  <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
                  <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
                </div>
                <div className="flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-blue-400" />
                  <span className="font-sans text-xs font-bold text-white tracking-wide">{execModal.title}</span>
                </div>
              </div>

              {/* Status Badge */}
              <div className="flex items-center space-x-2">
                {execModal.status === 'running' && (
                  <span className="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-[11px] font-bold flex items-center space-x-1.5 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>IN PROGRESS...</span>
                  </span>
                )}
                {execModal.status === 'success' && (
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center space-x-1.5 shadow-[0_0_12px_rgba(52,211,153,0.35)]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>SUCCESS</span>
                  </span>
                )}
                {execModal.status === 'failed' && (
                  <span className="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold flex items-center space-x-1.5 shadow-[0_0_12px_rgba(244,63,94,0.35)]">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    <span>FAILED</span>
                  </span>
                )}

                <button 
                  onClick={handleCloseExecModal} 
                  className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                  title="Close Window"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Prominent Mandatory Status Banner */}
            <div className={`px-5 py-3 border-b text-xs flex items-center space-x-3 shrink-0 ${
              execModal.status === 'running'
                ? 'bg-blue-950/40 border-blue-500/30 text-blue-200'
                : execModal.status === 'success'
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/50 border-rose-500/40 text-rose-200'
            }`}>
              {execModal.status === 'running' && (
                <>
                  <Loader2 className="w-5 h-5 text-blue-400 animate-spin shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-white">Execution in progress on server...</p>
                    <p className="text-[11px] text-blue-300/80">Please wait while the remote package manager downloads, unpacks, and configures files.</p>
                  </div>
                </>
              )}
              {execModal.status === 'success' && (
                <>
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-emerald-300 text-sm">Operation Completed Successfully (Exit Code: 0)</p>
                    <p className="text-[11px] text-emerald-200/80">Package '{execModal.packageName}' was processed with zero errors. All system caches updated.</p>
                  </div>
                </>
              )}
              {execModal.status === 'failed' && (
                <>
                  <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  <div className="flex-1">
                    <p className="font-semibold text-rose-300 text-sm">Operation Failed (Exit Code: {execModal.exitCode ?? 1})</p>
                    <p className="text-[11px] text-rose-200/80">{execModal.errorMessage || 'The server reported an error during package execution. Please check terminal output below.'}</p>
                  </div>
                </>
              )}
            </div>

            {/* Live Terminal Log Area */}
            <div 
              ref={terminalLogRef}
              className="flex-1 p-4 bg-[#0d0f18] font-mono text-[11px] text-gray-300 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed scrollbar-thin shadow-inner"
            >
              {execModal.output}
            </div>

            {/* Bottom Actions Bar */}
            <div className="px-5 py-3 bg-[#121422] border-t border-white/[0.08] flex items-center justify-between text-xs shrink-0">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(execModal.output);
                    setActionNotice({ text: 'Terminal log copied to clipboard', isError: false });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white flex items-center space-x-1.5 transition-all"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Log</span>
                </button>
                <span className="text-gray-500 font-mono text-[11px]">
                  cmd: {execModal.command}
                </span>
              </div>

              <div className="flex items-center space-x-2">
                {execModal.status === 'failed' && (
                  <button
                    onClick={() => {
                      if (execModal.operationType === 'install') {
                        handleInstallPackage(execModal.packageName);
                      } else if (execModal.operationType === 'remove') {
                        handleRemovePackage(execModal.packageName);
                      } else if (execModal.operationType === 'update') {
                        handleUpgradeSingle(execModal.packageName);
                      } else {
                        handleUpgradeAll();
                      }
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-semibold transition-all active:scale-95 cursor-pointer shadow-md"
                  >
                    Retry Operation
                  </button>
                )}

                <button
                  onClick={handleCloseExecModal}
                  className={`px-5 py-2 text-white rounded-xl font-semibold transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5 ${
                    execModal.status === 'success'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-600/30'
                      : execModal.status === 'failed'
                      ? 'bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/30'
                      : 'bg-white/10 hover:bg-white/20 text-gray-300'
                  }`}
                >
                  {execModal.status === 'success' ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Done (Close Window)</span>
                    </>
                  ) : execModal.status === 'failed' ? (
                    <span>Close Window</span>
                  ) : (
                    <span>Dismiss Window</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Permission Denied Alert Modal */}
      <PermissionAlertModal
        isOpen={!!restrictedAction}
        onClose={() => setRestrictedAction(null)}
        actionName={restrictedAction || ''}
        username={username}
        appName="Package Manager"
      />
    </div>
  );
}
