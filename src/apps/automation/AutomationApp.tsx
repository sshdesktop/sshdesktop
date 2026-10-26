import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Workflow, Play, Square, RefreshCw, CheckCircle2, AlertCircle, Clock,
  Server, Shield, Terminal, Globe, Container, Trash2, Copy, Check,
  Download, Plus, Search, Filter, Layers, Zap, Eye, ChevronDown, ChevronRight,
  Sliders, Calendar, ArrowRight, Activity, AlertTriangle, X, HelpCircle, HardDrive, Cpu, Package,
  Cloud, CloudUpload, CloudDownload, FileJson, Edit3, MoveRight, Network, GitBranch,
  ZoomIn, ZoomOut, WrapText, CheckSquare, Square as SquareIcon, FileText
} from 'lucide-react';
import { useConnectionStore, useSettingsStore } from '../../lib/store';
import { useUserPrivilege } from '../../lib/permissions';
import { SavedConnection } from '../../lib/types';
import {
  AutomationRecipe,
  ServerExecutionResult,
  TargetHealth,
  AutomationExecutionRun,
  ExecutionMode,
  RecipeCategory,
  AutomationServerData,
  FleetMatrixData,
  FleetOrganization,
  FleetGroup,
  ReplicaSet,
  ReplicationType,
} from './types';
import {
  BUILT_IN_RECIPES,
  executeParallelFleet,
  executeRollingFleet,
  probeFleetTelemetry,
  loadStoredRecipes,
  saveCustomRecipe,
  deleteCustomRecipe,
  loadStoredHistory,
  saveHistoryEntry,
  clearHistory,
  interpolateCommand,
  getAutomationServerFilePath,
  saveAutomationToServer,
  loadAutomationFromServer,
  checkAutomationServerFileStatus,
  loadStoredFleetMatrix,
  saveStoredFleetMatrix,
  loadStoredReplicaSets,
  saveStoredReplicaSets,
  getDefaultFleetMatrix,
} from './automation-service';

