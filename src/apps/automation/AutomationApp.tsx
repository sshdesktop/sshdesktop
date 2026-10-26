import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Workflow, Play, Square, RefreshCw, CheckCircle2, AlertCircle, Clock,
  Server, Shield, Terminal, Globe, Container, Trash2, Copy, Check,
  Download, Plus, Search, Filter, Layers, Zap, Eye, ChevronDown, ChevronRight,
  Sliders, ArrowRight, Activity, AlertTriangle, X, HardDrive, Cpu, Package,
  Cloud, CloudUpload, CloudDownload, FileJson, Edit3, MoveRight, Network,
  ZoomIn, ZoomOut, WrapText, CheckSquare, Square as SquareIcon, FileText, KeyRound, Tag
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
  FleetServer,
  TargetServer,
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

  // Navigation Tabs: Runner, Recipes, Fleet Matrix, History (Replicas and Schedules removed)
  const [activeTab, setActiveTab] = useState<'runner' | 'recipes' | 'fleet-matrix' | 'history'>('runner');

  // Recipes, History, Fleet Matrix State
  const [recipes, setRecipes] = useState<AutomationRecipe[]>([]);
  const [history, setHistory] = useState<AutomationExecutionRun[]>([]);
  const [fleetMatrix, setFleetMatrix] = useState<FleetMatrixData>(() => getDefaultFleetMatrix([]));
  const [fleetHealth, setFleetHealth] = useState<Record<string, TargetHealth>>({});
  const [isProbingFleet, setIsProbingFleet] = useState(false);

  // Runner Configuration State
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [collapsedOrgs, setCollapsedOrgs] = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('fleet-telemetry');
  const [customCommand, setCustomCommand] = useState<string>('');
  const [isSudo, setIsSudo] = useState<boolean>(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('parallel');
  const [concurrency, setConcurrency] = useState<number>(5);
  const [stopOnError, setStopOnError] = useState<boolean>(true);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Monaco Editor State for Runner
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

  // Fleet Matrix Modals: Organization CRUD
  const [isOrgModalOpen, setIsOrgModalOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<FleetOrganization | null>(null);
  const [orgForm, setOrgForm] = useState({ name: '', description: '', color: '#6366f1' });

  // Fleet Matrix Modals: Group CRUD
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FleetGroup | null>(null);
  const [groupForm, setGroupForm] = useState({ organizationId: '', name: '', description: '', color: '#3b82f6' });

  // Fleet Matrix Modals: Server CRUD (Native Fleet Server Add/Edit/Delete)
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<FleetServer | null>(null);
  const [serverForm, setServerForm] = useState<{
    name: string;
    organizationId: string;
    groupId: string;
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKey?: string;
    authType: 'password' | 'privateKey' | 'agent';
    status: 'active' | 'inactive';
    tags: string;
    osType: string;
    notes: string;
  }>({
    name: '',
    organizationId: '',
    groupId: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
    privateKey: '',
    authType: 'password',
    status: 'active',
    tags: '',
    osType: 'Linux',
    notes: '',
  });

  // Import Saved Logins Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importOrgId, setImportOrgId] = useState('');
  const [importGroupId, setImportGroupId] = useState('');

  // Recipes Tab: Add / Edit Recipe Modal with Monaco Editor
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<AutomationRecipe | null>(null);
  const [recipeForm, setRecipeForm] = useState<{
    title: string;
    category: RecipeCategory;
    description: string;
    command: string;
    isSudo: boolean;
    stopOnError: boolean;
    timeoutSeconds: number;
  }>({
    title: '',
    category: 'custom',
    description: '',
    command: '',
    isSudo: false,
    stopOnError: false,
    timeoutSeconds: 60,
  });
  const [recipeEditorFontSize, setRecipeEditorFontSize] = useState<number>(13);
  const [recipeWordWrap, setRecipeWordWrap] = useState<boolean>(true);
  const [recipeSearchQuery, setRecipeSearchQuery] = useState('');
  const [selectedRecipeCategory, setSelectedRecipeCategory] = useState<string>('all');

  // Status Notification
  const [bannerNotice, setBannerNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  // Load recipes, history, and fleet matrix on mount
  useEffect(() => {
    setRecipes(loadStoredRecipes());
    setHistory(loadStoredHistory());
    setFleetMatrix(loadStoredFleetMatrix(connections));
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
  }, [activeConnectionId, homeDir, username, recipes, history, fleetMatrix, selectedServerIds]);

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

  // All managed servers in Fleet Matrix
  const allFleetServers: FleetServer[] = useMemo(() => {
    return fleetMatrix.servers || [];
  }, [fleetMatrix.servers]);

  // Auto-select active servers initially if none selected
  useEffect(() => {
    if (allFleetServers.length > 0 && selectedServerIds.length === 0) {
      const activeIds = allFleetServers.filter(s => s.status === 'active').map(s => s.id);
      setSelectedServerIds(activeIds.length > 0 ? activeIds : allFleetServers.map(s => s.id));
    }
  }, [allFleetServers]);

  // Initial Probe on Mount to establish health/telemetry
  useEffect(() => {
    if (allFleetServers.length > 0 && Object.keys(fleetHealth).length === 0) {
      probeFleetTelemetry(allFleetServers, (health) => {
        setFleetHealth(prev => ({ ...prev, [health.serverId]: health }));
      });
    }
  }, [allFleetServers]);

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

  // Keyboard shortcut listener for Monaco Zoom In / Out and Word Wrap
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Zoom in: Ctrl + + or Ctrl + =
      if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        setEditorFontSize(f => Math.min(f + 1, 32));
      }
      // Zoom out: Ctrl + -
      else if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        setEditorFontSize(f => Math.max(f - 1, 9));
      }
      // Word wrap toggle: Alt + Z
      else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsWordWrap(w => !w);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered servers by search query and active/inactive status filter
  const filteredServers = useMemo(() => {
    return allFleetServers.filter(s => {
      const q = serverSearchQuery.toLowerCase();
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q) ||
        (s.tags && s.tags.some(t => t.toLowerCase().includes(q)));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && s.status === 'active') ||
        (statusFilter === 'inactive' && s.status === 'inactive');

      return matchesSearch && matchesStatus;
    });
  }, [allFleetServers, serverSearchQuery, statusFilter]);

  // Selected Target Servers for Execution (TargetServer[])
  const targetServers: FleetServer[] = useMemo(() => {
    return allFleetServers.filter(s => selectedServerIds.includes(s.id));
  }, [allFleetServers, selectedServerIds]);

  // Copy helper
  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Toggle selection of a single server
  const toggleServer = (id: string) => {
    setSelectedServerIds(prev =>
      prev.includes(id) ? prev.filter(sId => sId !== id) : [...prev, id]
    );
  };

  // Toggle selection of all servers in a group
  const toggleGroupServers = (groupId: string) => {
    const groupServers = allFleetServers.filter(s => s.groupId === groupId);
    const groupServerIds = groupServers.map(s => s.id);
    const allSelected = groupServerIds.every(id => selectedServerIds.includes(id));

    if (allSelected) {
      setSelectedServerIds(prev => prev.filter(id => !groupServerIds.includes(id)));
    } else {
      setSelectedServerIds(prev => Array.from(new Set([...prev, ...groupServerIds])));
    }
  };

  // Toggle selection of all servers in an organization
  const toggleOrgServers = (orgId: string) => {
    const orgServers = allFleetServers.filter(s => s.organizationId === orgId);
    const orgServerIds = orgServers.map(s => s.id);
    const allSelected = orgServerIds.length > 0 && orgServerIds.every(id => selectedServerIds.includes(id));

    if (allSelected) {
      setSelectedServerIds(prev => prev.filter(id => !orgServerIds.includes(id)));
    } else {
      setSelectedServerIds(prev => Array.from(new Set([...prev, ...orgServerIds])));
    }
  };

  // Quick selection helpers
  const selectAllTargets = () => {
    setSelectedServerIds(filteredServers.map(s => s.id));
  };

  const selectActiveTargets = () => {
    setSelectedServerIds(filteredServers.filter(s => s.status === 'active').map(s => s.id));
  };

  const deselectAllTargets = () => {
    setSelectedServerIds([]);
  };

  // Manual Trigger to Refresh / Probe Fleet Health Matrix
  const handleProbeFleet = async () => {
    if (allFleetServers.length === 0) {
      setBannerNotice({ text: 'No servers available in Fleet Matrix to probe.', isError: true });
      return;
    }
    setIsProbingFleet(true);
    setBannerNotice({ text: `Probing active status and metrics across ${allFleetServers.length} fleet servers...` });
    try {
      await probeFleetTelemetry(allFleetServers, (health) => {
        setFleetHealth(prev => ({ ...prev, [health.serverId]: health }));
      });
      setBannerNotice({ text: 'Fleet health probe complete. Active statuses updated.', isError: false });
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

  // Execute Automation Run across Selected Fleet
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

    // Initial clean map for all target servers
    // Inactive servers are immediately marked as skipped/failed with explicit explanation,
    // ensuring no stale output from any previous server can ever appear!
    const initialMap: Record<string, ServerExecutionResult> = {};
    targetServers.forEach(s => {
      const isDeactivated = s.status === 'inactive';
      initialMap[s.id] = {
        serverId: s.id,
        serverName: s.name || s.host,
        host: s.host,
        port: s.port,
        username: s.username,
        status: isDeactivated ? 'failed' : 'pending',
        stdout: '',
        stderr: isDeactivated
          ? `[DEACTIVATED] Server "${s.name || s.host}" (${s.host}:${s.port}) is marked Inactive in Fleet Matrix. Execution skipped.`
          : '',
        exitCode: isDeactivated ? 1 : 0,
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

      // Merge with initial map to ensure all servers are represented
      finalResults = { ...initialMap, ...finalResults };

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
    setSelectedServerIds(targetIds.filter(id => allFleetServers.some(s => s.id === id)));
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

  // Recipe CRUD: Save (Add or Edit)
  const handleSaveRecipe = () => {
    if (!recipeForm.title.trim() || !recipeForm.command.trim()) {
      setBannerNotice({ text: 'Recipe title and bash command are required.', isError: true });
      return;
    }

    if (editingRecipe) {
      // Update existing custom recipe
      const updated: AutomationRecipe = {
        ...editingRecipe,
        title: recipeForm.title.trim(),
        category: recipeForm.category,
        description: recipeForm.description.trim() || 'Custom fleet automation recipe',
        command: recipeForm.command,
        isSudo: !!recipeForm.isSudo,
        stopOnError: !!recipeForm.stopOnError,
        timeoutSeconds: Number(recipeForm.timeoutSeconds) || 60,
      };
      const updatedList = saveCustomRecipe(updated);
      setRecipes(updatedList);
      setIsRecipeModalOpen(false);
      setEditingRecipe(null);
      setBannerNotice({ text: `Custom recipe "${updated.title}" updated successfully.` });

      if (activeConnectionId && homeDir) {
        saveAutomationToServer(activeConnectionId, homeDir, {
          username,
          customRecipes: updatedList.filter(r => !r.isBuiltIn),
          history,
          fleetMatrix,
          lastTargetServerIds: selectedServerIds,
        }).catch(() => {});
      }
    } else {
      // Create new recipe
      const created: AutomationRecipe = {
        id: `recipe-custom-${Date.now()}`,
        title: recipeForm.title.trim(),
        description: recipeForm.description.trim() || 'Custom fleet automation recipe',
        category: recipeForm.category,
        icon: 'Workflow',
        command: recipeForm.command,
        isSudo: !!recipeForm.isSudo,
        stopOnError: !!recipeForm.stopOnError,
        timeoutSeconds: Number(recipeForm.timeoutSeconds) || 60,
        isBuiltIn: false,
        createdAt: Date.now(),
      };
      const updatedList = saveCustomRecipe(created);
      setRecipes(updatedList);
      setIsRecipeModalOpen(false);
      setSelectedRecipeId(created.id);
      setBannerNotice({ text: `Custom recipe "${created.title}" saved successfully.` });

      if (activeConnectionId && homeDir) {
        saveAutomationToServer(activeConnectionId, homeDir, {
          username,
          customRecipes: updatedList.filter(r => !r.isBuiltIn),
          history,
          fleetMatrix,
          lastTargetServerIds: selectedServerIds,
        }).catch(() => {});
      }
    }
  };

  // Recipe CRUD: Open Edit Modal
  const handleOpenEditRecipe = (recipe: AutomationRecipe) => {
    setEditingRecipe(recipe);
    setRecipeForm({
      title: recipe.title,
      category: recipe.category,
      description: recipe.description || '',
      command: recipe.command,
      isSudo: !!recipe.isSudo,
      stopOnError: !!recipe.stopOnError,
      timeoutSeconds: recipe.timeoutSeconds || 60,
    });
    setIsRecipeModalOpen(true);
  };

  // Recipe CRUD: Delete Recipe
  const handleDeleteRecipe = (id: string) => {
    const target = recipes.find(r => r.id === id);
    if (!confirm(`Are you sure you want to delete recipe "${target?.title || id}"?`)) return;

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
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteOrg = (orgId: string) => {
    const org = fleetMatrix.organizations.find(o => o.id === orgId);
    if (!confirm(`Are you sure you want to delete Organization "${org?.name || orgId}" and its hierarchy?`)) return;

    const nextOrgs = fleetMatrix.organizations.filter(o => o.id !== orgId);
    const nextGroups = fleetMatrix.groups.filter(g => g.organizationId !== orgId);
    const nextServers = (fleetMatrix.servers || []).filter(s => s.organizationId !== orgId);
    const updatedMatrix = { ...fleetMatrix, organizations: nextOrgs, groups: nextGroups, servers: nextServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
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
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteGroup = (groupId: string) => {
    const grp = fleetMatrix.groups.find(g => g.id === groupId);
    if (!confirm(`Are you sure you want to delete Group "${grp?.name || groupId}" and its servers?`)) return;

    const nextGroups = fleetMatrix.groups.filter(g => g.id !== groupId);
    const nextServers = (fleetMatrix.servers || []).filter(s => s.groupId !== groupId);
    const updatedMatrix = { ...fleetMatrix, groups: nextGroups, servers: nextServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Fleet Matrix: Native Server CRUD (Add / Edit / Delete)
  const handleOpenAddServer = (defaultOrgId?: string, defaultGroupId?: string) => {
    setEditingServer(null);
    setServerForm({
      name: '',
      organizationId: defaultOrgId || fleetMatrix.organizations[0]?.id || '',
      groupId: defaultGroupId || fleetMatrix.groups[0]?.id || '',
      host: '',
      port: 22,
      username: 'root',
      password: '',
      privateKey: '',
      authType: 'password',
      status: 'active',
      tags: '',
      osType: 'Linux',
      notes: '',
    });
    setIsServerModalOpen(true);
  };

  const handleOpenEditServer = (server: FleetServer) => {
    setEditingServer(server);
    setServerForm({
      name: server.name,
      organizationId: server.organizationId,
      groupId: server.groupId,
      host: server.host,
      port: server.port || 22,
      username: server.username,
      password: server.password || '',
      privateKey: server.privateKey || '',
      authType: server.authType || 'password',
      status: server.status || 'active',
      tags: (server.tags || []).join(', '),
      osType: server.osType || 'Linux',
      notes: server.notes || '',
    });
    setIsServerModalOpen(true);
  };

  const handleSaveServer = () => {
    if (!serverForm.host.trim() || !serverForm.username.trim()) {
      setBannerNotice({ text: 'Host and Username are required.', isError: true });
      return;
    }
    if (!serverForm.organizationId || !serverForm.groupId) {
      setBannerNotice({ text: 'Please select an Organization and Group for this server.', isError: true });
      return;
    }

    const tagsArray = serverForm.tags.split(',').map(t => t.trim()).filter(Boolean);

    let nextServers = [...(fleetMatrix.servers || [])];
    if (editingServer) {
      nextServers = nextServers.map(s => {
        if (s.id === editingServer.id) {
          return {
            ...s,
            name: serverForm.name.trim() || `${serverForm.username}@${serverForm.host}`,
            organizationId: serverForm.organizationId,
            groupId: serverForm.groupId,
            host: serverForm.host.trim(),
            port: Number(serverForm.port) || 22,
            username: serverForm.username.trim(),
            password: serverForm.password || undefined,
            privateKey: serverForm.privateKey || undefined,
            authType: serverForm.authType,
            status: serverForm.status,
            tags: tagsArray,
            osType: serverForm.osType,
            notes: serverForm.notes,
            updatedAt: Date.now(),
          };
        }
        return s;
      });
      setBannerNotice({ text: `Server "${serverForm.name || serverForm.host}" updated.` });
    } else {
      const newServer: FleetServer = {
        id: `srv-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: serverForm.name.trim() || `${serverForm.username}@${serverForm.host}`,
        organizationId: serverForm.organizationId,
        groupId: serverForm.groupId,
        host: serverForm.host.trim(),
        port: Number(serverForm.port) || 22,
        username: serverForm.username.trim(),
        password: serverForm.password || undefined,
        privateKey: serverForm.privateKey || undefined,
        authType: serverForm.authType,
        status: serverForm.status,
        tags: tagsArray,
        osType: serverForm.osType,
        notes: serverForm.notes,
        createdAt: Date.now(),
      };
      nextServers.push(newServer);
      setBannerNotice({ text: `Server "${newServer.name}" added to Fleet Matrix.` });
    }

    const updatedMatrix = { ...fleetMatrix, servers: nextServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setIsServerModalOpen(false);
    setEditingServer(null);

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleDeleteServer = (serverId: string) => {
    const srv = (fleetMatrix.servers || []).find(s => s.id === serverId);
    if (!confirm(`Are you sure you want to delete server "${srv?.name || serverId}" from Fleet Matrix?`)) return;

    const nextServers = (fleetMatrix.servers || []).filter(s => s.id !== serverId);
    const updatedMatrix = { ...fleetMatrix, servers: nextServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setSelectedServerIds(prev => prev.filter(id => id !== serverId));
    setBannerNotice({ text: `Server deleted from Fleet Matrix.` });

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  const handleToggleServerStatus = (serverId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const nextServers = (fleetMatrix.servers || []).map(s => {
      if (s.id === serverId) {
        const nextStatus: 'active' | 'inactive' = s.status === 'active' ? 'inactive' : 'active';
        return { ...s, status: nextStatus, updatedAt: Date.now() };
      }
      return s;
    });
    const updatedMatrix = { ...fleetMatrix, servers: nextServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
        lastTargetServerIds: selectedServerIds,
      }).catch(() => {});
    }
  };

  // Import Saved Connections from Login Screen into Fleet Matrix
  const handleImportSavedConnections = () => {
    if (!importOrgId || !importGroupId) {
      setBannerNotice({ text: 'Please select an Organization and Group for imported servers.', isError: true });
      return;
    }

    const existingKeys = new Set((fleetMatrix.servers || []).map(s => `${s.username}@${s.host}:${s.port}`));
    const toImport: FleetServer[] = [];

    connections.forEach(c => {
      const port = Number(c.port) || 22;
      const key = `${c.username}@${c.host}:${port}`;
      if (!existingKeys.has(key)) {
        toImport.push({
          id: c.id,
          organizationId: importOrgId,
          groupId: importGroupId,
          name: c.name || `${c.username}@${c.host}`,
          host: c.host,
          port,
          username: c.username,
          password: c.password,
          authType: (c as any).authMethod === 'key' ? 'privateKey' : 'password',
          tags: c.tags || [],
          status: 'active',
          createdAt: Date.now(),
        });
      }
    });

    if (toImport.length === 0) {
      setBannerNotice({ text: 'All saved login connections have already been imported into Fleet Matrix.', isError: false });
      setIsImportModalOpen(false);
      return;
    }

    const updatedServers = [...(fleetMatrix.servers || []), ...toImport];
    const updatedMatrix = { ...fleetMatrix, servers: updatedServers };
    setFleetMatrix(updatedMatrix);
    saveStoredFleetMatrix(updatedMatrix);
    setIsImportModalOpen(false);
    setBannerNotice({ text: `Successfully imported ${toImport.length} saved servers into Fleet Matrix!`, isError: false });

    if (activeConnectionId && homeDir) {
      saveAutomationToServer(activeConnectionId, homeDir, {
        username,
        customRecipes: recipes.filter(r => !r.isBuiltIn),
        history,
        fleetMatrix: updatedMatrix,
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
              Orchestrator for {allFleetServers.length} nodes • Monaco VS Code Integration • Hierarchy &amp; Playbooks
            </p>
          </div>
        </div>

        {/* Tab Switcher Pills */}
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
            <span>Fleet Matrix ({allFleetServers.length})</span>
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
      {/* 2. TAB 1: RUNNER (PRIMARY ORCHESTRATION WORKSPACE)        */}
      {/* ======================================================== */}
      {activeTab === 'runner' && (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT COLUMN: HIERARCHY TARGET SELECTOR (ORGANIZATION > GROUP > SERVER) */}
          <aside className="w-80 border-r border-white/10 bg-[#111320] flex flex-col shrink-0">
            {/* Target Header with Dedicated Refresh & Quick Select */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white tracking-wide uppercase">Target Fleet</span>
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 font-mono">
                  {selectedServerIds.length}/{allFleetServers.length}
                </span>
              </div>
              <div className="flex items-center space-x-1">
                <button
                  onClick={handleProbeFleet}
                  disabled={isProbingFleet}
                  className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                  title="Refresh / Check Active Status on All Servers"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isProbingFleet ? 'animate-spin text-blue-400' : ''}`} />
                </button>
                <button
                  onClick={selectAllTargets}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[11px] cursor-pointer"
                  title="Select All Servers"
                >
                  All
                </button>
                <button
                  onClick={selectActiveTargets}
                  className="px-1.5 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[11px] cursor-pointer"
                  title="Select Only Active Servers"
                >
                  Active
                </button>
                <button
                  onClick={deselectAllTargets}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-[11px] cursor-pointer"
                  title="Deselect All"
                >
                  None
                </button>
              </div>
            </div>

            {/* Target Status Filter Pills */}
            <div className="px-3 pt-2 pb-1 flex items-center space-x-1">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  statusFilter === 'all' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                All ({allFleetServers.length})
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center space-x-1 ${
                  statusFilter === 'active' ? 'bg-emerald-600 text-white' : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span>Active ({allFleetServers.filter(s => s.status === 'active').length})</span>
              </button>
              <button
                onClick={() => setStatusFilter('inactive')}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center space-x-1 ${
                  statusFilter === 'inactive' ? 'bg-red-600 text-white' : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                <span>Inactive ({allFleetServers.filter(s => s.status === 'inactive').length})</span>
              </button>
            </div>

            {/* Target Search */}
            <div className="p-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Filter targets by name, host, tags..."
                  value={serverSearchQuery}
                  onChange={e => setServerSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* HIERARCHICAL TREE VIEW: ORGANIZATION > GROUP > SERVER */}
            <div className="flex-1 overflow-y-auto px-2 space-y-2">
              {allFleetServers.length === 0 ? (
                <div className="py-8 px-4 text-center space-y-3">
                  <div className="text-xs text-gray-400">No servers defined in Fleet Matrix yet.</div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleOpenAddServer()}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center space-x-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Server</span>
                    </button>
                    {connections.length > 0 && (
                      <button
                        onClick={() => {
                          setImportOrgId(fleetMatrix.organizations[0]?.id || '');
                          setImportGroupId(fleetMatrix.groups[0]?.id || '');
                          setIsImportModalOpen(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-200 text-xs font-semibold flex items-center justify-center space-x-1 cursor-pointer"
                      >
                        <MoveRight className="w-3.5 h-3.5" />
                        <span>Import from Saved Logins ({connections.length})</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                fleetMatrix.organizations.map(org => {
                  const orgServers = filteredServers.filter(s => s.organizationId === org.id);
                  if (serverSearchQuery && orgServers.length === 0) return null;

                  const isOrgCollapsed = !!collapsedOrgs[org.id];
                  const allOrgServers = allFleetServers.filter(s => s.organizationId === org.id);
                  const isAllOrgSelected = allOrgServers.length > 0 && allOrgServers.every(s => selectedServerIds.includes(s.id));
                  const isSomeOrgSelected = allOrgServers.some(s => selectedServerIds.includes(s.id)) && !isAllOrgSelected;
                  const orgGroups = fleetMatrix.groups.filter(g => g.organizationId === org.id);

                  return (
                    <div key={org.id} className="rounded-xl border border-white/5 bg-black/20 overflow-hidden">
                      {/* Organization Row */}
                      <div className="p-2 flex items-center justify-between bg-white/[0.03] hover:bg-white/[0.06] transition-colors">
                        <div className="flex items-center space-x-2 min-w-0">
                          <button
                            onClick={() => setCollapsedOrgs(prev => ({ ...prev, [org.id]: !prev[org.id] }))}
                            className="text-gray-400 hover:text-white p-0.5 cursor-pointer"
                          >
                            {isOrgCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <input
                            type="checkbox"
                            checked={isAllOrgSelected}
                            ref={el => { if (el) el.indeterminate = isSomeOrgSelected; }}
                            onChange={() => toggleOrgServers(org.id)}
                            className="w-3.5 h-3.5 rounded text-blue-600 cursor-pointer"
                            title="Toggle all servers in this organization"
                          />
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: org.color || '#6366f1' }}
                          />
                          <span className="text-xs font-bold text-white truncate">{org.name}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono shrink-0">
                          {allOrgServers.filter(s => s.status === 'active').length}/{allOrgServers.length} Active
                        </span>
                      </div>

                      {/* Nested Groups inside Org */}
                      {!isOrgCollapsed && (
                        <div className="p-1 space-y-1">
                          {orgGroups.map(grp => {
                            const groupServers = filteredServers.filter(s => s.groupId === grp.id);
                            if (serverSearchQuery && groupServers.length === 0) return null;

                            const isGroupCollapsed = !!collapsedGroups[grp.id];
                            const allGroupServers = allFleetServers.filter(s => s.groupId === grp.id);
                            const isAllGroupSelected = allGroupServers.length > 0 && allGroupServers.every(s => selectedServerIds.includes(s.id));
                            const isSomeGroupSelected = allGroupServers.some(s => selectedServerIds.includes(s.id)) && !isAllGroupSelected;

                            return (
                              <div key={grp.id} className="ml-2 pl-2 border-l border-white/10 rounded-lg">
                                {/* Group Row */}
                                <div className="p-1.5 flex items-center justify-between rounded hover:bg-white/[0.04] transition-colors">
                                  <div className="flex items-center space-x-2 min-w-0">
                                    <button
                                      onClick={() => setCollapsedGroups(prev => ({ ...prev, [grp.id]: !prev[grp.id] }))}
                                      className="text-gray-400 hover:text-white p-0.5 cursor-pointer"
                                    >
                                      {isGroupCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                    </button>
                                    <input
                                      type="checkbox"
                                      checked={isAllGroupSelected}
                                      ref={el => { if (el) el.indeterminate = isSomeGroupSelected; }}
                                      onChange={() => toggleGroupServers(grp.id)}
                                      className="w-3.5 h-3.5 rounded text-blue-600 cursor-pointer"
                                      title="Toggle all servers in this group"
                                    />
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: grp.color || '#3b82f6' }}
                                    />
                                    <span className="text-xs font-semibold text-gray-300 truncate">{grp.name}</span>
                                  </div>
                                  <span className="text-[10px] text-gray-500 font-mono shrink-0">
                                    ({allGroupServers.length})
                                  </span>
                                </div>

                                {/* Nested Servers inside Group */}
                                {!isGroupCollapsed && (
                                  <div className="ml-3 pl-2 border-l border-white/5 space-y-1 mt-1 pb-1">
                                    {groupServers.length === 0 ? (
                                      <div className="text-[10px] text-gray-500 italic py-1">No matching servers</div>
                                    ) : (
                                      groupServers.map(server => {
                                        const isSelected = selectedServerIds.includes(server.id);
                                        const health = fleetHealth[server.id];
                                        const execRes = executionResults[server.id];
                                        const isActive = server.status === 'active';

                                        return (
                                          <div
                                            key={server.id}
                                            onClick={() => toggleServer(server.id)}
                                            className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between ${
                                              isSelected
                                                ? isActive
                                                  ? 'bg-emerald-950/25 border-emerald-500/40 text-white'
                                                  : 'bg-red-950/25 border-red-500/40 text-white'
                                                : 'bg-white/[0.02] border-white/5 text-gray-400 hover:bg-white/[0.05]'
                                            }`}
                                          >
                                            <div className="flex items-center space-x-2 min-w-0">
                                              <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => {}}
                                                className="w-3.5 h-3.5 rounded text-blue-600 pointer-events-none"
                                              />
                                              <div className="min-w-0">
                                                <div className="flex items-center space-x-1.5">
                                                  <span className="text-xs font-semibold truncate text-gray-200">
                                                    {server.name}
                                                  </span>
                                                </div>
                                                <div className="text-[10px] text-gray-500 truncate font-mono">
                                                  {server.username}@{server.host}:{server.port}
                                                </div>
                                              </div>
                                            </div>

                                            {/* Bright Green Active / Bright Red Inactive status badge */}
                                            <div className="shrink-0 flex items-center space-x-1.5">
                                              {execRes && execRes.status === 'running' ? (
                                                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                                              ) : isActive ? (
                                                <span
                                                  className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                                                  title={`Active node${health?.latencyMs ? ` (${health.latencyMs}ms)` : ''}`}
                                                >
                                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                  <span>Active</span>
                                                </span>
                                              ) : (
                                                <span
                                                  className="flex items-center space-x-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500/20 text-red-300 border border-red-500/40 shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                                                  title="Deactivated in Fleet Matrix. Execution will be skipped."
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
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Target Fleet Stats Footer */}
            <div className="p-3 border-t border-white/10 bg-black/30 text-[11px] text-gray-400 flex items-center justify-between">
              <span>Selected for Execution:</span>
              <div className="flex items-center space-x-1.5 font-mono">
                <span className="font-bold text-white">{selectedServerIds.length} Nodes</span>
                <span className="text-[10px] text-emerald-400">
                  ({targetServers.filter(s => s.status === 'active').length} active)
                </span>
              </div>
            </div>
          </aside>

          {/* RIGHT COLUMN: TASK DEFINITION WITH MONACO VS CODE EDITOR & RESULTS */}
          <main className="flex-1 flex flex-col min-w-0 bg-[#0e101b] overflow-hidden">
            {/* Task Configuration Toolbar */}
            <div className="p-4 border-b border-white/10 bg-[#141624] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Playbook Picker */}
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
                    <div className="flex items-center space-x-1.5 text-xs text-gray-300 pl-2 border-l border-white/10">
                      <span>Pool:</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={concurrency}
                        onChange={e => setConcurrency(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                        className="w-12 px-1.5 py-0.5 rounded bg-black/60 border border-white/20 text-center font-mono text-white text-xs focus:outline-none"
                      />
                    </div>
                  ) : (
                    <label className="flex items-center space-x-1.5 text-xs text-gray-300 pl-2 border-l border-white/10 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={stopOnError}
                        onChange={e => setStopOnError(e.target.checked)}
                        className="w-3.5 h-3.5 rounded text-blue-600"
                      />
                      <span>Stop on Error</span>
                    </label>
                  )}

                  <label className="flex items-center space-x-1.5 text-xs text-red-300 pl-2 border-l border-white/10 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSudo}
                      onChange={e => setIsSudo(e.target.checked)}
                      className="w-3.5 h-3.5 rounded text-red-600"
                    />
                    <Shield className="w-3.5 h-3.5 text-red-400" />
                    <span>Sudo</span>
                  </label>
                </div>

                {/* Primary Action Button */}
                <div className="flex items-center space-x-2">
                  {isRunning ? (
                    <button
                      onClick={handleCancelExecution}
                      className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-bold shadow-lg shadow-red-500/25 flex items-center space-x-2 cursor-pointer"
                    >
                      <Square className="w-4 h-4 fill-current" />
                      <span>Cancel Fleet Run</span>
                    </button>
                  ) : (
                    <button
                      onClick={handleRunAutomation}
                      disabled={selectedServerIds.length === 0 || !customCommand.trim()}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/30 flex items-center space-x-2 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" />
                      <span>Execute on Fleet ({targetServers.length} Servers)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Inactive servers warning pill if any inactive servers are in selection */}
              {targetServers.some(s => s.status === 'inactive') && (
                <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-[11px] flex items-center space-x-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Note: {targetServers.filter(s => s.status === 'inactive').length} selected server(s) are deactivated in Fleet Matrix and will be cleanly marked skipped without executing commands.
                  </span>
                </div>
              )}
            </div>

            {/* MONACO VS CODE SCRIPT EDITOR TOOLBAR */}
            <div className="px-4 py-2 border-b border-white/10 bg-[#0f111d] flex items-center justify-between text-xs">
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
                    Select target servers from the left hierarchy panel to execute commands across your fleet.
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
                    const isDeactive = server.status === 'inactive';

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
                            : 'bg-[#131522] border-white/10'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between pb-2 border-b border-white/5">
                            <div className="flex items-center space-x-2 min-w-0">
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${
                                  isRunningCard
                                    ? 'bg-blue-400 animate-pulse'
                                    : isSuccess
                                    ? 'bg-emerald-400'
                                    : isFailed
                                    ? 'bg-red-400'
                                    : 'bg-gray-500'
                                }`}
                              />
                              <div className="min-w-0">
                                <span className="font-bold text-xs text-white truncate block">
                                  {server.name}
                                </span>
                                <span className="text-[10px] text-gray-500 font-mono truncate block">
                                  {server.username}@{server.host}:{server.port}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center space-x-1.5 shrink-0">
                              {isDeactive && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-red-500/20 text-red-300 border border-red-500/30">
                                  DEACTIVATED
                                </span>
                              )}
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                  isRunningCard
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : isSuccess
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : isFailed
                                    ? 'bg-red-500/20 text-red-300'
                                    : 'bg-white/10 text-gray-400'
                                }`}
                              >
                                {res.status}
                              </span>
                            </div>
                          </div>

                          {/* Output preview terminal */}
                          <div className="mt-2.5 p-2 rounded-xl bg-black/60 border border-white/5 font-mono text-[10px] text-gray-300 h-24 overflow-y-auto select-text leading-relaxed">
                            {isRunningCard ? (
                              <div className="flex items-center space-x-2 text-blue-400">
                                <RefreshCw className="w-3 h-3 animate-spin" />
                                <span>Executing script on node...</span>
                              </div>
                            ) : res.stdout || res.stderr ? (
                              <>
                                {res.stdout && <div className="text-emerald-400/90 whitespace-pre-wrap">{res.stdout}</div>}
                                {res.stderr && <div className="text-red-400 whitespace-pre-wrap mt-1">{res.stderr}</div>}
                              </>
                            ) : (
                              <span className="text-gray-600 italic">No output recorded.</span>
                            )}
                          </div>
                        </div>

                        {/* Footer with runtime, single download, and view drawer button */}
                        <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[11px] text-gray-400">
                          <span className="font-mono">
                            {(res.durationMs / 1000).toFixed(2)}s
                            {res.exitCode !== undefined && ` • exit ${res.exitCode}`}
                          </span>

                          <div className="flex items-center space-x-1">
                            <button
                              onClick={() => handleDownloadSingleLog(res, selectedRecipeId)}
                              className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                              title="Download execution log for this server"
                            >
                              <Download className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => setInspectResult(res)}
                              className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-all cursor-pointer"
                              title="Inspect full output in drawer"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* UNIFIED LOG STREAM VIEW */
                <div className="rounded-2xl border border-white/10 bg-[#090b14] p-4 font-mono text-xs overflow-y-auto space-y-4">
                  {targetServers.map(server => {
                    const res = executionResults[server.id];
                    if (!res) return null;

                    return (
                      <div key={server.id} className="space-y-1">
                        <div className="text-blue-400 font-bold border-b border-white/10 pb-1 flex items-center justify-between">
                          <span>
                            &gt;&gt;&gt; NODE: {server.name} ({server.username}@{server.host}:{server.port}) — STATUS: {res.status.toUpperCase()}
                          </span>
                          <span className="text-gray-500 font-normal text-[10px]">
                            exit code: {res.exitCode} • {(res.durationMs / 1000).toFixed(2)}s
                          </span>
                        </div>
                        {res.stdout && <pre className="text-emerald-400 whitespace-pre-wrap pl-3">{res.stdout}</pre>}
                        {res.stderr && <pre className="text-red-400 whitespace-pre-wrap pl-3">{res.stderr}</pre>}
                        {!res.stdout && !res.stderr && (
                          <div className="text-gray-600 pl-3 italic">(No standard output or error stream)</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. TAB 2: RECIPE PLAYBOOKS (WITH ADD / EDIT / DELETE)    */}
      {/* ======================================================== */}
      {activeTab === 'recipes' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Automation Recipes &amp; Playbooks</h2>
                <p className="text-xs text-gray-400">
                  Curated operational workflows and customizable multi-server scripts with full VS Code Monaco editor
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingRecipe(null);
                  setRecipeForm({
                    title: '',
                    category: 'custom',
                    description: '',
                    command: '#!/usr/bin/env bash\n# Enter bash commands to run across your fleet...\n',
                    isSudo: false,
                    stopOnError: false,
                    timeoutSeconds: 60,
                  });
                  setIsRecipeModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center space-x-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Create Custom Recipe</span>
              </button>
            </div>

            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-[#141726] border border-white/10">
              <div className="flex items-center space-x-1 overflow-x-auto">
                {['all', 'system', 'maintenance', 'security', 'docker', 'web', 'cleanup', 'custom'].map(cat => (
                  <button
                    key={cat}
                    onClick={() => setSelectedRecipeCategory(cat)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-all cursor-pointer ${
                      selectedRecipeCategory === cat
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="relative w-64">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search recipes..."
                  value={recipeSearchQuery}
                  onChange={e => setRecipeSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Recipes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {recipes
                .filter(r => {
                  const matchesCat = selectedRecipeCategory === 'all' || r.category === selectedRecipeCategory;
                  const q = recipeSearchQuery.toLowerCase();
                  const matchesSearch = !q || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.command.toLowerCase().includes(q);
                  return matchesCat && matchesSearch;
                })
                .map(recipe => (
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

                        <div className="flex items-center space-x-1.5">
                          {recipe.isSudo && (
                            <span className="flex items-center space-x-1 text-[10px] text-red-400 font-semibold">
                              <Shield className="w-3 h-3" />
                              <span>Sudo</span>
                            </span>
                          )}
                          {recipe.isBuiltIn ? (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-white/10 text-gray-400 font-mono">
                              Built-In
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-indigo-500/20 text-indigo-300 font-mono">
                              Custom
                            </span>
                          )}
                        </div>
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
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => handleOpenEditRecipe(recipe)}
                          className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
                          title="Edit recipe"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {!recipe.isBuiltIn && (
                          <button
                            onClick={() => handleDeleteRecipe(recipe.id)}
                            className="text-gray-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/5 transition-all cursor-pointer"
                            title="Delete custom recipe"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

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
                  Manage infrastructure hierarchy: Organization &gt; Group &gt; Server. Directly add, edit, and delete servers inside this application.
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
                  onClick={() => handleOpenAddServer()}
                  className="px-3 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 hover:text-white border border-emerald-500/30 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Server</span>
                </button>

                {connections.length > 0 && (
                  <button
                    onClick={() => {
                      setImportOrgId(fleetMatrix.organizations[0]?.id || '');
                      setImportGroupId(fleetMatrix.groups[0]?.id || '');
                      setIsImportModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-300 hover:text-white border border-cyan-500/30 text-xs font-semibold flex items-center space-x-1.5 cursor-pointer"
                    title="Import saved server logins from desktop into fleet matrix"
                  >
                    <MoveRight className="w-4 h-4" />
                    <span>Import Logins ({connections.length})</span>
                  </button>
                )}

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
                            setEditingGroup(null);
                            setGroupForm({ organizationId: org.id, name: '', description: '', color: '#3b82f6' });
                            setIsGroupModalOpen(true);
                          }}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 hover:text-white transition-all flex items-center space-x-1 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                          <span>Add Group</span>
                        </button>
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
                          // Find all servers belonging to this group
                          const groupServers = (fleetMatrix.servers || []).filter(
                            s => s.groupId === grp.id
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
                                      {groupServers.length} Servers
                                    </span>
                                  </div>

                                  <div className="flex items-center space-x-1">
                                    <button
                                      onClick={() => handleOpenAddServer(org.id, grp.id)}
                                      className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[10px] font-semibold flex items-center space-x-1 cursor-pointer"
                                      title="Add new server directly into this group"
                                    >
                                      <Plus className="w-3 h-3" />
                                      <span>Add Server</span>
                                    </button>
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

                              {/* Native Fleet Server Cards List inside this group */}
                              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                                {groupServers.length === 0 ? (
                                  <div className="text-[11px] text-gray-500 italic py-3 text-center border border-dashed border-white/5 rounded-xl">
                                    No servers created in this group. Click &quot;Add Server&quot; above to add one.
                                  </div>
                                ) : (
                                  groupServers.map(s => {
                                    const health = fleetHealth[s.id];
                                    const isActive = s.status === 'active';

                                    return (
                                      <div
                                        key={s.id}
                                        className="p-2.5 rounded-xl bg-black/40 border border-white/5 flex items-center justify-between text-xs hover:border-white/15 transition-all"
                                      >
                                        <div className="flex items-center space-x-2.5 min-w-0">
                                          {/* Clickable 1-Click Status Toggle Indicator (Active Green / Inactive Red) */}
                                          <button
                                            onClick={(e) => handleToggleServerStatus(s.id, e)}
                                            className={`p-1 rounded-full transition-all cursor-pointer ${
                                              isActive
                                                ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40'
                                                : 'bg-red-500/20 text-red-400 hover:bg-red-500/40'
                                            }`}
                                            title={`Status is ${isActive ? 'ACTIVE' : 'INACTIVE'}. Click to toggle.`}
                                          >
                                            <span className={`block w-2.5 h-2.5 rounded-full ${isActive ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-red-500'}`} />
                                          </button>

                                          <div className="min-w-0 truncate">
                                            <div className="flex items-center space-x-1.5">
                                              <span className="font-bold text-white truncate block text-xs">
                                                {s.name}
                                              </span>
                                              {s.tags && s.tags.length > 0 && (
                                                <span className="px-1 py-0.2 rounded text-[9px] bg-white/10 text-gray-300">
                                                  {s.tags[0]}
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-[10px] text-gray-400 font-mono">
                                              {s.username}@{s.host}:{s.port}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center space-x-1 shrink-0">
                                          <button
                                            onClick={() => handleOpenEditServer(s)}
                                            className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
                                            title="Edit Server Details"
                                          >
                                            <Edit3 className="w-3.5 h-3.5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteServer(s.id)}
                                            className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                                            title="Delete Server from Fleet"
                                          >
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
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
      {/* 5. TAB 4: RUN HISTORY (WITH DOWNLOAD ONE & DOWNLOAD ALL) */}
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
      {/* 6. MODAL: DETAILED SERVER OUTPUT INSPECTOR               */}
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
                  <Terminal className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-bold text-white">{inspectResult.serverName}</h3>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                      inspectResult.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                    }`}>
                      {inspectResult.status}
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono">
                    {inspectResult.username}@{inspectResult.host}:{inspectResult.port} • Exit Code: {inspectResult.exitCode} • Runtime: {(inspectResult.durationMs / 1000).toFixed(2)}s
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDownloadSingleLog(inspectResult, selectedRecipeId)}
                  className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold text-gray-200 flex items-center space-x-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Download Log</span>
                </button>
                <button onClick={() => setInspectResult(null)} className="text-gray-400 hover:text-white cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 font-mono text-xs">
              {inspectResult.stdout && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-emerald-400 font-sans">Standard Output (STDOUT)</span>
                    <button
                      onClick={() => handleCopy(inspectResult.stdout, 'stdout')}
                      className="text-[11px] text-gray-400 hover:text-white flex items-center space-x-1 cursor-pointer"
                    >
                      {copiedKey === 'stdout' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="p-4 rounded-2xl bg-black/70 border border-white/10 text-emerald-300 select-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {inspectResult.stdout}
                  </div>
                </div>
              )}

              {inspectResult.stderr && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-red-400 font-sans">Standard Error (STDERR)</span>
                    <button
                      onClick={() => handleCopy(inspectResult.stderr, 'stderr')}
                      className="text-[11px] text-gray-400 hover:text-white flex items-center space-x-1 cursor-pointer"
                    >
                      {copiedKey === 'stderr' ? <Check className="w-3 h-3 text-red-400" /> : <Copy className="w-3 h-3" />}
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="p-4 rounded-2xl bg-black/70 border border-white/10 text-red-300 select-text leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                    {inspectResult.stderr}
                  </div>
                </div>
              )}

              {!inspectResult.stdout && !inspectResult.stderr && (
                <div className="py-8 text-center text-gray-500 italic">No output streams were captured for this node.</div>
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
      {/* 7. MODAL: NATIVE FLEET SERVER ADD / EDIT                 */}
      {/* ======================================================== */}
      {isServerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[90vh]">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#181c2e]">
              <div className="flex items-center space-x-2">
                <Server className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">
                  {editingServer ? `Edit Server: ${editingServer.name}` : 'Add New Server to Fleet Matrix'}
                </h3>
              </div>
              <button onClick={() => setIsServerModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Organization *</label>
                  <select
                    value={serverForm.organizationId}
                    onChange={e => {
                      const newOrgId = e.target.value;
                      const validGroups = fleetMatrix.groups.filter(g => g.organizationId === newOrgId);
                      setServerForm(prev => ({
                        ...prev,
                        organizationId: newOrgId,
                        groupId: validGroups[0]?.id || '',
                      }));
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {fleetMatrix.organizations.map(o => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Group *</label>
                  <select
                    value={serverForm.groupId}
                    onChange={e => setServerForm(prev => ({ ...prev, groupId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {fleetMatrix.groups
                      .filter(g => g.organizationId === serverForm.organizationId)
                      .map(g => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Server Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Production Web Node 01"
                  value={serverForm.name}
                  onChange={e => setServerForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Host / IP Address *</label>
                  <input
                    type="text"
                    placeholder="e.g. 192.168.1.100 or web.company.internal"
                    value={serverForm.host}
                    onChange={e => setServerForm(prev => ({ ...prev, host: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">SSH Port</label>
                  <input
                    type="number"
                    value={serverForm.port}
                    onChange={e => setServerForm(prev => ({ ...prev, port: Number(e.target.value) || 22 }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">SSH Username *</label>
                  <input
                    type="text"
                    placeholder="e.g. root, ubuntu, sharuk"
                    value={serverForm.username}
                    onChange={e => setServerForm(prev => ({ ...prev, username: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Authentication Type</label>
                  <select
                    value={serverForm.authType}
                    onChange={e => setServerForm(prev => ({ ...prev, authType: e.target.value as 'password' | 'privateKey' | 'agent' }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="password">Password</option>
                    <option value="privateKey">Private Key</option>
                    <option value="agent">SSH Agent</option>
                  </select>
                </div>
              </div>

              {serverForm.authType === 'password' ? (
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">SSH Password</label>
                  <input
                    type="password"
                    placeholder="Enter password..."
                    value={serverForm.password || ''}
                    onChange={e => setServerForm(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Private Key (PEM / OpenSSH)</label>
                  <textarea
                    rows={4}
                    placeholder="Paste private key content (-----BEGIN OPENSSH PRIVATE KEY-----)..."
                    value={serverForm.privateKey || ''}
                    onChange={e => setServerForm(prev => ({ ...prev, privateKey: e.target.value }))}
                    className="w-full p-2.5 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Status</label>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => setServerForm(prev => ({ ...prev, status: 'active' }))}
                      className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                        serverForm.status === 'active'
                          ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                          : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-emerald-300" />
                      <span>Active</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setServerForm(prev => ({ ...prev, status: 'inactive' }))}
                      className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold border transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
                        serverForm.status === 'inactive'
                          ? 'bg-red-600 text-white border-red-500 shadow-md'
                          : 'bg-black/30 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-red-400" />
                      <span>Inactive</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Tags (Comma-separated)</label>
                  <input
                    type="text"
                    placeholder="web, production, eu-west"
                    value={serverForm.tags}
                    onChange={e => setServerForm(prev => ({ ...prev, tags: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsServerModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveServer}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                {editingServer ? 'Save Changes' : 'Add Server'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 8. MODAL: IMPORT SAVED LOGINS INTO FLEET MATRIX           */}
      {/* ======================================================== */}
      {isImportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#181c2e]">
              <h3 className="text-sm font-bold text-white">Import Saved Logins to Fleet Matrix</h3>
              <button onClick={() => setIsImportModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-300 leading-relaxed">
                Found <span className="font-bold text-white">{connections.length} saved connection(s)</span> on this desktop. Select an organization and group to import them into:
              </p>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Target Organization</label>
                <select
                  value={importOrgId}
                  onChange={e => {
                    const newOrgId = e.target.value;
                    setImportOrgId(newOrgId);
                    const validGroups = fleetMatrix.groups.filter(g => g.organizationId === newOrgId);
                    setImportGroupId(validGroups[0]?.id || '');
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
                  value={importGroupId}
                  onChange={e => setImportGroupId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  {fleetMatrix.groups
                    .filter(g => g.organizationId === importOrgId)
                    .map(g => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                </select>
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleImportSavedConnections}
                className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/25 cursor-pointer"
              >
                Import All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 9. MODAL: CREATE / EDIT RECIPE WITH MONACO EDITOR         */}
      {/* ======================================================== */}
      {isRecipeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-3xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden max-h-[92vh]">
            <div className="p-5 border-b border-white/10 flex items-center justify-between bg-[#181c2e]">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-blue-400" />
                <h3 className="text-sm font-bold text-white">
                  {editingRecipe ? `Edit Recipe: ${editingRecipe.title}` : 'Create Custom Automation Playbook'}
                </h3>
              </div>
              <button onClick={() => setIsRecipeModalOpen(false)} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Playbook Title *</label>
                  <input
                    type="text"
                    placeholder="e.g. Flush Redis & Reload Service"
                    value={recipeForm.title}
                    onChange={e => setRecipeForm(prev => ({ ...prev, title: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-300 block mb-1">Category</label>
                  <select
                    value={recipeForm.category}
                    onChange={e => setRecipeForm(prev => ({ ...prev, category: e.target.value as RecipeCategory }))}
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
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Short description of what this automation does..."
                  value={recipeForm.description}
                  onChange={e => setRecipeForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center space-x-6 p-3 rounded-xl bg-black/30 border border-white/10 text-xs">
                <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipeForm.isSudo}
                    onChange={e => setRecipeForm(prev => ({ ...prev, isSudo: e.target.checked }))}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  <span>Requires Sudo</span>
                </label>

                <label className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={recipeForm.stopOnError}
                    onChange={e => setRecipeForm(prev => ({ ...prev, stopOnError: e.target.checked }))}
                    className="w-4 h-4 rounded text-blue-600"
                  />
                  <span>Stop on Error</span>
                </label>

                <div className="flex items-center space-x-2 ml-auto">
                  <span className="text-gray-400">Timeout:</span>
                  <input
                    type="number"
                    min={5}
                    max={1200}
                    value={recipeForm.timeoutSeconds}
                    onChange={e => setRecipeForm(prev => ({ ...prev, timeoutSeconds: Number(e.target.value) || 60 }))}
                    className="w-16 px-2 py-1 rounded bg-black/50 border border-white/15 text-center font-mono text-xs text-white"
                  />
                  <span className="text-gray-500 text-[10px]">sec</span>
                </div>
              </div>

              {/* MONACO VS CODE EDITOR FOR RECIPES */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <label className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5">
                    <Terminal className="w-3.5 h-3.5 text-blue-400" />
                    <span>Bash Script / Commands</span>
                  </label>

                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1 bg-black/40 px-2 py-0.5 rounded-lg border border-white/10">
                      <button
                        type="button"
                        onClick={() => setRecipeEditorFontSize(f => Math.max(f - 1, 9))}
                        className="p-1 hover:text-white text-gray-400 cursor-pointer"
                        title="Zoom Out (Ctrl + -)"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] font-mono text-gray-300 min-w-[28px] text-center">
                        {recipeEditorFontSize}px
                      </span>
                      <button
                        type="button"
                        onClick={() => setRecipeEditorFontSize(f => Math.min(f + 1, 28))}
                        className="p-1 hover:text-white text-gray-400 cursor-pointer"
                        title="Zoom In (Ctrl + +)"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => setRecipeWordWrap(w => !w)}
                      className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                        recipeWordWrap ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'bg-white/5 border-white/10 text-gray-400'
                      }`}
                      title="Toggle Word Wrap (Alt + Z)"
                    >
                      Wrap {recipeWordWrap ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>

                <div className="h-64 rounded-2xl border border-white/15 bg-[#07090f] overflow-hidden">
                  <Editor
                    height="100%"
                    language="shell"
                    theme="vs-dark"
                    value={recipeForm.command}
                    onChange={val => setRecipeForm(prev => ({ ...prev, command: val || '' }))}
                    options={{
                      fontSize: recipeEditorFontSize,
                      wordWrap: recipeWordWrap ? 'on' : 'off',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', monospace",
                      lineNumbers: 'on',
                      renderWhitespace: 'selection',
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                </div>
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
                {editingRecipe ? 'Update Playbook' : 'Save Playbook'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 10. MODAL: CREATE / EDIT ORGANIZATION                    */}
      {/* ======================================================== */}
      {isOrgModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingOrg ? 'Edit Organization' : 'Create Organization'}
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
                  placeholder="e.g. Acme Cloud Corp"
                  value={orgForm.name}
                  onChange={e => setOrgForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="Primary corporate infrastructure"
                  value={orgForm.description}
                  onChange={e => setOrgForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Badge Color</label>
                <div className="flex items-center space-x-2">
                  {['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setOrgForm(prev => ({ ...prev, color }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all cursor-pointer ${
                        orgForm.color === color ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
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
      {/* 11. MODAL: CREATE / EDIT GROUP                           */}
      {/* ======================================================== */}
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-md bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                {editingGroup ? 'Edit Group' : 'Create Group'}
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
                  placeholder="e.g. EU Web Cluster"
                  value={groupForm.name}
                  onChange={e => setGroupForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Description</label>
                <input
                  type="text"
                  placeholder="High-throughput frontend cluster"
                  value={groupForm.description}
                  onChange={e => setGroupForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Badge Color</label>
                <div className="flex items-center space-x-2">
                  {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#6366f1'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setGroupForm(prev => ({ ...prev, color }))}
                      className={`w-7 h-7 rounded-full border-2 transition-all cursor-pointer ${
                        groupForm.color === color ? 'border-white scale-110 shadow-lg' : 'border-transparent opacity-60 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
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
      {/* 12. MODAL: REMOTE SERVER STORAGE (~/.sshdesktop/automation.json) */}
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
                  All custom recipes, execution audit logs, and fleet matrix hierarchies are stored in your remote user profile at <code className="text-amber-300 font-mono text-[11px] bg-black/30 px-1.5 py-0.5 rounded">{serverFilePath}</code> for user <span className="font-semibold text-white">{username}</span>.
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
                    servers_count: allFleetServers.length,
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
