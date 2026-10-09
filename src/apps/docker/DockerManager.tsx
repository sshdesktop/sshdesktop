import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Container, Layers, Play, Square, RotateCw, Trash2, 
  Terminal, Search, Plus, RefreshCw, AlertCircle, FileText,
  Pause, HardDrive, Network, Info, Copy, Check, ExternalLink,
  Activity, Cpu, Server, X, Shield, Download, ChevronRight,
  Filter, PlayCircle, Eye, Settings, ArrowDownToLine, Zap,
  CheckCircle2, AlertTriangle, HelpCircle, TerminalSquare,
  Lock, CheckSquare, Loader2, StopCircle
} from 'lucide-react';
import { dockerContainers, dockerAction, dockerLogs, dockerImages, dockerImageRemove, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'paused' | 'stopped';
  statusText: string;
  ports: string;
  created: string;
  cpu: string;
  mem: string;
}

interface ImageItem {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

interface VolumeItem {
  name: string;
  driver: string;
  scope: string;
  mountpoint?: string;
  size?: string;
}

interface NetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnet?: string;
}

interface ContainerInspectData {
  id: string;
  name: string;
  image: string;
  status: string;
  startedAt: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
  restartPolicy: string;
  env: string[];
  ports: { hostPort: string; containerPort: string; protocol: string }[];
  mounts: { source: string; destination: string; mode: string; type: string }[];
}