// Utility helper to trigger client-side file download
function downloadTextFile(filename: string, content: string, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AutomationApp() {
  const connections = useConnectionStore(s => s.connections);
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const { theme } = useSettingsStore();
  const { username, homeDir } = useUserPrivilege();

  const serverFilePath = getAutomationServerFilePath(homeDir);

  // Navigation Tabs (Schedules tab removed per requirements)
  const [activeTab, setActiveTab] = useState<'runner' | 'recipes' | 'fleet-matrix' | 'replicas' | 'history'>('runner');

  // Recipes, History, Fleet Matrix & Replicas State
  const [recipes, setRecipes] = useState<AutomationRecipe[]>([]);
  const [history, setHistory] = useState<AutomationExecutionRun[]>([]);
  const [fleetMatrix, setFleetMatrix] = useState<FleetMatrixData>(() => getDefaultFleetMatrix([]));
  const [replicaSets, setReplicaSets] = useState<ReplicaSet[]>([]);
  const [fleetHealth, setFleetHealth] = useState<Record<string, TargetHealth>>({});
  const [isProbingFleet, setIsProbingFleet] = useState(false);

  // Runner Configuration State
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('fleet-telemetry');
  const [customCommand, setCustomCommand] = useState<string>('');
  const [isSudo, setIsSudo] = useState<boolean>(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('parallel');
  const [concurrency, setConcurrency] = useState<number>(5);
  const [stopOnError, setStopOnError] = useState<boolean>(true);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Monaco Editor State
  const [editorFontSize, setEditorFontSize] = useState<number>(13);
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const editorRef = useRef<any>(null);

  // Execution State
  const [isRunning, setIsRunning] = useState(false);
  const [executionResults, setExecutionResults] = useState<Record<string, ServerExecutionResult>>({});
  const [activeRunningServerId, setActiveRunningServerId] = useState<string | null>(null);
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);
  const [executionElapsedMs, setExecutionElapsedMs] = useState<number>(0);
  const cancelRequestedRef = useRef(false);

  // Output Inspection Drawer/Modal
  const [inspectResult, setInspectResult] = useState<ServerExecutionResult | null>(null);
  const [outputViewMode, setOutputViewMode] = useState<'grid' | 'unified'>('grid');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Server Sync States (~/.sshdesktop/automation.json)
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [lastServerSyncTime, setLastServerSyncTime] = useState<string | null>(null);
  const [serverFileStatus, setServerFileStatus] = useState<{
    exists: boolean;
    path: string;
    size?: number;
    modified?: string;
    rawJson?: string;
  } | null>(null);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  // Fleet Matrix Modals State
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<FleetOrganization | null>(null);
  const [orgForm, setOrgForm] = useState({ name: '', description: '', color: '#6366f1' });

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FleetGroup | null>(null);
  const [groupForm, setGroupForm] = useState({ organizationId: '', name: '', description: '', color: '#3b82f6' });

  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);
  const [assignServerId, setAssignServerId] = useState<string>('');
  const [assignOrgId, setAssignOrgId] = useState<string>('');
  const [assignGroupId, setAssignGroupId] = useState<string>('');

  // Replica Modal State
  const [isReplicaModalOpen, setIsReplicaModalOpen] = useState(false);
  const [editingReplica, setEditingReplica] = useState<ReplicaSet | null>(null);
  const [replicaForm, setReplicaForm] = useState<{
    name: string;
    description: string;
    primaryServerId: string;
    replicaServerIds: string[];
    replicationType: ReplicationType;
    syncCommand: string;
    healthCheckCommand: string;
    autoFailover: boolean;
  }>({
    name: '',
    description: '',
    primaryServerId: '',
    replicaServerIds: [],
    replicationType: 'database',
    syncCommand: '',
    healthCheckCommand: '',
    autoFailover: false,
  });

  // New Recipe Modal State
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [newRecipe, setNewRecipe] = useState<Partial<AutomationRecipe>>({
    title: '',
    description: '',
    category: 'custom',
    command: '',
    isSudo: false,
    icon: 'Workflow',
  });

  // Status Notification
  const [bannerNotice, setBannerNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  // Load recipes, history, matrix, and replicas on mount
  useEffect(() => {
    setRecipes(loadStoredRecipes());
    setHistory(loadStoredHistory());
    setFleetMatrix(loadStoredFleetMatrix(connections));
    setReplicaSets(loadStoredReplicaSets());
  }, [connections]);

  // Save current automation data directly to /home/sharuk/.sshdesktop/automation.json on active server
  const handleSaveToServer = useCallback(async (silent: boolean = false) => {
    if (!activeConnectionId || !homeDir) {
      if (!silent) {
        setBannerNotice({ text: 'No active connected server to save automation data.', isError: true });
      }
      return;
    }

    setIsSyncingServer(true);
    try {
      const customOnly = recipes.filter(r => !r.isBuiltIn);
      const res = await saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: customOnly,
        history,
        fleetMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      });

      if (res.success) {
        setLastServerSyncTime(new Date().toLocaleTimeString());
        setServerFileStatus(prev => ({
          ...prev,
          exists: true,
          path: res.path,
          modified: new Date().toLocaleString(),
        }));
        if (!silent) {
          setBannerNotice({ text: `Automation data saved to server at ${res.path}!`, isError: false });
        }
      } else {
        if (!silent) {
          setBannerNotice({ text: `Server save error: ${res.error}`, isError: true });
        }
      }
    } catch (err: any) {
      if (!silent) {
        setBannerNotice({ text: `Failed to save to server: ${err?.message || err}`, isError: true });
      }
    } finally {
      setIsSyncingServer(false);
    }
  }, [activeConnectionId, homeDir, username, recipes, history, fleetMatrix, replicaSets, selectedServerIds]);

  // Restore automation data from /home/sharuk/.sshdesktop/automation.json
  const handleRestoreFromServer = useCallback(async () => {
    if (!activeConnectionId || !homeDir) {
      setBannerNotice({ text: 'No active connected server to restore from.', isError: true });
      return;
    }

    setIsSyncingServer(true);
    try {
      const res = await loadAutomationFromServer(activeConnectionId, homeDir);
      if (res.success && res.data) {
        if (Array.isArray(res.data.custom_recipes)) {
          const merged = [...BUILT_IN_RECIPES, ...res.data.custom_recipes];
          setRecipes(merged);
        }
        if (Array.isArray(res.data.history)) {
          setHistory(res.data.history);
        }
        if (res.data.fleet_matrix) {
          setFleetMatrix(res.data.fleet_matrix);
        }
        if (Array.isArray(res.data.replica_sets)) {
          setReplicaSets(res.data.replica_sets);
        }
        if (Array.isArray(res.data.last_target_server_ids) && res.data.last_target_server_ids.length > 0) {
          setSelectedServerIds(res.data.last_target_server_ids);
        }
        setLastServerSyncTime(new Date().toLocaleTimeString());
        setBannerNotice({ text: `Automation data restored from ${res.path}!`, isError: false });
      } else {
        setBannerNotice({ text: `Restore failed: ${res.error}`, isError: true });
      }
    } catch (err: any) {
      setBannerNotice({ text: `Failed to restore from server: ${err?.message || err}`, isError: true });
    } finally {
      setIsSyncingServer(false);
    }
  }, [activeConnectionId, homeDir]);

  // Auto-Hydrate from /home/sharuk/.sshdesktop/automation.json when connected
  useEffect(() => {
    if (!activeConnectionId || !homeDir) return;

    let isMounted = true;
    checkAutomationServerFileStatus(activeConnectionId, homeDir).then(status => {
      if (!isMounted) return;
      setServerFileStatus(status);
      if (status.exists) {
        // Hydrate from server
        loadAutomationFromServer(activeConnectionId, homeDir).then(res => {
          if (!isMounted || !res.success || !res.data) return;
          if (Array.isArray(res.data.custom_recipes) && res.data.custom_recipes.length > 0) {
            setRecipes([...BUILT_IN_RECIPES, ...res.data.custom_recipes]);
          }
          if (Array.isArray(res.data.history) && res.data.history.length > 0) {
            setHistory(res.data.history);
          }
          if (res.data.fleet_matrix) {
            setFleetMatrix(res.data.fleet_matrix);
          }
          if (Array.isArray(res.data.replica_sets)) {
            setReplicaSets(res.data.replica_sets);
          }
          if (Array.isArray(res.data.last_target_server_ids) && res.data.last_target_server_ids.length > 0) {
            setSelectedServerIds(res.data.last_target_server_ids);
          }
          setLastServerSyncTime(new Date().toLocaleTimeString());
        });
      }
    });

    return () => {
      isMounted = false;
    };
  }, [activeConnectionId, homeDir]);

  // Initialize selected servers default
  useEffect(() => {
    if (connections.length > 0 && selectedServerIds.length === 0) {
      if (activeConnectionId && connections.some(c => c.id === activeConnectionId)) {
        setSelectedServerIds([activeConnectionId]);
      } else {
        setSelectedServerIds(connections.map(c => c.id));
      }
    }
  }, [connections, activeConnectionId]);

  // Initial Probe on Mount to establish Active/Inactive colors
  useEffect(() => {
    if (connections.length > 0 && Object.keys(fleetHealth).length === 0) {
      probeFleetTelemetry(connections, (health) => {
        setFleetHealth(prev => ({ ...prev, [health.serverId]: health }));
      });
    }
  }, [connections]);

  // Update recipe settings when selected recipe changes
  useEffect(() => {
    const found = recipes.find(r => r.id === selectedRecipeId);
    if (found) {
      setCustomCommand(found.command);
      setIsSudo(found.isSudo);
      if (found.stopOnError !== undefined) {
        setStopOnError(found.stopOnError);
      }
      const vars: Record<string, string> = {};
      found.variables?.forEach(v => {
        vars[v.name] = v.defaultValue;
      });
      setVariableValues(vars);
    }
  }, [selectedRecipeId, recipes]);

  // Timer loop for active execution elapsed time
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (isRunning && executionStartTime) {
      timer = setInterval(() => {
        setExecutionElapsedMs(Date.now() - executionStartTime);
      }, 100);
    }
    return () => clearInterval(timer);
  }, [isRunning, executionStartTime]);

  // Keyboard Shortcuts for Monaco Editor: Zoom In (Ctrl++), Zoom Out (Ctrl+-), Word Wrap (Alt+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom In: Ctrl + = or Ctrl + +
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setEditorFontSize(prev => Math.min(prev + 1, 32));
      }
      // Zoom Out: Ctrl + -
      else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setEditorFontSize(prev => Math.max(prev - 1, 9));
      }
      // Word Wrap: Alt + Z
      else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsWordWrap(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered Servers for selection list with Online / Offline support
  const filteredServers = useMemo(() => {
    return connections.filter(c => {
      const matchesSearch = 
        (c.name || '').toLowerCase().includes(serverSearchQuery.toLowerCase()) ||
        c.host.toLowerCase().includes(serverSearchQuery.toLowerCase()) ||
        c.username.toLowerCase().includes(serverSearchQuery.toLowerCase());
      const matchesGroup = 
        selectedGroupFilter === 'all' || 
        c.group === selectedGroupFilter;
      
      const health = fleetHealth[c.id];
      const isOnline = health ? health.reachable : false;
      const matchesStatus = 
        statusFilter === 'all' || 
        (statusFilter === 'online' && isOnline) ||
        (statusFilter === 'offline' && !isOnline);

      return matchesSearch && matchesGroup && matchesStatus;
    });
  }, [connections, serverSearchQuery, selectedGroupFilter, statusFilter, fleetHealth]);

  // Selected Target Servers
  const targetServers = useMemo(() => {
    return connections.filter(c => selectedServerIds.includes(c.id));
  }, [connections, selectedServerIds]);

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Toggle server selection
  const toggleServer = (id: string) => {
    setSelectedServerIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAllFiltered = () => {
    const ids = new Set([...selectedServerIds, ...filteredServers.map(s => s.id)]);
    setSelectedServerIds(Array.from(ids));
  };

  const deselectAllFiltered = () => {
    const removeSet = new Set(filteredServers.map(s => s.id));
    setSelectedServerIds(prev => prev.filter(id => !removeSet.has(id)));
  };

  // Run Fleet Telemetry Probe
  const handleProbeFleet = async () => {
    if (connections.length === 0) {
      setBannerNotice({ text: 'No servers configured in SSH Desktop.', isError: true });
      return;
    }
    setIsProbingFleet(true);
    setBannerNotice({ text: `Probing active connection and telemetry on ${connections.length} servers...` });
    try {
      const results = await probeFleetTelemetry(connections, (health) => {
        setFleetHealth(prev => ({ ...prev, [health.serverId]: health }));
      });
      const onlineCount = results.filter(r => r.reachable).length;
      setBannerNotice({
        text: `Fleet probe complete: ${onlineCount}/${results.length} servers online (active).`,
        isError: onlineCount === 0,
      });
    } catch (err: any) {
      setBannerNotice({ text: `Fleet probe failed: ${err.message}`, isError: true });
    } finally {
      setIsProbingFleet(false);
    }
  };

  // Cancel in-flight execution
  const handleCancelExecution = () => {
    cancelRequestedRef.current = true;
    setBannerNotice({ text: 'Cancellation requested. Awaiting thread cleanup...', isError: true });
  };

  // Execute Automation Run
  const handleRunAutomation = async () => {
    if (targetServers.length === 0) {
      setBannerNotice({ text: 'Please select at least one target server.', isError: true });
      return;
    }

    if (!customCommand.trim()) {
      setBannerNotice({ text: 'Command or script cannot be empty.', isError: true });
      return;
    }

    setIsRunning(true);
    cancelRequestedRef.current = false;
    const start = Date.now();
    setExecutionStartTime(start);
    setExecutionElapsedMs(0);

    const initialMap: Record<string, ServerExecutionResult> = {};
    targetServers.forEach(s => {
      initialMap[s.id] = {
        serverId: s.id,
        serverName: s.name || s.host,
        host: s.host,
        port: s.port,
        username: s.username,
        status: 'pending',
        stdout: '',
        stderr: '',
        exitCode: 0,
        durationMs: 0,
      };
    });
    setExecutionResults(initialMap);

    const onStart = (sid: string) => {
      setActiveRunningServerId(sid);
      setExecutionResults(prev => ({
        ...prev,
        [sid]: { ...prev[sid], status: 'running', startedAt: Date.now() },
      }));
    };

    const onFinish = (sid: string, res: ServerExecutionResult) => {
      setExecutionResults(prev => ({ ...prev, [sid]: res }));
    };

    const isCancelled = () => cancelRequestedRef.current;

    const currentRecipe = recipes.find(r => r.id === selectedRecipeId);
    const recipeTitle = currentRecipe?.title || 'Ad-Hoc Automation Command';

    let finalResults: Record<string, ServerExecutionResult> = {};

    try {
      if (executionMode === 'parallel') {
        finalResults = await executeParallelFleet(
          targetServers,
          customCommand,
          isSudo,
          variableValues,
          concurrency,
          onStart,
          onFinish,
          isCancelled
        );
      } else {
        finalResults = await executeRollingFleet(
          targetServers,
          customCommand,
          isSudo,
          variableValues,
          stopOnError,
          onStart,
          onFinish,
          isCancelled
        );
      }

      const totalDuration = Date.now() - start;
      const resArray = Object.values(finalResults);
      const successCount = resArray.filter(r => r.status === 'success').length;
      const failureCount = resArray.filter(r => r.status === 'failed').length;
      const skippedCount = resArray.filter(r => r.status === 'skipped').length;

      // Persist to history
      const historyEntry: AutomationExecutionRun = {
        id: `run-${Date.now()}`,
        recipeId: selectedRecipeId !== 'custom' ? selectedRecipeId : undefined,
        recipeTitle,
        command: customCommand,
        mode: executionMode,
        concurrency,
        timestamp: start,
        totalServers: targetServers.length,
        successCount,
        failureCount,
        skippedCount,
        durationMs: totalDuration,
        results: finalResults,
      };
      const updatedHistory = saveHistoryEntry(historyEntry);
      setHistory(updatedHistory);

      // Auto-save to remote server (~/.sshdesktop/automation.json)
      if (activeConnectionId && homeDir) {
        saveAutomationToServer(activeConnectionId, homeDir, {
          username,
          customRecipes: recipes.filter(r => !r.isBuiltIn),
          history: updatedHistory,
          fleetMatrix,
          replicaSets,
          lastTargetServerIds: selectedServerIds,
        }).catch(() => {});
      }

      setBannerNotice({
        text: `Fleet Execution Finished: ${successCount} Succeeded, ${failureCount} Failed (${(totalDuration / 1000).toFixed(1)}s)`,
        isError: failureCount > 0,
      });
    } catch (err: any) {
      setBannerNotice({
        text: `Execution failed with unexpected exception: ${err?.message || String(err)}`,
        isError: true,
      });
    } finally {
      setIsRunning(false);
      setActiveRunningServerId(null);
    }
  };

  // Quick Re-run from History
  const handleRerunHistory = (run: AutomationExecutionRun) => {
    setSelectedRecipeId('custom');
    setCustomCommand(run.command);
    setExecutionMode(run.mode);
    setConcurrency(run.concurrency);
    const targetIds = Object.keys(run.results);
    setSelectedServerIds(targetIds.filter(id => connections.some(c => c.id === id)));
    setActiveTab('runner');
    setBannerNotice({ text: `Loaded previous run: "${run.recipeTitle}" on ${targetIds.length} target servers.` });
  };

  // Download Single Server Log
  const handleDownloadSingleLog = (res: ServerExecutionResult, runTitle?: string) => {
    const filename = `automation-${res.serverName.replace(/\s+/g, '_')}-${Date.now()}.log`;
    const content = `================================================================================
SSH DESKTOP FLEET AUTOMATION - SERVER EXECUTION REPORT
================================================================================
Server Name : ${res.serverName}
Host & Port : ${res.host}:${res.port}
SSH User    : ${res.username}
Execution   : ${runTitle || 'Multi-Server Automation Command'}
Status      : ${res.status.toUpperCase()}
Exit Code   : ${res.exitCode}
Duration    : ${(res.durationMs / 1000).toFixed(2)} seconds
Timestamp   : ${new Date(res.startedAt || Date.now()).toISOString()}
================================================================================
STANDARD OUTPUT (STDOUT):
--------------------------------------------------------------------------------
${res.stdout || '(No stdout)'}

================================================================================
STANDARD ERROR (STDERR):
--------------------------------------------------------------------------------
${res.stderr || '(No stderr)'}
================================================================================
`;
    downloadTextFile(filename, content);
  };

  // Download All Server Outputs in a Run (Fleet Report)
  const handleDownloadAllLogs = (run: AutomationExecutionRun) => {
    const filename = `fleet-automation-report-${run.id}.md`;
    const serversReport = Object.values(run.results).map((res, idx) => {
      return `### ${idx + 1}. Node: ${res.serverName} (${res.host}:${res.port})
- **Status**: \`${res.status.toUpperCase()}\`
- **Exit Code**: \`${res.exitCode}\`
- **Runtime**: ${(res.durationMs / 1000).toFixed(2)}s

\`\`\`
${res.stdout ? `[STDOUT]\n${res.stdout}\n` : ''}${res.stderr ? `[STDERR]\n${res.stderr}\n` : ''}${!res.stdout && !res.stderr ? '(No output recorded)' : ''}
\`\`\`
`;
    }).join('\n\n---\n\n');

    const fullDoc = `# Multi-Server Automation Fleet Report
**Run ID**: \`${run.id}\`  
**Playbook / Task**: ${run.recipeTitle}  
**Execution Mode**: ${run.mode.toUpperCase()} (Concurrency: ${run.concurrency})  
**Date & Time**: ${new Date(run.timestamp).toLocaleString()}  
**Total Target Nodes**: ${run.totalServers}  
**Summary**: ${run.successCount} Succeeded, ${run.failureCount} Failed, ${run.skippedCount} Skipped (Duration: ${(run.durationMs / 1000).toFixed(2)}s)  

## Command Script
\`\`\`bash
${run.command}
\`\`\`

---

## Detailed Node Outputs

${serversReport}
`;
    downloadTextFile(filename, fullDoc, 'text/markdown;charset=utf-8');
  };

  // Save new custom recipe
  const handleSaveRecipe = () => {
    if (!newRecipe.title || !newRecipe.command) {
      setBannerNotice({ text: 'Recipe title and bash command are required.', isError: true });
      return;
    }
    const created: AutomationRecipe = {
      id: `recipe-custom-${Date.now()}`,
      title: newRecipe.title,
      description: newRecipe.description || 'Custom fleet automation recipe',
      category: newRecipe.category as RecipeCategory || 'custom',
      icon: 'Workflow',
      command: newRecipe.command,
      isSudo: !!newRecipe.isSudo,
      isBuiltIn: false,
      createdAt: Date.now(),
    };
    const updated = saveCustomRecipe(created);
    setRecipes(updated);
    setIsRecipeModalOpen(false);
    setSelectedRecipeId(created.id);
    setBannerNotice({ text: `Custom recipe "${created.title}" saved successfully.` });

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: updated.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Delete custom recipe
  const handleDeleteRecipe = (id: string) => {
    const updated = deleteCustomRecipe(id);
    setRecipes(updated);
    if (selectedRecipeId === id) {
      setSelectedRecipeId(BUILT_IN_RECIPES[0].id);
    }
    setBannerNotice({ text: 'Custom recipe deleted.' });

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: updated.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Fleet Matrix: Organization CRUD
  const handleSaveOrg = () => {
    if (!orgForm.name.trim()) return;
    let nextOrgs = [...fleetMatrix.organizations];
    if (editingOrg) {
      nextOrgs = nextOrgs.map(o => o.id === editingOrg.id ? { ...o, name: orgForm.name, description: orgForm.description, color: orgForm.color } : o);
    } else {
      const newOrg: FleetOrganization = {
        id: `org-${Date.now()}`,
        name: orgForm.name,
        description: orgForm.description,
        color: orgForm.color || '#6366f1',
        createdAt: Date.now(),
      };
      nextOrgs.push(newOrg);
    }
    const updatedMatrix = { ...fleetMatrix, organizations: nextOrgs };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setIsOrgModalOpen(false);
    setEditingOrg(null);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteOrg = (orgId: string) => {
    const nextOrgs = fleetMatrix.organizations.filter(o => o.id !== orgId);
    const nextGroups = fleetMatrix.groups.filter(g => g.organizationId !== orgId);
    const nextMappings = { ...fleetMatrix.mappings };
    Object.keys(nextMappings).forEach(sid => {
      if (nextMappings[sid]?.organizationId === orgId) {
        delete nextMappings[sid];
      }
    });
    const updatedMatrix = { organizations: nextOrgs, groups: nextGroups, mappings: nextMappings };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Fleet Matrix: Group CRUD
  const handleSaveGroup = () => {
    if (!groupForm.name.trim() || !groupForm.organizationId) return;
    let nextGroups = [...fleetMatrix.groups];
    if (editingGroup) {
      nextGroups = nextGroups.map(g => g.id === editingGroup.id ? {
        ...g,
        name: groupForm.name,
        description: groupForm.description,
        color: groupForm.color,
        organizationId: groupForm.organizationId,
      } : g);
    } else {
      const newGrp: FleetGroup = {
        id: `grp-${Date.now()}`,
        organizationId: groupForm.organizationId,
        name: groupForm.name,
        description: groupForm.description,
        color: groupForm.color || '#3b82f6',
        createdAt: Date.now(),
      };
      nextGroups.push(newGrp);
    }
    const updatedMatrix = { ...fleetMatrix, groups: nextGroups };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setIsGroupModalOpen(false);
    setEditingGroup(null);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    const nextGroups = fleetMatrix.groups.filter(g => g.id !== groupId);
    const nextMappings = { ...fleetMatrix.mappings };
    Object.keys(nextMappings).forEach(sid => {
      if (nextMappings[sid]?.groupId === groupId) {
        delete nextMappings[sid];
      }
    });
    const updatedMatrix = { ...fleetMatrix, groups: nextGroups, mappings: nextMappings };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Fleet Matrix: Server Assignment
  const handleAssignServer = () => {
    if (!assignServerId || !assignOrgId || !assignGroupId) return;
    const nextMappings = {
      ...fleetMatrix.mappings,
      [assignServerId]: { organizationId: assignOrgId, groupId: assignGroupId },
    };
    const updatedMatrix = { ...fleetMatrix, mappings: nextMappings };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setIsAssignModalOpen(false);
    setBannerNotice({ text: 'Server assignment updated.' });
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        replicaSets,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Replica Sets: CRUD
  const handleSaveReplica = () => {
    if (!replicaForm.name.trim() || !replicaForm.primaryServerId) {
      setBannerNotice({ text: 'Replica name and primary node are required.', isError: true });
      return;
    }
    let nextReplicas = [...replicaSets];
    if (editingReplica) {
      nextReplicas = nextReplicas.map(r => r.id === editingReplica.id ? {
        ...r,
        name: replicaForm.name,
        description: replicaForm.description,
        primaryServerId: replicaForm.primaryServerId,
        replicaServerIds: replicaForm.replicaServerIds,
        replicationType: replicaForm.replicationType,
        syncCommand: replicaForm.syncCommand,
        healthCheckCommand: replicaForm.healthCheckCommand,
        autoFailover: replicaForm.autoFailover,
        updatedAt: Date.now(),
      } : r);
    } else {
      const created: ReplicaSet = {
        id: `replica-${Date.now()}`,
        name: replicaForm.name,
        description: replicaForm.description,
        primaryServerId: replicaForm.primaryServerId,
        replicaServerIds: replicaForm.replicaServerIds,
        replicationType: replicaForm.replicationType,
        syncCommand: replicaForm.syncCommand,
        healthCheckCommand: replicaForm.healthCheckCommand,
        autoFailover: replicaForm.autoFailover,
        createdAt: Date.now(),
      };
      nextReplicas.push(created);
    }
    setReplicaSets(nextReplicas);
    saveStoredReplicaSets(nextReplicas);
    setIsReplicaModalOpen(false);
    setEditingReplica(null);
    setBannerNotice({ text: `Replica cluster set saved successfully.` });
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix,
        replicaSets: nextReplicas,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteReplica = (id: string) => {
    const updated = replicaSets.filter(r => r.id !== id);
    setReplicaSets(updated);
    saveStoredReplicaSets(updated);
    setBannerNotice({ text: 'Replica cluster removed.' });
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix,
        replicaSets: updated,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Execution Summary Metrics
  const resultStats = useMemo(() => {
    const results = Object.values(executionResults);
    const total = targetServers.length;
    const success = results.filter(r => r.status === 'success').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const running = results.filter(r => r.status === 'running').length;
    const pending = results.filter(r => r.status === 'pending').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const percent = total > 0 ? Math.round(((success + failed + skipped) / total) * 100) : 0;
    return { total, success, failed, running, pending, skipped, percent };
  }, [executionResults, targetServers]);

  return (
    <div className="w-full h-full flex flex-col bg-[#0d0f18] text-gray-200 select-none overflow-hidden font-sans">
      {/* ======================================================== */}
      {/* 1. TOP HEADER & NAVIGATION BAR                            */}
      {/* ======================================================== */}
      <header className="h-14 px-5 border-b border-white/10 bg-[#141724]/90 backdrop-blur-xl flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-500 via-blue-500 to-cyan-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25">
            <Workflow className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-white tracking-wide">Multi-Server Automation</h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Enterprise Fleet
              </span>
            </div>
            <p className="text-[10px] text-gray-400">
              Orchestrator for {connections.length} nodes • Monaco VS Code Integration • Hierarchy & Replicas
            </p>
          </div>
        </div>

        {/* Tab Switcher Pills (Schedules removed) */}
        <div className="flex items-center bg-black/40 p-1 rounded-xl border border-white/5 space-x-1">
          <button
            onClick={() => setActiveTab('runner')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'runner'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Play className="w-3.5 h-3.5" />
            <span>Runner</span>
          </button>
          <button
            onClick={() => setActiveTab('recipes')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'recipes'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Recipes ({recipes.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('fleet-matrix')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'fleet-matrix'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Fleet Matrix</span>
          </button>
          <button
            onClick={() => setActiveTab('replicas')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'replicas'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Replicas ({replicaSets.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'history'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>History ({history.length})</span>
          </button>
        </div>

        {/* Global Action & Server Storage Sync Pill */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              if (activeConnectionId && homeDir) {
                checkAutomationServerFileStatus(activeConnectionId, homeDir).then(st => setServerFileStatus(st));
              }
              setIsSyncModalOpen(true);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-xs font-mono border border-white/10 flex items-center space-x-2 transition-all cursor-pointer"
            title={`Server Storage: ${serverFilePath} (Click to manage sync)`}
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                isSyncingServer ? 'bg-blue-400' : serverFileStatus?.exists ? 'bg-emerald-400' : 'bg-amber-400'
              }`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                isSyncingServer ? 'bg-blue-500' : serverFileStatus?.exists ? 'bg-emerald-500' : 'bg-amber-500'
              }`} />
            </span>
            <span className="text-gray-300 truncate max-w-[210px] text-[11px]">
              {homeDir ? `${homeDir}/.sshdesktop/automation.json` : '~/.sshdesktop/automation.json'}
            </span>
          </button>

          <button
            onClick={handleProbeFleet}
            disabled={isProbingFleet || isRunning}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-medium border border-white/10 flex items-center space-x-1.5 disabled:opacity-50 transition-all cursor-pointer"
            title="Probe connection and telemetry on fleet"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isProbingFleet ? 'animate-spin text-blue-400' : ''}`} />
            <span>{isProbingFleet ? 'Probing...' : 'Probe Fleet'}</span>
          </button>
        </div>
      </header>

      {/* Global Notice Banner */}
      {bannerNotice && (
        <div className={`px-5 py-2 text-xs flex items-center justify-between border-b ${
          bannerNotice.isError 
            ? 'bg-red-500/10 border-red-500/20 text-red-300' 
            : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
        }`}>
          <div className="flex items-center space-x-2">
            {bannerNotice.isError ? (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{bannerNotice.text}</span>
          </div>
          <button onClick={() => setBannerNotice(null)} className="hover:opacity-75 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. TAB 1: RUNNER (PRIMARY WORKSPACE)                     */}
      {/* ======================================================== */}
      {activeTab === 'runner' && (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT COLUMN: FLEET TARGET SELECTOR WITH ACTIVE GREEN & INACTIVE RED STATUS */}
          <aside className="w-72 border-r border-white/10 bg-[#111320] flex flex-col shrink-0">
            {/* Target Header with Dedicated Refresh Button */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white tracking-wide uppercase">Target Fleet</span>
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 font-mono">
                  {selectedServerIds.length}/{connections.length}
                </span>
              </div>
              <div className="flex items-center space-x-1.5">
                <button
                  onClick={handleProbeFleet}
                  disabled={isProbingFleet}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                  title="Refresh / Check Active Status on All Servers"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbingFleet ? 'animate-spin text-blue-400' : ''}`} />
                </button>
                <button
                  onClick={selectAllFiltered}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[11px] cursor-pointer"
                >
                  All
                </button>
                <button
                  onClick={deselectAllFiltered}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[11px] cursor-pointer"
                >
                  None
                </button>
              </div>
            </div>

            {/* Target Status Filters (All / Online / Offline) */}
            <div className="px-3 pt-2 pb-1 flex items-center space-x-1">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  statusFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                All ({connections.length})
              </button>
              <button
                onClick={() => setStatusFilter('online')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center space-x-1 ${
                  statusFilter === 'online' ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Active ({connections.filter(c => fleetHealth[c.id]?.reachable).length})</span>
              </button>
              <button
                onClick={() => setStatusFilter('offline')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center space-x-1 ${
                  statusFilter === 'offline' ? 'bg-red-600 text-white' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span>Inactive ({connections.filter(c => fleetHealth[c.id] && !fleetHealth[c.id]?.reachable).length})</span>
              </button>
            </div>

            {/* Target Search */}
            <div className="p-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter targets..."
                  value={serverSearchQuery}
                  onChange={e => setServerSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Servers Checkbox List with Bright Green / Red Status Badges */}
            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              {filteredServers.length === 0 ? (
                <div className="py-8 text-center text-xs text-gray-500">
                  No matching servers found.
                </div>
              ) : (
                filteredServers.map(server => {
                  const isSelected = selectedServerIds.includes(server.id);
                  const health = fleetHealth[server.id];
                  const execRes = executionResults[server.id];
                  const isOnline = health ? health.reachable : false;

                  return (
                    <div
                      key={server.id}
                      onClick={() => toggleServer(server.id)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? isOnline
                            ? 'bg-emerald-950/20 border-emerald-500/40 text-white'
                            : 'bg-red-950/20 border-red-500/40 text-white'
                          : 'bg-white/[0.02] border-white/5 text-gray-400 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded border-gray-600 text-blue-600 focus:ring-0 cursor-pointer pointer-events-none"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-xs font-semibold truncate text-gray-200">
                              {server.name || server.host}
                            </span>
                            {/* Organization or Group badge */}
                            {server.group && (
                              <span className="px-1 py-0.2 rounded text-[9px] bg-white/10 text-gray-300">
                                {server.group}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-gray-500 truncate font-mono">
                            {server.username}@{server.host}:{server.port}
                          </div>
                        </div>
                      </div>

                      {/* Explicit Active Green / Inactive Red Status Indicator */}
                      <div className="shrink-0 flex items-center space-x-1.5">
                        {execRes && execRes.status === 'running' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : isOnline ? (
                          <span
                            className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                            title={`Active / Online (${health?.latencyMs || 0}ms)`}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Active</span>
                          </span>
                        ) : (
                          <span
                            className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/20 text-red-300 border border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                            title={health?.error || 'Server is offline or unreachable'}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                            <span>Inactive</span>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Quick Fleet Target Stats Footer */}
            <div className="p-3 border-t border-white/10 bg-black/20 text-[11px] text-gray-400 flex items-center justify-between">
              <span>Selected for Execution:</span>
              <span className="font-bold text-white font-mono">{selectedServerIds.length} Nodes</span>
            </div>
          </aside>

          {/* RIGHT COLUMN: TASK DEFINITION WITH MONACO VS CODE EDITOR & RESULTS */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#0e101b] overflow-hidden">
            {/* Task Configuration Toolbar */}
            <div className="p-4 border-b border-white/10 bg-[#141624] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Recipe Picker */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-gray-400">Playbook:</span>
                  <select
                    value={selectedRecipeId}
                    onChange={e => setSelectedRecipeId(e.target.value)}
                    className="px-3 py-1.5 rounded-lg bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <optgroup label="Curated Automation Playbooks">
                      {recipes.filter(r => r.isBuiltIn).map(r => (
                        <option key={r.id} value={r.id}>{r.title}</option>
                      ))}
                    </optgroup>
                    {recipes.some(r => !r.isBuiltIn) && (
                      <optgroup label="Custom Saved Recipes">
                        {recipes.filter(r => !r.isBuiltIn).map(r => (
                          <option key={r.id} value={r.id}>{r.title}</option>
                        ))}
                      </optgroup>
                    )}
                    <option value="custom">⚡ Ad-Hoc Custom Bash Script</option>
                  </select>
                </div>

                {/* Execution Mode & Concurrency */}
                <div className="flex items-center space-x-3 bg-black/30 p-1.5 rounded-xl border border-white/10">
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => setExecutionMode('parallel')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center space-x-1 cursor-pointer ${
                        executionMode === 'parallel'
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Zap className="w-3 h-3" />
                      <span>Parallel</span>
                    </button>
                    <button
                      onClick={() => setExecutionMode('rolling')}
                      className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center space-x-1 cursor-pointer ${
                        executionMode === 'rolling'
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Layers className="w-3 h-3" />
                      <span>Rolling</span>
                    </button>
                  </div>

                  {executionMode === 'parallel' ? (
                    <div className="flex items-center space-x-1.5 border-l border-white/10 pl-3">
                      <span className="text-[11px] text-gray-400">Workers:</span>
                      <select
                        value={concurrency}
                        onChange={e => setConcurrency(Number(e.target.value))}
                        className="px-2 py-0.5 rounded bg-black/60 border border-white/10 text-xs text-white focus:outline-none"
                      >
                        <option value={1}>1 (Sequential)</option>
                        <option value={2}>2 Concurrent</option>
                        <option value={5}>5 Concurrent</option>
                        <option value={10}>10 Concurrent</option>
                        <option value={50}>All Concurrent</option>
                      </select>
                    </div>
                  ) : (
                    <label className="flex items-center space-x-1.5 border-l border-white/10 pl-3 text-[11px] text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stopOnError}
                        onChange={e => setStopOnError(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-blue-600 border-gray-600"
                      />
                      <span>Stop on Failure</span>
                    </label>
                  )}

                  {/* Sudo Toggle */}
                  <label className="flex items-center space-x-1.5 border-l border-white/10 pl-3 text-[11px] text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSudo}
                      onChange={e => setIsSudo(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-indigo-600 border-gray-600"
                    />
                    <Shield className="w-3 h-3 text-indigo-400" />
                    <span>Run as Sudo</span>
                  </label>
                </div>

                {/* Primary Execution CTA */}
                <div className="flex items-center space-x-2">
                  {isRunning ? (
                    <button
                      onClick={handleCancelExecution}
                      className="px-4 py-2 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold shadow-lg shadow-red-600/30 flex items-center space-x-2 transition-all cursor-pointer"
                    >
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Abort Run</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleRunAutomation}
                      disabled={selectedServerIds.length === 0}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 hover:opacity-95 text-white text-xs font-bold shadow-lg shadow-blue-500/25 flex items-center space-x-2 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Execute on Fleet ({selectedServerIds.length})</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Dynamic Variables Inputs */}
              {recipes.find(r => r.id === selectedRecipeId)?.variables && (
                <div className="pt-2 border-t border-white/5 flex flex-wrap gap-3">
                  {recipes.find(r => r.id === selectedRecipeId)?.variables?.map(v => (
                    <div key={v.name} className="flex items-center space-x-2 text-xs">
                      <span className="text-gray-400">{v.label}:</span>
                      <input
                        type="text"
                        placeholder={v.placeholder || v.name}
                        value={variableValues[v.name] || ''}
                        onChange={e => setVariableValues(prev => ({ ...prev, [v.name]: e.target.value }))}
                        className="px-2.5 py-1 rounded bg-black/60 border border-white/15 text-white text-xs min-w-[220px] focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MONACO VS CODE EDITOR TOOLBAR */}
            <div className="px-4 py-2 border-b border-white/10 bg-[#0d101d] flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center space-x-3">
                <span className="flex items-center space-x-1.5 font-semibold text-blue-400">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Script Editor</span>
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 font-mono">
                  Shell / Bash
                </span>

                {/* Variable Quick Injectors */}
                <div className="hidden lg:flex items-center space-x-1 text-[10px]">
                  <span className="text-gray-500 mr-1">Variables:</span>
                  {['{{SERVER_NAME}}', '{{SERVER_HOST}}', '{{SERVER_USER}}', '{{DATE}}'].map(tag => (
                    <button
                      key={tag}
                      onClick={() => setCustomCommand(prev => prev + ` ${tag}`)}
                      className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-cyan-300 font-mono transition-all cursor-pointer"
                      title={`Append ${tag}`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {/* Monaco Controls: Zoom In (Ctrl++), Zoom Out (Ctrl+-), Word Wrap (Alt+Z) */}
              <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-1 bg-black/40 px-2 py-0.5 rounded-lg border border-white/10">
                  <button
                    onClick={() => setEditorFontSize(prev => Math.max(prev - 1, 9))}
                    className="p-1 hover:text-white text-gray-400 transition-all cursor-pointer"
                    title="Zoom Out (Ctrl + -)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] font-mono text-gray-300 min-w-[32px] text-center">
                    {editorFontSize}px
                  </span>
                  <button
                    onClick={() => setEditorFontSize(prev => Math.min(prev + 1, 32))}
                    className="p-1 hover:text-white text-gray-400 transition-all cursor-pointer"
                    title="Zoom In (Ctrl + +)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                </div>

                <button
                  onClick={() => setIsWordWrap(prev => !prev)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all flex items-center space-x-1 border cursor-pointer ${
                    isWordWrap
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Toggle Word Wrap (Alt + Z)"
                >
                  <WrapText className="w-3 h-3" />
                  <span>Wrap {isWordWrap ? 'ON' : 'OFF'}</span>
                </button>

                <button
                  onClick={() => setShowMinimap(prev => !prev)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all border cursor-pointer ${
                    showMinimap
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Toggle Minimap"
                >
                  Minimap
                </button>
              </div>
            </div>

            {/* FULL MONACO VS CODE EDITOR CANVAS */}
            <div className="h-52 border-b border-white/10 bg-[#07090f] relative overflow-hidden">
              <Editor
                height="100%"
                language="shell"
                theme="vs-dark"
                value={customCommand}
                onChange={val => setCustomCommand(val || '')}
                options={{
                  fontSize: editorFontSize,
                  wordWrap: isWordWrap ? 'on' : 'off',
                  minimap: { enabled: showMinimap },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  cursorBlinking: 'smooth',
                  padding: { top: 8, bottom: 8 },
                }}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
              />
            </div>

            {/* Execution Progress & Statistics Banner */}
            <div className="p-3 border-b border-white/10 bg-[#121422] flex items-center justify-between">
              <div className="flex items-center space-x-4 text-xs">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-white">Progress:</span>
                  <div className="w-36 h-2 rounded-full bg-white/10 overflow-hidden relative">
                    <div
                      className={`h-full transition-all duration-300 ${
                        resultStats.failed > 0 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${resultStats.percent}%` }}
                    />
                  </div>
                  <span className="font-mono text-gray-300">{resultStats.percent}%</span>
                </div>

                <div className="flex items-center space-x-2 text-[11px]">
                  <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 font-medium">
                    ✓ {resultStats.success} Succeeded
                  </span>
                  {resultStats.failed > 0 && (
                    <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/20 font-medium">
                      ✕ {resultStats.failed} Failed
                    </span>
                  )}
                  {resultStats.running > 0 && (
                    <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20 font-medium flex items-center space-x-1">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                      <span>{resultStats.running} Running</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Elapsed time & View toggles */}
              <div className="flex items-center space-x-3 text-xs">
                <div className="flex items-center space-x-1 text-gray-400 font-mono text-[11px]">
                  <Clock className="w-3 h-3" />
                  <span>Elapsed: {(executionElapsedMs / 1000).toFixed(1)}s</span>
                </div>

                <div className="flex items-center bg-black/40 rounded p-0.5 border border-white/10 space-x-1">
                  <button
                    onClick={() => setOutputViewMode('grid')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                      outputViewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Server Cards
                  </button>
                  <button
                    onClick={() => setOutputViewMode('unified')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer ${
                      outputViewMode === 'unified' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Unified Log
                  </button>
                </div>
              </div>
            </div>

            {/* Execution Output Matrix Area */}
            <div className="flex-1 overflow-y-auto p-4 bg-[#0a0c14]">
              {targetServers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <Server className="w-12 h-12 text-gray-600 mb-3" />
                  <h3 className="text-sm font-semibold text-gray-300">No Target Servers Selected</h3>
                  <p className="text-xs text-gray-500 max-w-sm mt-1">
                    Select target servers from the left panel to execute commands across your fleet.
                  </p>
                </div>
              ) : Object.keys(executionResults).length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <Play className="w-12 h-12 text-blue-500/50 mb-3" />
                  <h3 className="text-sm font-semibold text-gray-300">Ready for Fleet Execution</h3>
                  <p className="text-xs text-gray-500 max-w-sm mt-1">
                    Click &quot;Execute on Fleet&quot; above to run across {selectedServerIds.length} target machines.
                  </p>
                </div>
              ) : outputViewMode === 'grid' ? (
                /* SERVER CARDS GRID VIEW */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {targetServers.map(server => {
                    const res = executionResults[server.id];
                    if (!res) return null;

                    const isSuccess = res.status === 'success';
                    const isFailed = res.status === 'failed';
                    const isRunningCard = res.status === 'running';

                    return (
                      <div
                        key={server.id}
                        className={`rounded-2xl border p-3 flex flex-col justify-between transition-all ${
                          isRunningCard
                            ? 'bg-blue-950/20 border-blue-500/40 shadow-lg shadow-blue-500/10'
                            : isSuccess
                            ? 'bg-[#111624] border-emerald-500/30'
                            : isFailed
                            ? 'bg-[#1a1218] border-red-500/30'
                            : 'bg-white/[0.02] border-white/10 opacity-70'
                        }`}
                      >
                        {/* Server Card Header */}
                        <div className="flex items-center justify-between pb-2 border-b border-white/5">
                          <div className="flex items-center space-x-2 min-w-0">
                            {isRunningCard ? (
                              <RefreshCw className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
                            ) : isSuccess ? (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            ) : isFailed ? (
                              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                            ) : (
                              <Clock className="w-4 h-4 text-gray-500 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <h4 className="text-xs font-bold text-white truncate">
                                {server.name || server.host}
                              </h4>
                              <p className="text-[10px] text-gray-400 font-mono truncate">
                                {server.host}:{server.port}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {res.durationMs > 0 && (
                              <span className="text-[10px] text-gray-400 font-mono">
                                {(res.durationMs / 1000).toFixed(2)}s
                              </span>
                            )}
                            <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                              isSuccess
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : isFailed
                                ? 'bg-red-500/20 text-red-300'
                                : isRunningCard
                                ? 'bg-blue-500/20 text-blue-300'
                                : 'bg-gray-500/20 text-gray-400'
                            }`}>
                              {res.status.toUpperCase()}
                            </span>
                          </div>
                        </div>

                        {/* Terminal Output Snippet */}
                        <div
                          onClick={() => setInspectResult(res)}
                          className="mt-2 h-24 p-2 rounded-lg bg-black/60 border border-white/5 font-mono text-[10px] text-gray-300 overflow-hidden cursor-pointer hover:border-white/20 transition-all select-text flex flex-col justify-between"
                          title="Click to expand terminal logs"
                        >
                          <div className="overflow-hidden leading-relaxed line-clamp-4">
                            {isRunningCard ? (
                              <div className="text-blue-400 flex items-center space-x-1.5">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Executing script on remote node...</span>
                              </div>
                            ) : res.stdout ? (
                              <span className="text-gray-300 whitespace-pre-wrap">{res.stdout}</span>
                            ) : res.stderr ? (
                              <span className="text-red-400 whitespace-pre-wrap">{res.stderr}</span>
                            ) : (
                              <span className="text-gray-600 italic">No output returned.</span>
                            )}
                          </div>
                          <div className="pt-1 flex items-center justify-between text-[9px] text-gray-500 border-t border-white/5">
                            <span>Exit Code: {res.exitCode}</span>
                            <span className="text-blue-400 flex items-center space-x-0.5">
                              <Eye className="w-3 h-3" />
                              <span>Inspect Log</span>
                            </span>
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="mt-2.5 pt-2 flex items-center justify-between text-xs">
                          <button
                            onClick={() => handleDownloadSingleLog(res, selectedRecipeId)}
                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[10px] flex items-center space-x-1 transition-all cursor-pointer"
                            title="Download this server's output log"
                          >
                            <Download className="w-3 h-3 text-cyan-400" />
                            <span>Download Log</span>
                          </button>

                          <button
                            onClick={() => setInspectResult(res)}
                            className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
                          >
                            Full Output &rarr;
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* UNIFIED LOG CONSOLE VIEW */
                <div className="rounded-2xl border border-white/10 bg-black/80 font-mono text-xs overflow-hidden flex flex-col h-full shadow-2xl">
                  <div className="px-4 py-2.5 bg-[#141724] border-b border-white/10 flex items-center justify-between text-gray-400">
                    <span className="text-xs font-bold text-white">Fleet Unified Terminal Stream</span>
                    <button
                      onClick={() => {
                        const fullLog = targetServers
                          .map(s => {
                            const res = executionResults[s.id];
                            return `=== [${s.name || s.host}] (Status: ${res?.status}, Code: ${res?.exitCode}) ===\n${res?.stdout || ''}\n${res?.stderr || ''}\n`;
                          })
                          .join('\n');
                        handleCopy(fullLog, 'unified-full');
                      }}
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center space-x-1 cursor-pointer"
                    >
                      {copiedKey === 'unified-full' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copy Unified Log</span>
                    </button>
                  </div>

                  <div className="flex-1 p-4 overflow-y-auto space-y-4 select-text">
                    {targetServers.map(s => {
                      const res = executionResults[s.id];
                      if (!res) return null;

                      return (
                        <div key={s.id} className="border-b border-white/5 pb-3">
                          <div className="flex items-center space-x-2 text-blue-400 font-semibold mb-1">
                            <span>[{s.name || s.host}]</span>
                            <span className="text-gray-500 text-[10px]">({s.host})</span>
                            <span className={`text-[10px] px-1.5 py-0.2 rounded ${
                              res.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}>
                              exit {res.exitCode} ({res.durationMs}ms)
                            </span>
                          </div>
                          {res.stdout && (
                            <pre className="text-emerald-300/90 whitespace-pre-wrap pl-2 font-mono text-[11px] leading-relaxed">
                              {res.stdout}
                            </pre>
                          )}
                          {res.stderr && (
                            <pre className="text-red-400 whitespace-pre-wrap pl-2 font-mono text-[11px] leading-relaxed">
                              {res.stderr}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. TAB 2: RECIPE PLAYBOOKS                               */}
      {/* ======================================================== */}
      {activeTab === 'recipes' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Automation Recipes & Playbooks</h2>
                <p className="text-xs text-gray-400">
                  Curated operational workflows and customizable multi-server scripts
                </p>
              </div>

              <button
                onClick={() => setIsRecipeModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center space-x-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Custom Recipe</span>
              </button>
            </div>

            {/* Recipes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recipes.map(recipe => (
                <div
                  key={recipe.id}
                  className="rounded-2xl border border-white/10 bg-[#131626] p-4 flex flex-col justify-between hover:border-white/25 transition-all shadow-lg"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        recipe.category === 'security'
                          ? 'bg-amber-500/20 text-amber-300'
                          : recipe.category === 'docker'
                          ? 'bg-blue-500/20 text-blue-300'
                          : recipe.category === 'maintenance'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : recipe.category === 'cleanup'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-indigo-500/20 text-indigo-300'
                      }`}>
                        {recipe.category}
                      </span>

                      {recipe.isSudo && (
                        <span className="flex items-center space-x-1 text-[10px] text-red-400">
                          <Shield className="w-3 h-3" />
                          <span>Requires Sudo</span>
                        </span>
                      )}
                    </div>

                    <h3 className="mt-2 text-sm font-bold text-white">{recipe.title}</h3>
                    <p className="mt-1 text-xs text-gray-400 line-clamp-2 leading-relaxed">
                      {recipe.description}
                    </p>

                    <div className="mt-3 p-2.5 rounded-xl bg-black/60 border border-white/5 font-mono text-[10px] text-emerald-400/90 h-20 overflow-hidden select-text">
                      <pre className="whitespace-pre-wrap">{recipe.command}</pre>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                    {!recipe.isBuiltIn ? (
                      <button
                        onClick={() => handleDeleteRecipe(recipe.id)}
                        className="text-gray-500 hover:text-red-400 p-1.5 transition-all cursor-pointer"
                        title="Delete custom recipe"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-500 font-mono">Built-In</span>
                    )}

                    <button
                      onClick={() => {
                        setSelectedRecipeId(recipe.id);
                        setActiveTab('runner');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold flex items-center space-x-1 transition-all cursor-pointer"
                    >
                      <span>Load in Runner</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. TAB 3: FLEET MATRIX (ORGANIZATION > GROUP > SERVER)   */}
      {/* ======================================================== */}
      {activeTab === 'fleet-matrix' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Enterprise Fleet Matrix</h2>
                <p className="text-xs text-gray-400">
                  Manage infrastructure hierarchy: Organization &gt; Group &gt; Server. Automatically persisted to <code className="text-amber-300 font-mono text-[10px]">{serverFilePath}</code>.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setEditingOrg(null);
                    setOrgForm({ name: '', description: '', color: '#6366f1' });
                    setIsOrgModalOpen(true);
                  }}
                  className="px-3 py-2 rounded-xl bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Organization</span>
                </button>

                <button
                  onClick={() => {
                    if (fleetMatrix.organizations.length === 0) {
                      setBannerNotice({ text: 'Please create an organization first.', isError: true });
                      return;
                    }
                    setEditingGroup(null);
                    setGroupForm({ organizationId: fleetMatrix.organizations[0].id, name: '', description: '', color: '#3b82f6' });
                    setIsGroupModalOpen(true);
                  }}
                  className="px-3 py-2 rounded-xl bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Group</span>
                </button>

                <button
                  onClick={() => {
                    if (connections.length === 0) {
                      setBannerNotice({ text: 'No servers available to assign.', isError: true });
                      return;
                    }
                    setAssignServerId(connections[0].id);
                    setAssignOrgId(fleetMatrix.organizations[0]?.id || '');
                    setAssignGroupId(fleetMatrix.groups[0]?.id || '');
                    setIsAssignModalOpen(true);
                  }}
                  className="px-3 py-2 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 hover:text-white border border-cyan-500/30 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <MoveRight className="w-4 h-4" />
                  <span>Assign Server</span>
                </button>

                <button
                  onClick={() => handleSaveToServer(false)}
                  disabled={isSyncingServer}
                  className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 flex items-center space-x-1.5 cursor-pointer"
                  title="Save hierarchy to remote server profile"
                >
                  <CloudUpload className="w-4 h-4" />
                  <span>Save to Server</span>
                </button>
              </div>
            </div>

            {/* Organizations Hierarchy Tree */}
            <div className="space-y-6">
              {fleetMatrix.organizations.map(org => {
                const orgGroups = fleetMatrix.groups.filter(g => g.organizationId === org.id);

                return (
                  <div
                    key={org.id}
                    className="rounded-3xl border border-white/10 bg-[#121526] p-5 shadow-xl space-y-4"
                  >
                    {/* Organization Header */}
                    <div className="flex items-center justify-between pb-3 border-b border-white/10">
                      <div className="flex items-center space-x-3">
                        <span
                          className="w-4 h-4 rounded-full shrink-0 shadow-lg"
                          style={{ backgroundColor: org.color || '#6366f1' }}
                        />
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-base font-bold text-white tracking-wide">{org.name}</h3>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/10 text-gray-300">
                              Org ID: {org.id}
                            </span>
                          </div>
                          {org.description && (
                            <p className="text-xs text-gray-400 mt-0.5">{org.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => {
                            setEditingOrg(org);
                            setOrgForm({ name: org.name, description: org.description || '', color: org.color || '#6366f1' });
                            setIsOrgModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                          title="Edit Organization"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteOrg(org.id)}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all cursor-pointer"
                          title="Delete Organization"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Groups Inside Organization */}
                    {orgGroups.length === 0 ? (
                      <div className="py-6 text-center text-xs text-gray-500 border border-dashed border-white/10 rounded-2xl">
                        No groups created under this organization yet. Click &quot;Add Group&quot; above to create one.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {orgGroups.map(grp => {
                          // Find all servers mapped to this group
                          const assignedServers = connections.filter(
                            c => fleetMatrix.mappings[c.id]?.groupId === grp.id
                          );

                          return (
                            <div
                              key={grp.id}
                              className="rounded-2xl border border-white/10 bg-[#171b30] p-4 flex flex-col justify-between space-y-3 shadow-md"
                            >
                              <div>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center space-x-2">
                                    <span
                                      className="w-3 h-3 rounded-full"
                                      style={{ backgroundColor: grp.color || '#3b82f6' }}
                                    />
                                    <h4 className="text-sm font-bold text-white">{grp.name}</h4>
                                    <span className="px-1.5 py-0.2 rounded text-[10px] bg-blue-500/20 text-blue-300 font-mono">
                                      {assignedServers.length} Servers
                                    </span>
                                  </div>

                                  <div className="flex items-center space-x-1">
                                    <button
                                      onClick={() => {
                                        setEditingGroup(grp);
                                        setGroupForm({ organizationId: grp.organizationId, name: grp.name, description: grp.description || '', color: grp.color || '#3b82f6' });
                                        setIsGroupModalOpen(true);
                                      }}
                                      className="p-1 text-gray-400 hover:text-white cursor-pointer"
                                      title="Edit Group"
                                    >
                                      <Edit3 className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteGroup(grp.id)}
                                      className="p-1 text-gray-400 hover:text-red-400 cursor-pointer"
                                      title="Delete Group"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                                {grp.description && (
                                  <p className="text-[11px] text-gray-400 mt-1">{grp.description}</p>
                                )}
                              </div>

                              {/* Server Cards List */}
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {assignedServers.length === 0 ? (
                                  <div className="text-[11px] text-gray-500 italic py-2 text-center">
                                    No servers assigned to this group.
                                  </div>
                                ) : (
                                  assignedServers.map(s => {
                                    const health = fleetHealth[s.id];
                                    const isOnline = health ? health.reachable : false;

                                    return (
                                      <div
                                        key={s.id}
                                        className="p-2 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs"
                                      >
                                        <div className="flex items-center space-x-2 min-w-0">
                                          <span
                                            className={`w-2 h-2 rounded-full shrink-0 ${
                                              isOnline ? 'bg-emerald-400' : 'bg-red-500'
                                            }`}
                                          />
                                          <div className="min-w-0 truncate">
                                            <span className="font-semibold text-white truncate block">
                                              {s.name || s.host}
                                            </span>
                                            <span className="text-[10px] text-gray-400 font-mono">
                                              {s.username}@{s.host}
                                            </span>
                                          </div>
                                        </div>

                                        <button
                                          onClick={() => {
                                            const nextMappings = { ...fleetMatrix.mappings };
                                            delete nextMappings[s.id];
                                            const updated = { ...fleetMatrix, mappings: nextMappings };
                                            setFleetMatrix(updated);
                                            saveStoredFleetMatrix(updated);
                                          }}
                                          className="text-[10px] text-gray-500 hover:text-red-400 cursor-pointer"
                                          title="Remove from group"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. TAB 4: REPLICAS (CLUSTER & REPLICATION MANAGER)       */}
      {/* ======================================================== */}
      {activeTab === 'replicas' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Replica Sets &amp; High-Availability</h2>
                <p className="text-xs text-gray-400">
                  Manage Primary-Replica cluster topologies, health checks, and sync commands. Stored in <code className="text-amber-300 font-mono text-[10px]">{serverFilePath}</code>.
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    if (connections.length < 2) {
                      setBannerNotice({ text: 'At least 2 server connections are required to form a replica set.', isError: true });
                      return;
                    }
                    setEditingReplica(null);
                    setReplicaForm({
                      name: '',
                      description: '',
                      primaryServerId: connections[0].id,
                      replicaServerIds: connections.slice(1).map(c => c.id),
                      replicationType: 'database',
                      syncCommand: 'systemctl is-active postgresql || systemctl is-active mysql',
                      healthCheckCommand: 'uptime && free -h',
                      autoFailover: false,
                    });
                    setIsReplicaModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center space-x-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Replica Set</span>
                </button>
              </div>
            </div>

            {/* Replicas List */}
            {replicaSets.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-500 rounded-3xl border border-white/5 bg-[#121422]">
                No replica cluster sets defined yet. Click &quot;Add Replica Set&quot; above to configure primary/replica nodes.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {replicaSets.map(replica => {
                  const primaryConn = connections.find(c => c.id === replica.primaryServerId);
                  const replicaConns = connections.filter(c => replica.replicaServerIds.includes(c.id));
                  const primaryHealth = fleetHealth[replica.primaryServerId];

                  return (
                    <div
                      key={replica.id}
                      className="rounded-3xl border border-white/10 bg-[#131626] p-5 shadow-xl space-y-4"
                    >
                      <div className="flex items-center justify-between pb-3 border-b border-white/10">
                        <div>
                          <div className="flex items-center space-x-2">
                            <h3 className="text-base font-bold text-white">{replica.name}</h3>
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-500/20 text-indigo-300">
                              {replica.replicationType}
                            </span>
                            {replica.autoFailover && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300">
                                Auto-Failover
                              </span>
                            )}
                          </div>
                          {replica.description && (
                            <p className="text-xs text-gray-400 mt-1">{replica.description}</p>
                          )}
                        </div>

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => {
                              setEditingReplica(replica);
                              setReplicaForm({
                                name: replica.name,
                                description: replica.description || '',
                                primaryServerId: replica.primaryServerId,
                                replicaServerIds: replica.replicaServerIds,
                                replicationType: replica.replicationType,
                                syncCommand: replica.syncCommand || '',
                                healthCheckCommand: replica.healthCheckCommand || '',
                                autoFailover: !!replica.autoFailover,
                              });
                              setIsReplicaModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                            title="Edit Replica Set"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteReplica(replica.id)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all cursor-pointer"
                            title="Delete Replica Set"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Cluster Node Map: Primary -> Replicas */}
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {/* Primary Node */}
                        <div className="p-3 rounded-2xl bg-indigo-950/20 border border-indigo-500/40">
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="font-bold text-indigo-300 flex items-center space-x-1">
                              <span className="w-2 h-2 rounded-full bg-indigo-400" />
                              <span>PRIMARY (LEADER)</span>
                            </span>
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                              primaryHealth?.reachable ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}>
                              {primaryHealth?.reachable ? 'HEALTHY' : 'OFFLINE'}
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white truncate">
                            {primaryConn?.name || primaryConn?.host || 'Unknown Node'}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">
                            {primaryConn?.username}@{primaryConn?.host}:{primaryConn?.port}
                          </div>
                        </div>

                        {/* Replica Nodes */}
                        <div className="md:col-span-2 p-3 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                          <div className="text-xs font-bold text-gray-300 flex items-center space-x-1">
                            <GitBranch className="w-3.5 h-3.5 text-blue-400" />
                            <span>REPLICA NODES ({replicaConns.length})</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {replicaConns.map(rep => {
                              const repHealth = fleetHealth[rep.id];

                              return (
                                <div
                                  key={rep.id}
                                  className="p-2 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between text-xs"
                                >
                                  <div className="min-w-0">
                                    <div className="font-semibold text-white truncate">{rep.name || rep.host}</div>
                                    <div className="text-[10px] text-gray-500 font-mono truncate">
                                      {rep.host}:{rep.port}
                                    </div>
                                  </div>
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                                    repHealth?.reachable ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                                  }`}>
                                    {repHealth?.reachable ? 'SYNC' : 'LAG/OFF'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      {/* Commands */}
                      {replica.syncCommand && (
                        <div className="p-2.5 rounded-xl bg-black/60 border border-white/5 font-mono text-[10px] text-gray-400 flex items-center justify-between">
                          <span className="truncate">Sync: <code className="text-emerald-300">{replica.syncCommand}</code></span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 6. TAB 5: RUN HISTORY (WITH DOWNLOAD ONE & DOWNLOAD ALL) */}
      {/* ======================================================== */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Fleet Automation Audit History</h2>
                <p className="text-xs text-gray-400">
                  Full execution logs with single-server and bundled multi-server report download
                </p>
              </div>

              {history.length > 0 && (
                <button
                  onClick={() => {
                    clearHistory();
                    setHistory([]);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-400 text-xs font-semibold border border-red-500/20 flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear History</span>
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-500 rounded-2xl border border-white/5 bg-[#121422]">
                No automation history recorded yet. Runs executed in the Runner will appear here.
              </div>
            ) : (
              <div className="space-y-4">
                {history.map(run => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-white/10 bg-[#131626] p-4 flex flex-col justify-between hover:border-white/20 transition-all shadow-md space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-2.5">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="text-sm font-bold text-white">{run.recipeTitle}</h3>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-500/20 text-blue-300 uppercase">
                            {run.mode}
                          </span>
                        </div>
                        <span className="text-[10px] text-gray-500 font-mono">
                          {new Date(run.timestamp).toLocaleString()} • Duration: {(run.durationMs / 1000).toFixed(2)}s
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        {/* Download All Report Button */}
                        <button
                          onClick={() => handleDownloadAllLogs(run)}
                          className="px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white text-xs font-semibold transition-all flex items-center space-x-1 cursor-pointer"
                          title="Download complete multi-server fleet execution report (.md)"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download All</span>
                        </button>

                        <button
                          onClick={() => handleRerunHistory(run)}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold transition-all flex items-center space-x-1 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Re-Run</span>
                        </button>
                      </div>
                    </div>

                    {/* Command Snippet */}
                    <div className="p-2 rounded-lg bg-black/60 border border-white/5 font-mono text-[10px] text-gray-300 overflow-hidden line-clamp-2">
                      {run.command}
                    </div>

                    {/* Servers Result Grid with Individual Log Downloads */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                      {Object.values(run.results).map(res => (
                        <div
                          key={res.serverId}
                          className="p-2 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs"
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-semibold text-white truncate text-[11px]">{res.serverName}</div>
                            <div className="text-[10px] text-gray-500 font-mono">
                              exit {res.exitCode} ({(res.durationMs / 1000).toFixed(1)}s)
                            </div>
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold ${
                              res.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                            }`}>
                              {res.status.toUpperCase()}
                            </span>
                            <button
                              onClick={() => handleDownloadSingleLog(res, run.recipeTitle)}
                              className="p-1 rounded bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white transition-all cursor-pointer"
                              title="Download single server log file"
                            >
                              <Download className="w-3 h-3 text-cyan-400" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 7. MODAL: DETAILED SERVER OUTPUT INSPECTOR               */}
      {/* ======================================================== */}
      {inspectResult && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-4xl bg-[#121524] border border-white/15 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#171a2e]">
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  inspectResult.status === 'success'
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-red-500/20 text-red-400'
                }`}>
                  {inspectResult.status === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{inspectResult.serverName} Output Log</h3>
                  <p className="text-[11px] text-gray-400 font-mono">
                    {inspectResult.host}:{inspectResult.port} • Exit Code: {inspectResult.exitCode} • Runtime: {(inspectResult.durationMs / 1000).toFixed(2)}s
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDownloadSingleLog(inspectResult)}
                  className="px-3 py-1.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600 text-cyan-300 hover:text-white text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Log</span>
                </button>
                <button
                  onClick={() => handleCopy(inspectResult.stdout || inspectResult.stderr, 'modal-output')}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  {copiedKey === 'modal-output' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy</span>
                </button>
                <button
                  onClick={() => setInspectResult(null)}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-5 overflow-y-auto bg-black font-mono text-xs select-text space-y-4">
              {inspectResult.stdout && (
                <div>
                  <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                    Standard Output (stdout):
                  </span>
                  <pre className="p-3 rounded-xl bg-white/[0.03] border border-white/5 text-gray-200 whitespace-pre-wrap leading-relaxed">
                    {inspectResult.stdout}
                  </pre>
                </div>
              )}

              {inspectResult.stderr && (
                <div>
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider block mb-1">
                    Standard Error (stderr):
                  </span>
                  <pre className="p-3 rounded-xl bg-red-950/20 border border-red-500/20 text-red-300 whitespace-pre-wrap leading-relaxed">
                    {inspectResult.stderr}
                  </pre>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-[#171a2e] flex items-center justify-end">
              <button
                onClick={() => setInspectResult(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 8. MODAL: CREATE / EDIT ORGANIZATION                     */}
      {/* ======================================================== */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingOrg ? 'Edit Organization' : 'Create Infrastructure Organization'}
              </h3>
              <button onClick={() => setIsOrgModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Organization Name</label>
                <input
                  type="text"
                  placeholder="e.g. Production Infrastructure"
                  value={orgForm.name}
                  onChange={e => setOrgForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Primary cloud enterprise nodes"
                  value={orgForm.description}
                  onChange={e => setOrgForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Color Accent</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={orgForm.color}
                    onChange={e => setOrgForm(prev => ({ ...prev, color: e.target.value }))}
                    className="w-10 h-8 rounded bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-xs text-gray-300">{orgForm.color}</span>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsOrgModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveOrg}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                Save Organization
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 9. MODAL: CREATE / EDIT GROUP                            */}
      {/* ======================================================== */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingGroup ? 'Edit Server Group' : 'Create Server Group'}
              </h3>
              <button onClick={() => setIsGroupModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Parent Organization</label>
                <select
                  value={groupForm.organizationId}
                  onChange={e => setGroupForm(prev => ({ ...prev, organizationId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {fleetMatrix.organizations.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Group Name</label>
                <input
                  type="text"
                  placeholder="e.g. Web Tier / API Gateways"
                  value={groupForm.name}
                  onChange={e => setGroupForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="e.g. Nginx reverse proxies and web services"
                  value={groupForm.description}
                  onChange={e => setGroupForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsGroupModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveGroup}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                Save Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 10. MODAL: ASSIGN SERVER TO ORGANIZATION & GROUP         */}
      {/* ======================================================== */}
      {isAssignModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Assign Server to Group</h3>
              <button onClick={() => setIsAssignModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Select Server</label>
                <select
                  value={assignServerId}
                  onChange={e => setAssignServerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {connections.map(c => (
                    <option key={c.id} value={c.id}>{c.name || c.host} ({c.host})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Target Organization</label>
                <select
                  value={assignOrgId}
                  onChange={e => {
                    setAssignOrgId(e.target.value);
                    const matchingGroups = fleetMatrix.groups.filter(g => g.organizationId === e.target.value);
                    if (matchingGroups.length > 0) {
                      setAssignGroupId(matchingGroups[0].id);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {fleetMatrix.organizations.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Target Group</label>
                <select
                  value={assignGroupId}
                  onChange={e => setAssignGroupId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {fleetMatrix.groups
                    .filter(g => !assignOrgId || g.organizationId === assignOrgId)
                    .map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsAssignModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleAssignServer}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                Assign Server
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 11. MODAL: CREATE / EDIT REPLICA SET                     */}
      {/* ======================================================== */}
      {isReplicaModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingReplica ? 'Edit Replica Cluster Set' : 'Configure New Replica Set'}
              </h3>
              <button onClick={() => setIsReplicaModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Replica Cluster Name</label>
                <input
                  type="text"
                  placeholder="e.g. PostgreSQL HA Main Cluster"
                  value={replicaForm.name}
                  onChange={e => setReplicaForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Primary Node (Leader)</label>
                  <select
                    value={replicaForm.primaryServerId}
                    onChange={e => setReplicaForm(prev => ({ ...prev, primaryServerId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {connections.map(c => (
                      <option key={c.id} value={c.id}>{c.name || c.host}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Replication Type</label>
                  <select
                    value={replicaForm.replicationType}
                    onChange={e => setReplicaForm(prev => ({ ...prev, replicationType: e.target.value as ReplicationType }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="database">Database Streaming</option>
                    <option value="rsync">Data / File Sync (rsync)</option>
                    <option value="config">Config Mirroring</option>
                    <option value="service">Service Failover</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  Select Replica Nodes (Followers)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto p-2 rounded-xl bg-black/40 border border-white/10">
                  {connections
                    .filter(c => c.id !== replicaForm.primaryServerId)
                    .map(c => {
                      const isChecked = replicaForm.replicaServerIds.includes(c.id);

                      return (
                        <label
                          key={c.id}
                          className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer p-1 rounded hover:bg-white/5"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setReplicaForm(prev => ({
                                ...prev,
                                replicaServerIds: isChecked
                                  ? prev.replicaServerIds.filter(id => id !== c.id)
                                  : [...prev.replicaServerIds, c.id],
                              }));
                            }}
                            className="w-3.5 h-3.5 rounded text-blue-600"
                          />
                          <span className="truncate">{c.name || c.host}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Sync / Trigger Command</label>
                <input
                  type="text"
                  placeholder="e.g. systemctl is-active postgresql || pg_stat_replication"
                  value={replicaForm.syncCommand}
                  onChange={e => setReplicaForm(prev => ({ ...prev, syncCommand: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsReplicaModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReplica}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                Save Replica Set
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 12. MODAL: CREATE CUSTOM RECIPE                          */}
      {/* ======================================================== */}
      {isRecipeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create Custom Automation Playbook</h3>
              <button onClick={() => setIsRecipeModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Playbook Title</label>
                <input
                  type="text"
                  placeholder="e.g. Flush Redis & Reload Service"
                  value={newRecipe.title || ''}
                  onChange={e => setNewRecipe(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Category</label>
                  <select
                    value={newRecipe.category || 'custom'}
                    onChange={e => setNewRecipe(prev => ({ ...prev, category: e.target.value as RecipeCategory }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="custom">Custom</option>
                    <option value="system">System</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="security">Security</option>
                    <option value="docker">Docker</option>
                    <option value="web">Web Server</option>
                    <option value="cleanup">Cleanup</option>
                  </select>
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!newRecipe.isSudo}
                      onChange={e => setNewRecipe(prev => ({ ...prev, isSudo: e.target.checked }))}
                      className="w-4 h-4 rounded text-blue-600"
                    />
                    <span>Requires Sudo Privileges</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Short description of what this automation does..."
                  value={newRecipe.description || ''}
                  onChange={e => setNewRecipe(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Bash Command / Script</label>
                <textarea
                  rows={6}
                  placeholder="# Enter bash commands..."
                  value={newRecipe.command || ''}
                  onChange={e => setNewRecipe(prev => ({ ...prev, command: e.target.value }))}
                  className="w-full p-3 rounded-xl bg-black/60 border border-white/15 font-mono text-xs text-emerald-400 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsRecipeModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRecipe}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                Save Playbook
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 13. MODAL: REMOTE SERVER STORAGE (~/.sshdesktop/automation.json) */}
      {/* ======================================================== */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#181c2e]">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Remote Server Automation Storage</h3>
                  <p className="text-[11px] text-gray-400 font-mono">
                    {serverFilePath}
                  </p>
                </div>
              </div>
              <button onClick={() => setIsSyncModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-200 text-xs flex items-start space-x-3">
                <HardDrive className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  All custom recipes, execution audit logs, fleet matrix hierarchies, and replica sets are stored in your remote user profile at <code className="text-amber-300 font-mono text-[11px] bg-black/30 px-1.5 py-0.5 rounded">{serverFilePath}</code> for user <span className="font-semibold text-white">{username}</span>.
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">File Status</span>
                  <span className={`font-bold text-xs mt-1 block ${serverFileStatus?.exists ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {serverFileStatus?.exists ? 'Saved on Server' : 'Not Created Yet'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">File Size</span>
                  <span className="font-mono text-xs text-white mt-1 block">
                    {serverFileStatus?.size !== undefined ? `${(serverFileStatus.size / 1024).toFixed(1)} KB` : '—'}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Login User</span>
                  <span className="font-mono text-xs text-indigo-300 mt-1 block">
                    {username}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-black/40 border border-white/10">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Last Synced</span>
                  <span className="font-mono text-[11px] text-gray-300 mt-1 block">
                    {lastServerSyncTime || 'Just now'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-2">
                <button
                  onClick={() => handleSaveToServer(false)}
                  disabled={isSyncingServer}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <CloudUpload className={`w-4 h-4 ${isSyncingServer ? 'animate-bounce' : ''}`} />
                  <span>{isSyncingServer ? 'Saving to Server...' : 'Save Current State to Server'}</span>
                </button>

                <button
                  onClick={() => handleRestoreFromServer()}
                  disabled={isSyncingServer}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <CloudDownload className="w-4 h-4 text-emerald-400" />
                  <span>Restore State from Server</span>
                </button>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5">
                    <FileJson className="w-3.5 h-3.5 text-blue-400" />
                    <span>Raw JSON on Server ({serverFilePath})</span>
                  </span>
                  <button
                    onClick={() => handleCopy(serverFileStatus?.rawJson || '', 'raw-server-json')}
                    disabled={!serverFileStatus?.rawJson}
                    className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1 disabled:opacity-40 cursor-pointer"
                  >
                    {copiedKey === 'raw-server-json' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copy JSON</span>
                  </button>
                </div>
                <div className="h-44 p-3 rounded-xl bg-black/70 border border-white/10 font-mono text-[10px] text-emerald-300/90 overflow-y-auto select-text leading-relaxed">
                  <pre>{serverFileStatus?.rawJson || JSON.stringify({
                    user: username,
                    custom_recipes: recipes.filter(r => !r.isBuiltIn),
                    history_count: history.length,
                    organizations_count: fleetMatrix.organizations.length,
                    replicas_count: replicaSets.length,
                    path: serverFilePath,
                  }, null, 2)}</pre>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-between">
              <button
                onClick={() => handleCopy(serverFilePath, 'server-path')}
                className="text-xs text-gray-400 hover:text-white flex items-center space-x-1 cursor-pointer"
              >
                {copiedKey === 'server-path' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>Copy Path</span>
              </button>
              <button
                onClick={() => setIsSyncModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