export default function DockerManager() {
  const [activeTab, setActiveTab] = useState<'containers' | 'images' | 'volumes' | 'networks' | 'system'>('containers');
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Inspector State
  const [inspectTarget, setInspectTarget] = useState<ContainerItem | null>(null);
  const [inspectData, setInspectData] = useState<ContainerInspectData | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectTab, setInspectTab] = useState<'overview' | 'env' | 'ports' | 'mounts'>('overview');

  // Logs Modal State
  const [selectedLogs, setSelectedLogs] = useState<ContainerItem | null>(null);
  const [logsText, setLogsText] = useState<string>('');
  const [logsLines, setLogsLines] = useState<number>(100);
  const [logsFilter, setLogsFilter] = useState<string>('');
  const [logsCopied, setLogsCopied] = useState(false);
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Run Container Modal State
  const [showRunModal, setShowRunModal] = useState(false);
  const [runImage, setRunImage] = useState('');
  const [runName, setRunName] = useState('');
  const [runPorts, setRunPorts] = useState('');
  const [runVolumes, setRunVolumes] = useState('');
  const [runEnv, setRunEnv] = useState('');
  const [runRestart, setRunRestart] = useState('unless-stopped');
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);
  const [runModalError, setRunModalError] = useState<string | null>(null);

  // Pull Image Modal State
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullImageInput, setPullImageInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullLogs, setPullLogs] = useState('');

  // Exec Modal State
  const [execTarget, setExecTarget] = useState<ContainerItem | null>(null);
  const [execCmd, setExecCmd] = useState('');
  const [execOutput, setExecOutput] = useState('');
  const [isExecRunning, setIsExecRunning] = useState(false);

  // System Prune Modal
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [isPruning, setIsPruning] = useState(false);
  const [systemDfText, setSystemDfText] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const runTerminalCommand = useEditorStore(s => s.runTerminalCommand);

  // Selection & Bulk Actions State
  const [selectedContainerIds, setSelectedContainerIds] = useState<Set<string>>(new Set());

  // Action loading tracker (container action, bulk action, image deletion)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Row Right-Click Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    container?: ContainerItem;
    image?: ImageItem;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Context Menu outside click & escape handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setActionFeedback({ message, type });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  // Main DataLoader
  const loadDockerData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Containers
      const cList = await dockerContainers(activeConnId);
      if (cList && Array.isArray(cList)) {
        setContainers(cList.map((c: any) => {
          const rawStatus = (c.status || '').toLowerCase();
          const rawState = (c.state || '').toLowerCase();
          let st: 'running' | 'paused' | 'stopped' = 'stopped';
          if (rawState.includes('pause') || rawStatus.includes('paused')) {
            st = 'paused';
          } else if (rawState === 'running' || rawStatus.includes('up')) {
            st = 'running';
          }

          return {
            id: (c.id || '').slice(0, 12),
            name: (c.name || 'container').replace(/^\//, ''),
            image: c.image || '',
            status: st,
            statusText: c.status || 'Active',
            ports: c.ports || '—',
            created: c.created || 'Recently',
            cpu: c.cpu_percent ? `${c.cpu_percent}%` : '0.0%',
            mem: c.mem_usage || '—',
          };
        }));
      } else {
        setContainers([]);
      }

      // 2. Images
      const imgList = await dockerImages(activeConnId);
      if (imgList && Array.isArray(imgList)) {
        setImages(imgList.map((img: any) => ({
          id: (img.id || '').slice(0, 12),
          repository: img.repository || '<none>',
          tag: img.tag || '<none>',
          size: img.size || '—',
          created: img.created || '',
        })));
      } else {
        setImages([]);
      }

      // 3. Volumes via SSH exec
      try {
        const volRes = await sshExec(activeConnId, 'docker volume ls --format "{{.Name}}|{{.Driver}}|{{.Scope}}"');
        if (volRes.stdout) {
          const parsedVols: VolumeItem[] = volRes.stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
              const [name, driver, scope] = line.split('|');
              return { name: name?.trim() || '', driver: driver?.trim() || 'local', scope: scope?.trim() || 'local' };
            });
          setVolumes(parsedVols);
        }
      } catch (err) {
        console.warn('Failed to fetch volumes:', err);
      }

      // 4. Networks via SSH exec
      try {
        const netRes = await sshExec(activeConnId, 'docker network ls --format "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}"');
        if (netRes.stdout) {
          const parsedNets: NetworkItem[] = netRes.stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
              const [id, name, driver, scope] = line.split('|');
              return { id: (id?.trim() || '').slice(0, 12), name: name?.trim() || '', driver: driver?.trim() || 'bridge', scope: scope?.trim() || 'local' };
            });
          setNetworks(parsedNets);
        }
      } catch (err) {
        console.warn('Failed to fetch networks:', err);
      }

    } catch (err) {
      console.warn('Docker load failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadDockerData();
  }, [loadDockerData]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadDockerData();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadDockerData]);

  // Helper to find which containers reference a given image
  const getContainersUsingImage = useCallback((img: ImageItem): ContainerItem[] => {
    return containers.filter(c => {
      const cImg = (c.image || '').trim();
      const repo = (img.repository || '').trim();
      const tag = (img.tag || '').trim();
      const fullTag = tag ? `${repo}:${tag}` : repo;
      const imgIdShort = (img.id || '').slice(0, 12);
      
      if (!cImg) return false;
      if (cImg === repo || cImg === fullTag) return true;
      if (imgIdShort && (cImg === imgIdShort || cImg === img.id || cImg.startsWith(imgIdShort))) return true;
      if (c.id && img.id.startsWith(cImg)) return true;
      if (repo !== '<none>' && (cImg.endsWith(`/${repo}`) || cImg.endsWith(`/${fullTag}`))) return true;
      return false;
    });
  }, [containers]);

  // Container Action Handler
  const handleAction = async (id: string, action: string, containerName?: string) => {
    const loadKey = `c-${action}-${id}`;
    setActionLoadingId(loadKey);
    try {
      await dockerAction(activeConnId, id, action);
      showNotification(`Container ${containerName || id} ${action} command sent successfully`);
      await loadDockerData();
    } catch (err: any) {
      showNotification(`Action failed: ${err?.message || err}`, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Connect into container directly via native Terminal app
  const handleOpenInteractiveTerminal = (c: ContainerItem) => {
    const shellCmd = `docker exec -it ${c.id} sh -c "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"\n`;
    runTerminalCommand(shellCmd);
    openApp('terminal', `Terminal: ${c.name}`);
    showNotification(`Connected interactive shell for container ${c.name}`);
  };

  // Toggle selection for a container
  const toggleSelectContainer = (id: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setSelectedContainerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle select all filtered containers
  const toggleSelectAllContainers = () => {
    const allFilteredIds = filteredContainers.map(c => c.id);
    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedContainerIds.has(id));
    if (allSelected) {
      setSelectedContainerIds(new Set());
    } else {
      setSelectedContainerIds(new Set(allFilteredIds));
    }
  };

  // Bulk action on selected containers
  const handleBulkAction = async (action: 'start' | 'stop' | 'restart' | 'delete') => {
    if (selectedContainerIds.size === 0) return;
    if (action === 'delete') {
      if (!confirm(`Are you sure you want to permanently delete ${selectedContainerIds.size} selected container(s)?`)) return;
    }

    setActionLoadingId('bulk');
    const ids = Array.from(selectedContainerIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        if (action === 'delete') {
          await dockerAction(activeConnId, id, 'rm -f');
        } else {
          await dockerAction(activeConnId, id, action);
        }
        successCount++;
      } catch (err) {
        console.warn(`Bulk action ${action} failed for ${id}:`, err);
        failCount++;
      }
    }

    if (failCount > 0) {
      showNotification(`Bulk ${action}: ${successCount} succeeded, ${failCount} failed`, 'error');
    } else {
      showNotification(`Bulk ${action} completed for ${successCount} container(s)`);
    }

    setSelectedContainerIds(new Set());
    await loadDockerData();
    setActionLoadingId(null);
  };

  // Global action on all containers
  const handleGlobalAction = async (action: 'start-all' | 'stop-all' | 'restart-all') => {
    let targets: ContainerItem[] = [];
    if (action === 'start-all') {
      targets = containers.filter(c => c.status !== 'running');
      if (targets.length === 0) {
        showNotification('All containers are already running');
        return;
      }
    } else if (action === 'stop-all') {
      targets = containers.filter(c => c.status === 'running');
      if (targets.length === 0) {
        showNotification('No running containers to stop');
        return;
      }
      if (!confirm(`Stop all ${targets.length} running container(s)?`)) return;
    } else if (action === 'restart-all') {
      targets = containers.filter(c => c.status === 'running');
      if (targets.length === 0) {
        showNotification('No running containers to restart');
        return;
      }
      if (!confirm(`Restart all ${targets.length} running container(s)?`)) return;
    }

    setActionLoadingId('global');
    let ok = 0;
    const act = action === 'start-all' ? 'start' : action === 'stop-all' ? 'stop' : 'restart';

    for (const c of targets) {
      try {
        await dockerAction(activeConnId, c.id, act);
        ok++;
      } catch (e) {
        console.warn(`Global action failed for ${c.name}:`, e);
      }
    }

    showNotification(`${act.toUpperCase()} executed on ${ok}/${targets.length} container(s)`);
    await loadDockerData();
    setActionLoadingId(null);
  };

  // Inspect Container
  const openInspector = async (container: ContainerItem) => {
    setInspectTarget(container);
    setInspectLoading(true);
    setInspectTab('overview');
    try {
      const inspectRes = await sshExec(activeConnId, `docker inspect ${container.id}`);
      if (inspectRes.stdout) {
        const rawArr = JSON.parse(inspectRes.stdout);
        const data = rawArr[0] || {};
        
        const envList: string[] = data.Config?.Env || [];
        const portObj = data.NetworkSettings?.Ports || {};
        const parsedPorts: { hostPort: string; containerPort: string; protocol: string }[] = [];
        
        Object.keys(portObj).forEach(cPort => {
          const bindings = portObj[cPort];
          const [cPortNum, proto] = cPort.split('/');
          if (bindings && Array.isArray(bindings) && bindings.length > 0) {
            bindings.forEach(b => {
              parsedPorts.push({
                hostPort: b.HostPort || '—',
                containerPort: cPortNum,
                protocol: proto || 'tcp'
              });
            });
          } else {
            parsedPorts.push({
              hostPort: 'unmapped',
              containerPort: cPortNum,
              protocol: proto || 'tcp'
            });
          }
        });

        const rawMounts = data.Mounts || [];
        const parsedMounts = rawMounts.map((m: any) => ({
          source: m.Source || '',
          destination: m.Destination || '',
          mode: m.Mode || (m.RW ? 'rw' : 'ro'),
          type: m.Type || 'bind'
        }));

        const netSettings = data.NetworkSettings || {};
        const firstNet = Object.values(netSettings.Networks || {})[0] as any;

        setInspectData({
          id: (data.Id || container.id).slice(0, 12),
          name: (data.Name || container.name).replace(/^\//, ''),
          image: data.Config?.Image || container.image,
          status: data.State?.Status || container.status,
          startedAt: data.State?.StartedAt ? new Date(data.State.StartedAt).toLocaleString() : '—',
          ipAddress: firstNet?.IPAddress || netSettings.IPAddress || 'None',
          gateway: firstNet?.Gateway || netSettings.Gateway || '—',
          macAddress: firstNet?.MacAddress || netSettings.MacAddress || '—',
          restartPolicy: data.HostConfig?.RestartPolicy?.Name || 'no',
          env: envList,
          ports: parsedPorts,
          mounts: parsedMounts
        });
      }
    } catch (err: any) {
      console.warn('Inspect parse error:', err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Open Logs
  const openLogs = async (container: ContainerItem) => {
    setSelectedLogs(container);
    setLogsText('Fetching container logs from server...');
    try {
      const out = await dockerLogs(activeConnId, container.id, logsLines);
      setLogsText(out || 'No logs recorded for this container.');
    } catch (err: any) {
      setLogsText(`Error reading logs: ${err?.message || err}`);
    }
  };

  const refreshCurrentLogs = async () => {
    if (!selectedLogs) return;
    try {
      const out = await dockerLogs(activeConnId, selectedLogs.id, logsLines);
      setLogsText(out || 'No logs recorded for this container.');
    } catch (err: any) {
      setLogsText(`Error reading logs: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (!logsAutoRefresh || !selectedLogs) return;
    const interval = setInterval(() => {
      refreshCurrentLogs();
    }, 2500);
    return () => clearInterval(interval);
  }, [logsAutoRefresh, selectedLogs, logsLines]);

  const copyLogsToClipboard = () => {
    navigator.clipboard.writeText(logsText);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  // Run Container Submit
  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runImage.trim()) {
      setRunModalError('Please specify a Docker image name.');
      return;
    }
    setIsSubmittingRun(true);
    setRunModalError(null);
    try {
      let cmd = `docker run -d`;
      if (runName.trim()) cmd += ` --name ${runName.trim()}`;
      if (runRestart) cmd += ` --restart ${runRestart}`;
      
      if (runPorts.trim()) {
        const portList = runPorts.split(',').map(p => p.trim()).filter(Boolean);
        portList.forEach(p => {
          cmd += ` -p ${p}`;
        });
      }

      if (runVolumes.trim()) {
        const volList = runVolumes.split(',').map(v => v.trim()).filter(Boolean);
        volList.forEach(v => {
          cmd += ` -v ${v}`;
        });
      }

      if (runEnv.trim()) {
        const envList = runEnv.split(',').map(e => e.trim()).filter(Boolean);
        envList.forEach(envItem => {
          cmd += ` -e ${envItem}`;
        });
      }

      cmd += ` ${runImage.trim()}`;

      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Container started: ${res.stdout.slice(0, 12)}`);
        setShowRunModal(false);
        setRunModalError(null);
        setRunImage('');
        setRunName('');
        setRunPorts('');
        setRunVolumes('');
        setRunEnv('');
        await loadDockerData();
      } else {
        const errorMsg = res.stderr || res.stdout || 'Docker run failed';
        setRunModalError(errorMsg);
      }
    } catch (err: any) {
      setRunModalError(err?.message || String(err));
    } finally {
      setIsSubmittingRun(false);
    }
  };

  // Pull Image Submit
  const handlePullSubmit = async (imgName?: string) => {
    const target = (imgName || pullImageInput).trim();
    if (!target) return;
    setIsPulling(true);
    setPullLogs(`Pulling ${target} from Docker Hub registry...\nPlease wait, this may take a moment.`);
    try {
      const res = await sshExec(activeConnId, `docker pull ${target}`);
      if (res.exit_code === 0) {
        setPullLogs(`Successfully pulled ${target}!\n\n${res.stdout}`);
        showNotification(`Image ${target} pulled successfully`);
        await loadDockerData();
      } else {
        setPullLogs(`Failed to pull ${target}:\n${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setPullLogs(`Error pulling image: ${err?.message || err}`);
    } finally {
      setIsPulling(false);
    }
  };

  // Quick Exec Command Submit
  const handleExecSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execTarget || !execCmd.trim()) return;
    setIsExecRunning(true);
    setExecOutput('Executing inside container...');
    try {
      const res = await sshExec(activeConnId, `docker exec ${execTarget.id} ${execCmd.trim()}`);
      setExecOutput(res.stdout || res.stderr || 'Command executed with no output.');
    } catch (err: any) {
      setExecOutput(`Execution failed: ${err?.message || err}`);
    } finally {
      setIsExecRunning(false);
    }
  };

  // Delete Volume
  const handleDeleteVolume = async (volName: string) => {
    if (!confirm(`Are you sure you want to permanently delete volume "${volName}"?`)) return;
    try {
      const res = await sshExec(activeConnId, `docker volume rm ${volName}`);
      if (res.exit_code === 0) {
        showNotification(`Volume ${volName} removed`);
        await loadDockerData();
      } else {
        alert(`Failed to delete volume: ${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  // Delete Network
  const handleDeleteNetwork = async (netId: string, netName: string) => {
    if (!confirm(`Are you sure you want to delete network "${netName}"?`)) return;
    try {
      const res = await sshExec(activeConnId, `docker network rm ${netId}`);
      if (res.exit_code === 0) {
        showNotification(`Network ${netName} removed`);
        await loadDockerData();
      } else {
        alert(`Failed to delete network: ${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  // Delete Image - blocks deletion if any active or stopped container uses the image
  const handleDeleteImage = async (img: ImageItem) => {
    const usingContainers = getContainersUsingImage(img);
    if (usingContainers.length > 0) {
      alert(
        `Cannot delete Docker image "${img.repository}:${img.tag}":\n\n` +
        `It is currently being used by ${usingContainers.length} container(s):\n` +
        usingContainers.map(c => `• ${c.name} (${c.id}) [Status: ${c.status}]`).join('\n') +
        `\n\nPlease stop and remove these containers first before deleting the image.`
      );
      showNotification(`Image "${img.repository}" is protected: in use by containers`, 'error');
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete image "${img.repository}:${img.tag}" (${img.id})?`)) return;

    setActionLoadingId(`img-del-${img.id}`);
    try {
      await dockerImageRemove(activeConnId, img.id);
      showNotification(`Image ${img.repository}:${img.tag} removed successfully`);
      await loadDockerData();
    } catch (err: any) {
      alert(`Failed to delete image:\n${err?.message || err}`);
      showNotification(`Error deleting image: ${err?.message || err}`, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Open System Prune Modal
  const openPruneModal = async () => {
    setShowPruneModal(true);
    setSystemDfText('Calculating Docker disk usage...');
    try {
      const res = await sshExec(activeConnId, 'docker system df');
      setSystemDfText(res.stdout || 'Unable to retrieve disk usage.');
    } catch {
      setSystemDfText('docker system df command not available');
    }
  };

  const executePrune = async (type: 'all' | 'containers' | 'images' | 'volumes') => {
    setIsPruning(true);
    try {
      let cmd = 'docker system prune -f';
      if (type === 'all') cmd = 'docker system prune -a --volumes -f';
      else if (type === 'containers') cmd = 'docker container prune -f';
      else if (type === 'images') cmd = 'docker image prune -a -f';
      else if (type === 'volumes') cmd = 'docker volume prune -f';

      const res = await sshExec(activeConnId, cmd);
      alert(`Prune Result:\n${res.stdout || res.stderr || 'Cleanup complete'}`);
      await loadDockerData();
      setShowPruneModal(false);
    } catch (err: any) {
      alert(`Prune failed: ${err?.message || err}`);
    } finally {
      setIsPruning(false);
    }
  };

  const runningCount = containers.filter(c => c.status === 'running').length;
  const pausedCount = containers.filter(c => c.status === 'paused').length;
  const stoppedCount = containers.filter(c => c.status === 'stopped').length;

  const filteredContainers = containers.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          c.image.toLowerCase().includes(search.toLowerCase()) ||
                          c.id.toLowerCase().includes(search.toLowerCase());
    if (statusFilter === 'running') return matchesSearch && c.status === 'running';
    if (statusFilter === 'stopped') return matchesSearch && c.status !== 'running';
    return matchesSearch;
  });

  const filteredImages = images.filter(img => 
    img.repository.toLowerCase().includes(search.toLowerCase()) ||
    img.tag.toLowerCase().includes(search.toLowerCase()) ||
    img.id.toLowerCase().includes(search.toLowerCase())
  );

  const filteredVolumes = volumes.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.driver.toLowerCase().includes(search.toLowerCase())
  );

  const filteredNetworks = networks.filter(n => 
    n.name.toLowerCase().includes(search.toLowerCase()) ||
    n.driver.toLowerCase().includes(search.toLowerCase())
  );

  // Common popular images catalog
  const popularImages = [
    { name: 'nginx:alpine', desc: 'Lightweight high-performance HTTP web server' },
    { name: 'redis:alpine', desc: 'In-memory fast key-value database & cache' },
    { name: 'postgres:16-alpine', desc: 'Advanced relational SQL database' },
    { name: 'node:20-alpine', desc: 'JavaScript runtime with lightweight Alpine base' },
    { name: 'python:3.11-slim', desc: 'Python 3.11 environment with pip' },
    { name: 'rabbitmq:3-management', desc: 'Messaging broker with web management UI' },
  ];

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans ${(isLoading || !!actionLoadingId) ? 'cursor-wait' : ''}`}>
      
      {/* Toast Feedback Notification */}
      {actionFeedback && (
        <div className="fixed top-12 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center space-x-2.5 text-xs font-medium ${
            actionFeedback.type === 'success' 
              ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-200' 
              : 'bg-rose-950/85 border-rose-500/40 text-rose-200'
          }`}>
            {actionFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{actionFeedback.message}</span>
          </div>
        </div>
      )}

      {/* macOS Top Header Toolbar */}
      <header className="px-5 py-3.5 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0">
        
        {/* Left: App Identity & Server Status */}
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-white/20">
            <Container className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold tracking-tight text-white">Docker Studio</span>
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Daemon Active</span>
              </span>
            </div>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">macOS Container & Image Orchestrator</p>
          </div>
        </div>

        {/* Center: macOS Segmented Switcher */}
        <div className="mac-segmented-container">
          <button
            onClick={() => setActiveTab('containers')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'containers' ? 'active' : ''}`}
          >
            <Container className="w-3.5 h-3.5" />
            <span>Containers</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'containers' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {containers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('images')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'images' ? 'active' : ''}`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Images</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'images' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {images.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('volumes')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'volumes' ? 'active' : ''}`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Volumes</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'volumes' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {volumes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('networks')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'networks' ? 'active' : ''}`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Networks</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'networks' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {networks.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('system')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'system' ? 'active' : ''}`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>System & Prune</span>
          </button>
        </div>

        {/* Right: Quick Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Run Container Button */}
          <button
            onClick={() => setShowRunModal(true)}
            className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Run Container</span>
          </button>

          {/* Pull Image Button */}
          <button
            onClick={() => {
              setShowPullModal(true);
              setPullLogs('');
            }}
            className="mac-btn mac-btn-secondary mac-btn-sheen flex items-center space-x-1.5"
          >
            <Download className="w-3.5 h-3.5 text-blue-400" />
            <span>Pull Image</span>
          </button>

          {/* Live Auto-Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`mac-btn ${
              autoRefresh 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' 
                : 'mac-btn-secondary'
            }`}
            title="Auto-refresh every 5 seconds"
          >
            <Zap className={`w-3.5 h-3.5 inline mr-1 ${autoRefresh ? 'text-emerald-400 animate-pulse' : ''}`} />
            <span>5s</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={loadDockerData}
            disabled={isLoading || !!actionLoadingId}
            className="mac-btn-icon"
            title="Refresh All Docker Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(isLoading || !!actionLoadingId) ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </header>
      {(isLoading || !!actionLoadingId) && (
        <div className="h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 shrink-0 pointer-events-none" />
      )}

      {/* Main Sub-Toolbar: Metrics & Filter Bar */}
      <div className="px-5 py-3 bg-[#161622] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4">
        
        {/* 4 Metric Pill Cards */}
        <div className="flex items-center space-x-3 overflow-x-auto py-0.5">
          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-gray-400">Running:</span>
            <span className="text-xs font-bold text-white font-mono">{runningCount}</span>
            <span className="text-[10px] text-gray-500">/ {containers.length} total</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px] text-gray-400">Images:</span>
            <span className="text-xs font-bold text-white font-mono">{images.length}</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <HardDrive className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] text-gray-400">Volumes:</span>
            <span className="text-xs font-bold text-white font-mono">{volumes.length}</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-gray-400">Networks:</span>
            <span className="text-xs font-bold text-white font-mono">{networks.length}</span>
          </div>
        </div>

        {/* Search and Tab-Specific Filters */}
        <div className="flex items-center space-x-2.5">
          {activeTab === 'containers' && (
            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-[#1e1e2e] p-0.5 rounded-xl border border-white/10 text-[11px]">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'all' ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('running')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'running' ? 'bg-emerald-500/25 text-emerald-300 font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  Running ({runningCount})
                </button>
                <button
                  onClick={() => setStatusFilter('stopped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'stopped' ? 'bg-rose-500/25 text-rose-300 font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  Stopped ({stoppedCount + pausedCount})
                </button>
              </div>

              {/* Global Actions: Start All, Stop All, Restart All */}
              <div className="flex items-center space-x-1.5 border-l border-white/10 pl-2">
                <button
                  onClick={() => handleGlobalAction('start-all')}
                  disabled={!!actionLoadingId || stoppedCount + pausedCount === 0}
                  className="px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-emerald-300 border border-emerald-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Start all stopped containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <PlayCircle className="w-3 h-3" />}
                  <span>Start All</span>
                </button>
                <button
                  onClick={() => handleGlobalAction('stop-all')}
                  disabled={!!actionLoadingId || runningCount === 0}
                  className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-amber-300 border border-amber-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Stop all running containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> : <StopCircle className="w-3 h-3" />}
                  <span>Stop All</span>
                </button>
                <button
                  onClick={() => handleGlobalAction('restart-all')}
                  disabled={!!actionLoadingId || runningCount === 0}
                  className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-cyan-300 border border-cyan-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Restart all running containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" /> : <RotateCw className="w-3 h-3" />}
                  <span>Restart All</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Input Field */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={`Filter ${activeTab}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all w-52"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
        
        {/* 1. CONTAINERS VIEW */}
        {activeTab === 'containers' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            
            {/* Bulk Actions Floating/Docked Toolbar */}
            {selectedContainerIds.size > 0 && (
              <div className="px-4 py-2 bg-gradient-to-r from-blue-900/40 via-indigo-900/40 to-blue-900/40 border-b border-blue-500/30 flex items-center justify-between shrink-0 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center space-x-2 text-xs text-blue-200">
                  <CheckSquare className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold">{selectedContainerIds.size} container{selectedContainerIds.size > 1 ? 's' : ''} selected</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleBulkAction('start')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 disabled:opacity-40 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Start selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <Play className="w-3 h-3 fill-current" />}
                    <span>Start Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('stop')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Stop selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> : <Square className="w-3 h-3 fill-current" />}
                    <span>Stop Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('restart')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 disabled:opacity-40 text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Restart selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" /> : <RotateCw className="w-3 h-3" />}
                    <span>Restart Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('delete')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 disabled:opacity-40 text-rose-300 border border-rose-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Force remove selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-rose-400" /> : <Trash2 className="w-3 h-3" />}
                    <span>Delete Selected</span>
                  </button>
                  <button
                    onClick={() => setSelectedContainerIds(new Set())}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors"
                  >
                    Deselect
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input 
                        type="checkbox"
                        aria-label="Select all containers"
                        checked={filteredContainers.length > 0 && filteredContainers.every(c => selectedContainerIds.has(c.id))}
                        onChange={toggleSelectAllContainers}
                        className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 focus:outline-none cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3 w-28">Status</th>
                    <th className="py-3 px-4">Container</th>
                    <th className="py-3 px-4">Image</th>
                    <th className="py-3 px-4">Port Bindings</th>
                    <th className="py-3 px-4 w-32">Created</th>
                    <th className="py-3 px-4 text-right pr-6 w-52">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredContainers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Container className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">
                            {isLoading ? 'Querying local Docker daemon...' : 'No containers found matching criteria'}
                          </div>
                          <button
                            onClick={() => setShowRunModal(true)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-all"
                          >
                            Launch First Container
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredContainers.map((c, idx) => (
                      <tr 
                        key={c.id} 
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, container: c });
                        }}
                        className={`group transition-colors ${
                          selectedContainerIds.has(c.id) 
                            ? 'bg-blue-600/15 border-blue-500/30' 
                            : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10 cursor-default`}
                      >
                        {/* Checkbox */}
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            aria-label={`Select container ${c.name}`}
                            checked={selectedContainerIds.has(c.id)}
                            onChange={(e) => toggleSelectContainer(c.id, e)}
                            className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 focus:outline-none cursor-pointer"
                          />
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${
                            c.status === 'running'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : c.status === 'paused'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              c.status === 'running' ? 'bg-emerald-400 animate-pulse' : c.status === 'paused' ? 'bg-amber-400' : 'bg-rose-400'
                            }`} />
                            <span>{c.status}</span>
                          </span>
                        </td>

                        {/* Container Name & ID */}
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-2">
                            <span 
                              onClick={() => openInspector(c)}
                              className="font-mono font-bold text-white hover:text-blue-400 cursor-pointer transition-colors"
                              title="Click to view Container Inspector (Right-click for options)"
                            >
                              {c.name}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                            ID: {c.id}
                          </div>
                        </td>

                        {/* Image */}
                        <td className="py-3 px-4">
                          <span className="font-mono text-xs text-gray-300 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                            {c.image}
                          </span>
                        </td>

                        {/* Ports */}
                        <td className="py-3 px-4">
                          <span className="font-mono text-[11px] text-gray-400">
                            {c.ports || '—'}
                          </span>
                        </td>

                        {/* Created / Uptime */}
                        <td className="py-3 px-4 text-gray-400 text-xs">
                          {c.created}
                        </td>

                        {/* Controls */}
                        <td className="py-3 px-4 text-right pr-6">
                          <div className="flex items-center justify-end space-x-1">
                            {/* Start/Stop */}
                            {c.status === 'running' ? (
                              <button
                                onClick={() => handleAction(c.id, 'stop', c.name)}
                                disabled={actionLoadingId === `c-stop-${c.id}`}
                                className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-400 transition-all border border-amber-500/20 active:scale-95"
                                title="Stop Container"
                              >
                                {actionLoadingId === `c-stop-${c.id}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 fill-current" />
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAction(c.id, 'start', c.name)}
                                disabled={actionLoadingId === `c-start-${c.id}`}
                                className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-400 transition-all border border-emerald-500/20 active:scale-95"
                                title="Start Container"
                              >
                                {actionLoadingId === `c-start-${c.id}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                )}
                              </button>
                            )}

                            {/* Restart */}
                            <button
                              onClick={() => handleAction(c.id, 'restart', c.name)}
                              disabled={actionLoadingId === `c-restart-${c.id}`}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 text-cyan-400 transition-all border border-white/10 active:scale-95"
                              title="Restart Container"
                            >
                              {actionLoadingId === `c-restart-${c.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              ) : (
                                <RotateCw className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Logs */}
                            <button
                              onClick={() => openLogs(c)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-blue-400 transition-all border border-white/10 active:scale-95"
                              title="Live Streaming Logs"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>

                            {/* Inspect */}
                            <button
                              onClick={() => openInspector(c)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-purple-400 transition-all border border-white/10 active:scale-95"
                              title="Container Inspector"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>

                            {/* Terminal 1: Quick Exec (One-line cmd modal) */}
                            <button
                              onClick={() => {
                                setExecTarget(c);
                                setExecCmd('uptime');
                                setExecOutput('');
                              }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-blue-400 transition-all border border-white/10 active:scale-95"
                              title="Quick Exec (One-line command modal)"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                            </button>

                            {/* Terminal 2: Interactive Terminal in Terminal App */}
                            <button
                              onClick={() => handleOpenInteractiveTerminal(c)}
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all border border-emerald-500/20 active:scale-95"
                              title="Interactive Terminal (Connect container in Terminal app)"
                            >
                              <TerminalSquare className="w-3.5 h-3.5" />
                            </button>

                            {/* Force Delete */}
                            <button
                              onClick={() => {
                                if (confirm(`Force remove container "${c.name}"?`)) {
                                  handleAction(c.id, 'rm -f', c.name);
                                }
                              }}
                              disabled={actionLoadingId === `c-rm -f-${c.id}`}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 transition-all border border-rose-500/20 active:scale-95"
                              title="Force Remove Container"
                            >
                              {actionLoadingId === `c-rm -f-${c.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. IMAGES VIEW */}
        {activeTab === 'images' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Repository</th>
                    <th className="py-3 px-4 w-28">Tag</th>
                    <th className="py-3 px-4 w-36">Image ID</th>
                    <th className="py-3 px-4 w-28">Size</th>
                    <th className="py-3 px-4 w-36">Created</th>
                    <th className="py-3 px-4 text-right pr-6 w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredImages.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Layers className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">
                            {isLoading ? 'Querying local Docker images...' : 'No Docker images found'}
                          </div>
                          <button
                            onClick={() => setShowPullModal(true)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-all"
                          >
                            Pull an Image
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredImages.map((img, idx) => {
                      const usingContainers = getContainersUsingImage(img);
                      const isUsed = usingContainers.length > 0;
                      return (
                        <tr 
                          key={img.id}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, image: img });
                          }}
                          className={`group transition-colors ${
                            idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                          } hover:bg-blue-500/10 cursor-default`}
                        >
                          <td className="py-3 px-4 font-medium text-white flex items-center space-x-2">
                            <Layers className="w-4 h-4 text-purple-400 shrink-0" />
                            <span className="font-mono">{img.repository}</span>
                            {isUsed && (
                              <span 
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 font-normal shrink-0" 
                                title={`In use by ${usingContainers.length} container(s):\n${usingContainers.map(c => `• ${c.name} (${c.status})`).join('\n')}`}
                              >
                                <Lock className="w-2.5 h-2.5 text-amber-400" />
                                <span>In use ({usingContainers.length})</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-[11px] bg-white/10 text-gray-300 px-2 py-0.5 rounded border border-white/10">
                              {img.tag}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-gray-400">{img.id}</td>
                          <td className="py-3 px-4 font-mono text-gray-300">{img.size}</td>
                          <td className="py-3 px-4 text-gray-400">{img.created}</td>
                          <td className="py-3 px-4 text-right pr-6">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Run this image */}
                              <button
                                onClick={() => {
                                  setRunImage(`${img.repository}:${img.tag}`);
                                  setShowRunModal(true);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all"
                                title="Run a new container from this image"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Run</span>
                              </button>

                              {/* Delete image with in-use protection */}
                              {isUsed ? (
                                <button
                                  onClick={() => handleDeleteImage(img)}
                                  className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 active:scale-95 transition-all"
                                  title={`Cannot delete: Image is currently in use by ${usingContainers.length} container(s). Click to view details.`}
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDeleteImage(img)}
                                  disabled={actionLoadingId === `img-del-${img.id}`}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                                  title="Delete Image"
                                >
                                  {actionLoadingId === `img-del-${img.id}` ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. VOLUMES VIEW */}
        {activeTab === 'volumes' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Volume Name</th>
                    <th className="py-3 px-4 w-32">Driver</th>
                    <th className="py-3 px-4 w-32">Scope</th>
                    <th className="py-3 px-4 text-right pr-6 w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredVolumes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <HardDrive className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">No Docker storage volumes found</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredVolumes.map((vol, idx) => (
                      <tr 
                        key={vol.name}
                        className={`group transition-colors ${
                          idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10`}
                      >
                        <td className="py-3 px-4 font-mono font-medium text-white flex items-center space-x-2">
                          <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="truncate max-w-md">{vol.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{vol.driver}</td>
                        <td className="py-3 px-4 font-mono text-gray-400">{vol.scope}</td>
                        <td className="py-3 px-4 text-right pr-6">
                          <button
                            onClick={() => handleDeleteVolume(vol.name)}
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                            title="Remove Volume"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. NETWORKS VIEW */}
        {activeTab === 'networks' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Network Name</th>
                    <th className="py-3 px-4 w-36">Network ID</th>
                    <th className="py-3 px-4 w-32">Driver</th>
                    <th className="py-3 px-4 w-32">Scope</th>
                    <th className="py-3 px-4 text-right pr-6 w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredNetworks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Network className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">No Docker networks found</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredNetworks.map((net, idx) => (
                      <tr 
                        key={net.id}
                        className={`group transition-colors ${
                          idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10`}
                      >
                        <td className="py-3 px-4 font-mono font-medium text-white flex items-center space-x-2">
                          <Network className="w-4 h-4 text-cyan-400 shrink-0" />
                          <span>{net.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{net.id}</td>
                        <td className="py-3 px-4 font-mono text-gray-300">
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">{net.driver}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{net.scope}</td>
                        <td className="py-3 px-4 text-right pr-6">
                          {['bridge', 'host', 'none'].includes(net.name) ? (
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider">System</span>
                          ) : (
                            <button
                              onClick={() => handleDeleteNetwork(net.id, net.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                              title="Delete Network"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. SYSTEM & PRUNE VIEW */}
        {activeTab === 'system' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-6 overflow-y-auto backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-blue-400" />
                  <span>Docker System Maintenance & Prune</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Clean up unused containers, dangling images, dangling networks, and build caches</p>
              </div>

              <button
                onClick={openPruneModal}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-rose-600/20 active:scale-95 transition-all flex items-center space-x-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Open Prune Assistant</span>
              </button>
            </div>

            {/* Disk Space & Resources Overview */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Containers Footprint</span>
                  <Container className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{containers.length}</div>
                <div className="text-xs text-gray-500 mt-1">{runningCount} active, {stoppedCount} stopped</div>
              </div>

              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Image Storage</span>
                  <Layers className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{images.length}</div>
                <div className="text-xs text-gray-500 mt-1">Docker image cache entries</div>
              </div>

              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Persistent Volumes</span>
                  <HardDrive className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{volumes.length}</div>
                <div className="text-xs text-gray-500 mt-1">Mounted stateful disk volumes</div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-[#14141e] p-5 rounded-2xl border border-white/10 space-y-4">
              <h4 className="text-sm font-semibold text-white">One-Click Maintenance Actions</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => executePrune('containers')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <Trash2 className="w-4 h-4 text-amber-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Stopped Containers</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Removes all stopped containers safely</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('images')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <Layers className="w-4 h-4 text-purple-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Unused Images</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Frees disk space from untagged / unused images</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('volumes')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <HardDrive className="w-4 h-4 text-rose-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Dangling Volumes</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Deletes volumes not attached to any container</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('all')}
                  className="p-3 bg-rose-950/20 hover:bg-rose-950/40 rounded-xl border border-rose-500/30 text-left transition-all group flex items-start space-x-3"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-rose-200">Full System Prune</div>
                    <div className="text-[11px] text-rose-300/70 mt-0.5">Reclaims maximum storage from all inactive assets</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: RUN NEW CONTAINER ================= */}
      {showRunModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center">
                  <Play className="w-4 h-4 text-blue-400 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Launch New Container</h3>
                  <p className="text-[11px] text-gray-400">Configure ports, environment variables, and volumes</p>
                </div>
              </div>
              <button 
                onClick={() => setShowRunModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleRunSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Docker Image <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. nginx:alpine, redis:latest, postgres:16"
                  value={runImage}
                  onChange={e => setRunImage(e.target.value)}
                  required
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Container Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. web-server-1"
                  value={runName}
                  onChange={e => setRunName(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Port Bindings (-p)</label>
                  <input
                    type="text"
                    placeholder="8080:80, 443:443"
                    value={runPorts}
                    onChange={e => setRunPorts(e.target.value)}
                    className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <span className="text-[10px] text-gray-500 mt-1 block">Format: hostPort:containerPort</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Restart Policy</label>
                  <select
                    value={runRestart}
                    onChange={e => setRunRestart(e.target.value)}
                    className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="unless-stopped">Unless Stopped</option>
                    <option value="always">Always</option>
                    <option value="on-failure">On Failure</option>
                    <option value="no">Never (no)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Volumes / Mounts (-v)</label>
                <input
                  type="text"
                  placeholder="/var/www/html:/usr/share/nginx/html, /host/data:/data"
                  value={runVolumes}
                  onChange={e => setRunVolumes(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Comma separated list of hostPath:containerPath</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Environment Variables (-e)</label>
                <input
                  type="text"
                  placeholder="NODE_ENV=production, PORT=3000, DB_HOST=localhost"
                  value={runEnv}
                  onChange={e => setRunEnv(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {runModalError && (
                <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{runModalError}</div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-white/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowRunModal(false); setRunModalError(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRun}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2"
                >
                  {isSubmittingRun && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingRun ? 'Launching...' : 'Run Container'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: PULL IMAGE ================= */}
      {showPullModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
                  <Download className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Pull Docker Image</h3>
                  <p className="text-[11px] text-gray-400">Download from Docker Hub or private container registries</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPullModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="e.g. nginx:latest, redis:alpine, ubuntu:22.04"
                  value={pullImageInput}
                  onChange={e => setPullImageInput(e.target.value)}
                  className="flex-1 bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => handlePullSubmit()}
                  disabled={isPulling || !pullImageInput.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
                >
                  {isPulling && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isPulling ? 'Pulling...' : 'Pull'}</span>
                </button>
              </div>

              {/* Popular Curated Images */}
              <div>
                <span className="text-[11px] text-gray-400 block mb-2 font-medium">Popular Docker Images:</span>
                <div className="grid grid-cols-2 gap-2">
                  {popularImages.map(item => (
                    <button
                      key={item.name}
                      onClick={() => {
                        setPullImageInput(item.name);
                        handlePullSubmit(item.name);
                      }}
                      disabled={isPulling}
                      className="p-2 bg-[#13131c] hover:bg-white/5 rounded-xl border border-white/5 text-left transition-all group flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-mono text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                          {item.name}
                        </span>
                        <ArrowDownToLine className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400" />
                      </div>
                      <span className="text-[10px] text-gray-500 mt-1 line-clamp-1">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pull Logs Preview */}
              {pullLogs && (
                <div className="bg-[#11111a] border border-white/10 rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text">
                  {pullLogs}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: LIVE STREAMING LOGS ================= */}
      {selectedLogs && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[600px]">
            {/* Terminal Window Header (macOS Traffic Lights) */}
            <div className="px-5 py-3.5 bg-[#12121a] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {/* Traffic lights */}
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setSelectedLogs(null)} className="w-3 h-3 rounded-full bg-[#ff5f56] hover:opacity-80 transition-opacity" />
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <div className="flex items-center space-x-2 pl-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-mono font-bold text-white">docker logs {selectedLogs.name}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center space-x-2">
                {/* Tail line count */}
                <select
                  value={logsLines}
                  onChange={e => {
                    setLogsLines(Number(e.target.value));
                    setTimeout(() => refreshCurrentLogs(), 50);
                  }}
                  className="bg-[#1e1e2e] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-gray-300 focus:outline-none"
                >
                  <option value={50}>Tail 50</option>
                  <option value={100}>Tail 100</option>
                  <option value={250}>Tail 250</option>
                  <option value={500}>Tail 500</option>
                  <option value={1000}>Tail 1000</option>
                </select>

                {/* Auto Refresh Toggle */}
                <button
                  onClick={() => setLogsAutoRefresh(!logsAutoRefresh)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all border ${
                    logsAutoRefresh 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                      : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                  }`}
                  title="Auto-refresh logs every 2.5 seconds"
                >
                  <Zap className={`w-3 h-3 inline mr-1 ${logsAutoRefresh ? 'animate-pulse text-emerald-400' : ''}`} />
                  Live (2.5s)
                </button>

                {/* Copy logs */}
                <button
                  onClick={copyLogsToClipboard}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-[11px] flex items-center space-x-1"
                >
                  {logsCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{logsCopied ? 'Copied' : 'Copy'}</span>
                </button>

                {/* Refresh */}
                <button
                  onClick={refreshCurrentLogs}
                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10"
                  title="Reload Logs Now"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Sub-header */}
            <div className="px-4 py-2 bg-[#161622] border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs text-gray-400">
                <Search className="w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="Grep / filter logs output..."
                  value={logsFilter}
                  onChange={e => setLogsFilter(e.target.value)}
                  className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-64"
                />
              </div>
              <span className="text-[11px] text-gray-500 font-mono">
                {logsText.split('\n').length} lines
              </span>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 p-4 font-mono text-[11px] text-gray-300 bg-[#0d0e15] overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {logsText
                .split('\n')
                .filter(l => !logsFilter || l.toLowerCase().includes(logsFilter.toLowerCase()))
                .map((line, idx) => {
                  let colorClass = 'text-gray-300';
                  if (line.includes('ERROR') || line.includes('ERR') || line.includes('FATAL')) colorClass = 'text-rose-400 font-semibold';
                  else if (line.includes('WARN')) colorClass = 'text-amber-400';
                  else if (line.includes('INFO')) colorClass = 'text-cyan-300';
                  return (
                    <div key={idx} className={`${colorClass} hover:bg-white/[0.04] px-1 py-0.2 rounded transition-colors`}>
                      {line}
                    </div>
                  );
                })}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: CONTAINER INSPECTOR ================= */}
      {inspectTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col h-[580px]">
            {/* Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
                  <Info className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>{inspectTarget.name}</span>
                    <span className="font-mono text-xs text-gray-400 font-normal">({inspectTarget.id})</span>
                  </h3>
                  <p className="text-[11px] text-gray-400">Detailed container inspection & metadata</p>
                </div>
              </div>
              <button 
                onClick={() => setInspectTarget(null)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Navigation Tabs */}
            <div className="px-6 bg-[#161622] border-b border-white/10 flex items-center space-x-4">
              <button
                onClick={() => setInspectTab('overview')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'overview' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Overview & Network
              </button>
              <button
                onClick={() => setInspectTab('env')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'env' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Environment ({inspectData?.env.length || 0})
              </button>
              <button
                onClick={() => setInspectTab('ports')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'ports' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Port Bindings ({inspectData?.ports.length || 0})
              </button>
              <button
                onClick={() => setInspectTab('mounts')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'mounts' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Mounts & Volumes ({inspectData?.mounts.length || 0})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 p-6 overflow-y-auto">
              {inspectLoading ? (
                <div className="flex items-center justify-center h-full space-x-2 text-gray-400 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading container metadata...</span>
                </div>
              ) : inspectData ? (
                <>
                  {inspectTab === 'overview' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                          <span className="text-[11px] text-gray-400 block font-medium">Container Identity</span>
                          <div className="text-xs font-mono"><span className="text-gray-500">Image:</span> {inspectData.image}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Status:</span> {inspectData.status}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Restart:</span> {inspectData.restartPolicy}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Started:</span> {inspectData.startedAt}</div>
                        </div>

                        <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                          <span className="text-[11px] text-gray-400 block font-medium">Networking</span>
                          <div className="text-xs font-mono"><span className="text-gray-500">IP Address:</span> {inspectData.ipAddress}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Gateway:</span> {inspectData.gateway}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">MAC Addr:</span> {inspectData.macAddress}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {inspectTab === 'env' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3 w-1/3">Key</th>
                            <th className="py-2.5 px-3">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.env.map((eStr, i) => {
                            const [k, ...v] = eStr.split('=');
                            return (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="py-2 px-3 text-cyan-400 font-semibold">{k}</td>
                                <td className="py-2 px-3 text-gray-300 break-all select-text">{v.join('=')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {inspectTab === 'ports' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Host Port</th>
                            <th className="py-2.5 px-3">Direction</th>
                            <th className="py-2.5 px-3">Container Port</th>
                            <th className="py-2.5 px-3">Protocol</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.ports.map((p, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="py-2.5 px-3 text-emerald-400 font-bold">{p.hostPort}</td>
                              <td className="py-2.5 px-3 text-gray-500">→</td>
                              <td className="py-2.5 px-3 text-white font-bold">{p.containerPort}</td>
                              <td className="py-2.5 px-3 uppercase text-gray-400">{p.protocol}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {inspectTab === 'mounts' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Host Source</th>
                            <th className="py-2.5 px-3">Container Destination</th>
                            <th className="py-2.5 px-3 w-20">Mode</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.mounts.map((m, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="py-2.5 px-3 text-gray-300 break-all">{m.source}</td>
                              <td className="py-2.5 px-3 text-blue-400 break-all">{m.destination}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  m.mode.includes('rw') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                                }`}>
                                  {m.mode}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: EXEC QUICK COMMAND ================= */}
      {execTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-600/30 border border-emerald-400/30 flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Execute Command: {execTarget.name}</h3>
                  <p className="text-[11px] text-gray-400">Run a command directly inside the container namespace</p>
                </div>
              </div>
              <button 
                onClick={() => setExecTarget(null)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecSubmit} className="p-6 space-y-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="e.g. ls -la /app, env, ps aux, cat /etc/os-release"
                  value={execCmd}
                  onChange={e => setExecCmd(e.target.value)}
                  className="flex-1 bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
                />
                <button
                  type="submit"
                  disabled={isExecRunning || !execCmd.trim()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
                >
                  {isExecRunning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Run</span>
                </button>
              </div>

              {execOutput && (
                <div className="bg-[#0d0e15] border border-white/10 rounded-xl p-3.5 max-h-60 overflow-y-auto font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text leading-relaxed">
                  {execOutput}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: SYSTEM PRUNE ASSISTANT ================= */}
      {showPruneModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-rose-600/30 border border-rose-400/30 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Docker Prune Assistant</h3>
                  <p className="text-[11px] text-gray-400">Reclaim wasted disk storage on your Linux host</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPruneModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-[#13131c] p-3 rounded-xl border border-white/10 font-mono text-[11px] text-gray-300 whitespace-pre-wrap">
                {systemDfText}
              </div>

              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-200 flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Warning</span>
                  Pruning will permanently delete stopped containers, dangling images, and unreferenced build cache.
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  onClick={() => setShowPruneModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => executePrune('all')}
                  disabled={isPruning}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all shadow-lg shadow-rose-600/30 flex items-center space-x-2"
                >
                  {isPruning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isPruning ? 'Pruning...' : 'Prune All Unused'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= CONTEXT MENU ================= */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          style={{ 
            top: `${Math.min(contextMenu.y, window.innerHeight - 340)}px`, 
            left: `${Math.min(contextMenu.x, window.innerWidth - 240)}px` 
          }}
          className="fixed z-50 min-w-[220px] bg-[#1a1b26]/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl py-1 text-xs text-gray-200 animate-in fade-in zoom-in-95 duration-100"
        >
          {contextMenu.container && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 flex items-center justify-between">
                <span className="truncate max-w-[130px] font-mono">{contextMenu.container.name}</span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold ${
                  contextMenu.container.status === 'running' 
                    ? 'bg-emerald-500/20 text-emerald-300' 
                    : contextMenu.container.status === 'paused'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}>
                  {contextMenu.container.status}
                </span>
              </div>

              {contextMenu.container.status === 'running' ? (
                <button
                  onClick={() => {
                    const c = contextMenu.container!;
                    setContextMenu(null);
                    handleAction(c.id, 'stop', c.name);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-amber-500/20 text-amber-300 transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Container</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    const c = contextMenu.container!;
                    setContextMenu(null);
                    handleAction(c.id, 'start', c.name);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-emerald-500/20 text-emerald-300 transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Container</span>
                </button>
              )}

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  handleAction(c.id, 'restart', c.name);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-cyan-300 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Restart Container</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  setExecTarget(c);
                  setExecCmd('uptime');
                  setExecOutput('');
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Quick Exec (One-Line)</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  handleOpenInteractiveTerminal(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-emerald-300 transition-colors"
              >
                <TerminalSquare className="w-3.5 h-3.5" />
                <span>Open Terminal Shell</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  openLogs(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Container Logs</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  openInspector(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-purple-300 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Inspect Container</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.container!.id);
                  setContextMenu(null);
                  showNotification(`Copied ID: ${contextMenu.container!.id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Container ID</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.container!.name);
                  setContextMenu(null);
                  showNotification(`Copied Name: ${contextMenu.container!.name}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Container Name</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  if (confirm(`Force remove container "${c.name}"?`)) {
                    handleAction(c.id, 'rm -f', c.name);
                  }
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-rose-500/20 text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Container</span>
              </button>
            </>
          )}

          {contextMenu.image && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">
                <span className="truncate block max-w-[190px] font-mono">{contextMenu.image.repository}:{contextMenu.image.tag}</span>
              </div>

              <button
                onClick={() => {
                  const img = contextMenu.image!;
                  setContextMenu(null);
                  setRunImage(`${img.repository}:${img.tag}`);
                  setShowRunModal(true);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run New Container</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.image!.id);
                  setContextMenu(null);
                  showNotification(`Copied Image ID: ${contextMenu.image!.id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Image ID</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${contextMenu.image!.repository}:${contextMenu.image!.tag}`);
                  setContextMenu(null);
                  showNotification(`Copied Tag: ${contextMenu.image!.repository}:${contextMenu.image!.tag}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Repository:Tag</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              {(() => {
                const using = getContainersUsingImage(contextMenu.image!);
                const isLocked = using.length > 0;
                return (
                  <button
                    onClick={() => {
                      const img = contextMenu.image!;
                      setContextMenu(null);
                      handleDeleteImage(img);
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center space-x-2 transition-colors ${
                      isLocked 
                        ? 'hover:bg-amber-500/20 text-amber-300' 
                        : 'hover:bg-rose-500/20 text-rose-400'
                    }`}
                    title={isLocked ? `Protected: In use by ${using.length} container(s)` : 'Delete Image'}
                  >
                    {isLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Trash2 className="w-3.5 h-3.5" />}
                    <span>{isLocked ? `In Use by Containers (${using.length})` : 'Delete Image'}</span>
                  </button>
                );
              })()}
            </>
          )}
        </div>
      )}

    </div>
  );
}

export { DockerManager };
