import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Workflow, Play, Square, RefreshCw, CheckCircle2, AlertCircle, Clock,
  Server, Shield, Terminal, Globe, Container, Trash2, Copy, Check,
  Download, Plus, Search, Filter, Layers, Zap, Eye, ChevronDown, ChevronRight,
  Sliders, Calendar, ArrowRight, Activity, AlertTriangle, X, HelpCircle, HardDrive, Cpu, Package,
  Cloud, CloudUpload, CloudDownload, FileJson
} from 'lucide-react';
import { useConnectionStore, useSettingsStore } from '../../lib/store';
import { useUserPrivilege } from '../../lib/permissions';
import { SavedConnection } from '../../lib/types';
import {
  AutomationRecipe,
  ServerExecutionResult,
  TargetHealth,
  AutomationExecutionRun,
  ScheduledAutomation,
  ExecutionMode,
  RecipeCategory,
  AutomationServerData,
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
  loadStoredSchedules,
  saveSchedule,
  deleteSchedule,
  interpolateCommand,
  getAutomationServerFilePath,
  saveAutomationToServer,
  loadAutomationFromServer,
  checkAutomationServerFileStatus,
} from './automation-service';

export default function AutomationApp() {
  const connections = useConnectionStore(s => s.connections);
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const { theme } = useSettingsStore();
  const { username, homeDir } = useUserPrivilege();

  const serverFilePath = getAutomationServerFilePath(homeDir);

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

  // Navigation Tabs
  const [activeTab, setActiveTab] = useState<'runner' | 'recipes' | 'fleet-matrix' | 'history' | 'schedules'>('runner');

  // Recipes & History State
  const [recipes, setRecipes] = useState<AutomationRecipe[]>([]);
  const [history, setHistory] = useState<AutomationExecutionRun[]>([]);
  const [schedules, setSchedules] = useState<ScheduledAutomation[]>([]);
  const [fleetHealth, setFleetHealth] = useState<Record<string, TargetHealth>>({});
  const [isProbingFleet, setIsProbingFleet] = useState(false);

  // Runner Configuration State
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<string>('all');
  
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('fleet-telemetry');
  const [customCommand, setCustomCommand] = useState<string>('');
  const [isSudo, setIsSudo] = useState<boolean>(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('parallel');
  const [concurrency, setConcurrency] = useState<number>(5);
  const [stopOnError, setStopOnError] = useState<boolean>(true);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

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

  // New Schedule Modal State
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [newSchedule, setNewSchedule] = useState<Partial<ScheduledAutomation>>({
    title: '',
    cronExpr: '0 2 * * *',
    targetType: 'all',
    command: '',
    isSudo: false,
    enabled: true,
  });

  // Status Notification
  const [bannerNotice, setBannerNotice] = useState<{ text: string; isError?: boolean } | null>(null);

  // Load recipes, history, and schedules on mount
  useEffect(() => {
    setRecipes(loadStoredRecipes());
    setHistory(loadStoredHistory());
    setSchedules(loadStoredSchedules());
  }, []);

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
        schedules,
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
  }, [activeConnectionId, homeDir, username, recipes, history, schedules, selectedServerIds]);

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
        if (Array.isArray(res.data.schedules)) {
          setSchedules(res.data.schedules);
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
          if (Array.isArray(res.data.schedules) && res.data.schedules.length > 0) {
            setSchedules(res.data.schedules);
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

  // Initialize selected servers default (select active server, or all if none active)
  useEffect(() => {
    if (connections.length > 0 && selectedServerIds.length === 0) {
      if (activeConnectionId && connections.some(c => c.id === activeConnectionId)) {
        setSelectedServerIds([activeConnectionId]);
      } else {
        setSelectedServerIds(connections.map(c => c.id));
      }
    }
  }, [connections, activeConnectionId]);

  // Update recipe settings when selected recipe changes
  useEffect(() => {
    const found = recipes.find(r => r.id === selectedRecipeId);
    if (found) {
      setCustomCommand(found.command);
      setIsSudo(found.isSudo);
      if (found.stopOnError !== undefined) {
        setStopOnError(found.stopOnError);
      }
      // Initialize default variables
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

  // Derived Server Groups
  const serverGroups = useMemo(() => {
    const groups = new Set<string>();
    connections.forEach(c => {
      if (c.group && c.group.trim()) {
        groups.add(c.group.trim());
      }
    });
    return Array.from(groups);
  }, [connections]);

  // Filtered Servers for selection list
  const filteredServers = useMemo(() => {
    return connections.filter(c => {
      const matchesSearch = 
        (c.name || '').toLowerCase().includes(serverSearchQuery.toLowerCase()) ||
        c.host.toLowerCase().includes(serverSearchQuery.toLowerCase()) ||
        c.username.toLowerCase().includes(serverSearchQuery.toLowerCase());
      const matchesGroup = 
        selectedGroupFilter === 'all' || 
        c.group === selectedGroupFilter;
      return matchesSearch && matchesGroup;
    });
  }, [connections, serverSearchQuery, selectedGroupFilter]);

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
    if (targetServers.length === 0) {
      setBannerNotice({ text: 'Please select at least one server to probe.', isError: true });
      return;
    }
    setIsProbingFleet(true);
    setBannerNotice({ text: `Probing live health telemetry on ${targetServers.length} servers...` });
    try {
      const results = await probeFleetTelemetry(targetServers, (health) => {
        setFleetHealth(prev => ({ ...prev, [health.serverId]: health }));
      });
      const onlineCount = results.filter(r => r.reachable).length;
      setBannerNotice({
        text: `Fleet probe complete: ${onlineCount}/${results.length} servers online and responding.`,
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
    setBannerNotice({ text: 'Cancellation requested. Awaiting current active thread cleanup...', isError: true });
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

    // Initialize all targets as pending
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
          schedules,
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
        schedules,
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
        schedules,
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
                Fleet Orchestrator
              </span>
            </div>
            <p className="text-[10px] text-gray-400">
              Parallel execution, rolling updates & telemetry for {connections.length} nodes
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
            onClick={() => {
              setActiveTab('fleet-matrix');
              if (Object.keys(fleetHealth).length === 0) {
                handleProbeFleet();
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'fleet-matrix'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Fleet Matrix</span>
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
          <button
            onClick={() => setActiveTab('schedules')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center space-x-1.5 ${
              activeTab === 'schedules'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Schedules</span>
          </button>
        </div>

        {/* Global Action / Probing State & Server Storage Sync */}
        <div className="flex items-center space-x-2">
          {/* Server Sync Status Pill */}
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
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-medium border border-white/10 flex items-center space-x-1.5 disabled:opacity-50 transition-all"
            title="Probe connection and telemetry on selected fleet"
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
          <button onClick={() => setBannerNotice(null)} className="hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. TAB 1: RUNNER (PRIMARY WORKSPACE)                     */}
      {/* ======================================================== */}
      {activeTab === 'runner' && (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT COLUMN: FLEET TARGET SELECTOR */}
          <aside className="w-72 border-r border-white/10 bg-[#111320] flex flex-col shrink-0">
            {/* Target Header */}
            <div className="p-3 border-b border-white/10 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white tracking-wide uppercase">Target Fleet</span>
                <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 font-mono">
                  {selectedServerIds.length}/{connections.length}
                </span>
              </div>
              <div className="flex items-center space-x-1 text-[11px]">
                <button
                  onClick={selectAllFiltered}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white"
                >
                  All
                </button>
                <button
                  onClick={deselectAllFiltered}
                  className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white"
                >
                  None
                </button>
              </div>
            </div>

            {/* Group Filter Pills */}
            {serverGroups.length > 0 && (
              <div className="px-3 pt-2.5 pb-1 flex items-center space-x-1 overflow-x-auto scrollbar-none">
                <button
                  onClick={() => setSelectedGroupFilter('all')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all shrink-0 ${
                    selectedGroupFilter === 'all'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  All Groups
                </button>
                {serverGroups.map(grp => (
                  <button
                    key={grp}
                    onClick={() => setSelectedGroupFilter(grp)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all shrink-0 ${
                      selectedGroupFilter === grp
                        ? 'bg-blue-600 text-white'
                        : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {grp}
                  </button>
                ))}
              </div>
            )}

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

            {/* Servers Checkbox List */}
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

                  return (
                    <div
                      key={server.id}
                      onClick={() => toggleServer(server.id)}
                      className={`p-2 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600/15 border-blue-500/40 text-white'
                          : 'bg-white/[0.02] border-white/5 text-gray-400 hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // Handled by container onClick
                          className="w-3.5 h-3.5 rounded border-gray-600 text-blue-600 focus:ring-0 cursor-pointer pointer-events-none"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-1.5">
                            <span className="text-xs font-semibold truncate text-gray-200">
                              {server.name || server.host}
                            </span>
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

                      {/* Real-time status badge */}
                      <div className="shrink-0 flex items-center space-x-1">
                        {execRes ? (
                          execRes.status === 'running' ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          ) : execRes.status === 'success' ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          ) : execRes.status === 'failed' ? (
                            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-gray-500" />
                          )
                        ) : health ? (
                          health.reachable ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-400" title="Online & Responding" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-red-400" title={health.error || 'Unreachable'} />
                          )
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-gray-600" />
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

          {/* RIGHT COLUMN: TASK DEFINITION & EXECUTION RESULTS */}
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
                      className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center space-x-1 ${
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
                      className={`px-2 py-1 rounded text-xs font-medium transition-all flex items-center space-x-1 ${
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
                      className="px-4 py-2 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-semibold shadow-lg shadow-red-600/30 flex items-center space-x-2 transition-all"
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

              {/* Dynamic Variables Inputs (if selected recipe requires params) */}
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

            {/* Split Middle: Script Editor / Preview (collapsible) */}
            <div className="px-4 py-2.5 border-b border-white/10 bg-[#0b0d16] flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs text-gray-400">
                <Terminal className="w-3.5 h-3.5 text-blue-400" />
                <span>Script Command Template (Variables supported: <code className="text-blue-300 font-mono text-[11px]">&#123;&#123;SERVER_NAME&#125;&#125;</code>, <code className="text-blue-300 font-mono text-[11px]">&#123;&#123;SERVER_HOST&#125;&#125;</code>, <code className="text-blue-300 font-mono text-[11px]">&#123;&#123;SERVER_USER&#125;&#125;</code>)</span>
              </div>
              <span className="text-[10px] text-gray-500 font-mono">
                {customCommand.split('\n').length} lines
              </span>
            </div>

            <div className="h-32 border-b border-white/10 bg-[#07090f] relative font-mono text-xs">
              <textarea
                value={customCommand}
                onChange={e => setCustomCommand(e.target.value)}
                placeholder="# Enter bash commands to run across your server fleet..."
                className="w-full h-full p-3 bg-transparent text-emerald-400 resize-none focus:outline-none font-mono text-[11px] leading-relaxed select-text"
                spellCheck={false}
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
                  {resultStats.skipped > 0 && (
                    <span className="px-2 py-0.5 rounded bg-gray-500/15 text-gray-400 border border-gray-500/20 font-medium">
                      {resultStats.skipped} Skipped
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
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                      outputViewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Server Cards
                  </button>
                  <button
                    onClick={() => setOutputViewMode('unified')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium ${
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
                    Click &quot;Execute on Fleet&quot; above to run &quot;{recipes.find(r => r.id === selectedRecipeId)?.title || 'Custom Command'}&quot; across {selectedServerIds.length} target machines.
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
                            onClick={() => handleCopy(res.stdout || res.stderr, `card-${server.id}`)}
                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-300 text-[10px] flex items-center space-x-1 transition-all"
                          >
                            {copiedKey === `card-${server.id}` ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Copy Output</span>
                              </>
                            )}
                          </button>

                          <button
                            onClick={() => setInspectResult(res)}
                            className="text-xs text-blue-400 hover:text-blue-300 font-medium"
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
                      className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white text-[11px] flex items-center space-x-1"
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
      {/* 3. TAB 2: RECIPE LIBRARY                                 */}
      {/* ======================================================== */}
      {activeTab === 'recipes' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Automation Recipes & Playbooks</h2>
                <p className="text-xs text-gray-400">
                  Pre-configured operational workflows and custom multi-server scripts
                </p>
              </div>

              <button
                onClick={() => setIsRecipeModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center space-x-2"
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

                    {/* Code Snippet Preview */}
                    <div className="mt-3 p-2.5 rounded-xl bg-black/60 border border-white/5 font-mono text-[10px] text-emerald-400/90 h-20 overflow-hidden select-text">
                      <pre className="whitespace-pre-wrap">{recipe.command}</pre>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                    {!recipe.isBuiltIn ? (
                      <button
                        onClick={() => handleDeleteRecipe(recipe.id)}
                        className="text-gray-500 hover:text-red-400 p-1.5 transition-all"
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
                      className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold flex items-center space-x-1 transition-all"
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
      {/* 4. TAB 3: FLEET MATRIX (TELEMETRY DASHBOARD)             */}
      {/* ======================================================== */}
      {activeTab === 'fleet-matrix' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Fleet Health & Telemetry Matrix</h2>
                <p className="text-xs text-gray-400">
                  Real-time CPU loads, RAM usage, storage status, and latency across all nodes
                </p>
              </div>

              <button
                onClick={handleProbeFleet}
                disabled={isProbingFleet}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-95 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 flex items-center space-x-2 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isProbingFleet ? 'animate-spin' : ''}`} />
                <span>{isProbingFleet ? 'Probing Fleet...' : 'Refresh Fleet Metrics'}</span>
              </button>
            </div>

            {/* Matrix Table */}
            <div className="rounded-2xl border border-white/10 bg-[#131626] overflow-hidden shadow-xl">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#181b2e] border-b border-white/10 text-gray-400 font-semibold uppercase text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Node / Host</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">OS Distribution</th>
                      <th className="py-3 px-4">Uptime</th>
                      <th className="py-3 px-4">Load (1m, 5m, 15m)</th>
                      <th className="py-3 px-4">RAM Utilization</th>
                      <th className="py-3 px-4">Root Disk Space</th>
                      <th className="py-3 px-4">SSH Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {connections.map(c => {
                      const health = fleetHealth[c.id];

                      return (
                        <tr key={c.id} className="hover:bg-white/[0.02] transition-all">
                          <td className="py-3 px-4">
                            <div className="font-bold text-white">{c.name || c.host}</div>
                            <div className="text-[10px] text-gray-500 font-mono">
                              {c.username}@{c.host}:{c.port}
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            {health ? (
                              health.reachable ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                  Online
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                                  Unreachable
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-500/20 text-gray-400">
                                Not Probed
                              </span>
                            )}
                          </td>

                          <td className="py-3 px-4 text-gray-300 font-medium">
                            {health?.os || '—'}
                          </td>

                          <td className="py-3 px-4 text-gray-400 font-mono text-[11px]">
                            {health?.uptime || '—'}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-gray-300">
                            {health?.loadAvg || '—'}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-gray-300">
                            {health?.memUsage || '—'}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px] text-gray-300">
                            {health?.diskUsage || '—'}
                          </td>

                          <td className="py-3 px-4 font-mono text-[11px]">
                            {health?.latencyMs !== undefined ? (
                              <span className={health.latencyMs < 100 ? 'text-emerald-400' : 'text-amber-400'}>
                                {health.latencyMs}ms
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 5. TAB 4: RUN HISTORY & AUDIT LOG                        */}
      {/* ======================================================== */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Fleet Automation Audit History</h2>
                <p className="text-xs text-gray-400">
                  Records of previously dispatched parallel tasks and rolling deployments
                </p>
              </div>

              {history.length > 0 && (
                <button
                  onClick={() => {
                    clearHistory();
                    setHistory([]);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-red-600/10 hover:bg-red-600/20 text-red-400 text-xs font-semibold border border-red-500/20 flex items-center space-x-1.5 transition-all"
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
              <div className="space-y-3">
                {history.map(run => (
                  <div
                    key={run.id}
                    className="rounded-2xl border border-white/10 bg-[#131626] p-4 flex flex-col justify-between hover:border-white/20 transition-all shadow-md"
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

                      <div className="flex items-center space-x-3">
                        <div className="flex items-center space-x-1.5 text-xs font-mono">
                          <span className="text-emerald-400 font-semibold">{run.successCount} succeeded</span>
                          {run.failureCount > 0 && (
                            <span className="text-red-400 font-semibold">• {run.failureCount} failed</span>
                          )}
                          <span className="text-gray-500">/ {run.totalServers} servers</span>
                        </div>

                        <button
                          onClick={() => handleRerunHistory(run)}
                          className="px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-semibold transition-all flex items-center space-x-1"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Re-Run</span>
                        </button>
                      </div>
                    </div>

                    {/* Command Snippet */}
                    <div className="mt-2.5 p-2 rounded-lg bg-black/60 border border-white/5 font-mono text-[10px] text-gray-300 overflow-hidden line-clamp-2">
                      {run.command}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 6. TAB 5: SCHEDULES (CRON PLANNER)                       */}
      {/* ======================================================== */}
      {activeTab === 'schedules' && (
        <div className="flex-1 overflow-y-auto p-6 bg-[#0e101a]">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Scheduled Fleet Automation</h2>
                <p className="text-xs text-gray-400">
                  Automate recurring maintenance routines, cleanups, and audits across your fleet
                </p>
              </div>

              <button
                onClick={() => setIsScheduleModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center space-x-2"
              >
                <Plus className="w-4 h-4" />
                <span>Add Scheduled Task</span>
              </button>
            </div>

            {schedules.length === 0 ? (
              <div className="py-16 text-center text-xs text-gray-500 rounded-2xl border border-white/5 bg-[#121422]">
                No recurring schedules configured yet. Click &quot;Add Scheduled Task&quot; above to automate routines.
              </div>
            ) : (
              <div className="space-y-3">
                {schedules.map(sch => (
                  <div
                    key={sch.id}
                    className="rounded-2xl border border-white/10 bg-[#131626] p-4 flex items-center justify-between shadow-md"
                  >
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-sm font-bold text-white">{sch.title}</h3>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-indigo-500/20 text-indigo-300">
                          {sch.cronExpr}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5 font-mono truncate max-w-lg">
                        {sch.command}
                      </p>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          const updated = deleteSchedule(sch.id);
                          setSchedules(updated);
                          if (activeConnectionId && homeDir) {
                            saveAutomationToServer(activeConnectionId, homeDir, {
                              username,
                              customRecipes: recipes.filter(r => !r.isBuiltIn),
                              history,
                              schedules: updated,
                              lastTargetServerIds: selectedServerIds,
                            }).catch(() => {});
                          }
                        }}
                        className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-white/5 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
            {/* Modal Header */}
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
                  onClick={() => handleCopy(inspectResult.stdout || inspectResult.stderr, 'modal-output')}
                  className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center space-x-1.5 transition-all"
                >
                  {copiedKey === 'modal-output' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied Log</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Output</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => setInspectResult(null)}
                  className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body: Console Stream */}
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

              {!inspectResult.stdout && !inspectResult.stderr && (
                <div className="py-12 text-center text-gray-500 italic">
                  Command completed with no stdout or stderr stream.
                </div>
              )}
            </div>

            <div className="p-4 border-t border-white/10 bg-[#171a2e] flex items-center justify-end">
              <button
                onClick={() => setInspectResult(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 8. MODAL: CREATE CUSTOM RECIPE                           */}
      {/* ======================================================== */}
      {isRecipeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create Custom Automation Playbook</h3>
              <button onClick={() => setIsRecipeModalOpen(false)} className="text-gray-400 hover:text-white">
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
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRecipe}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25"
              >
                Save Playbook
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 9. MODAL: ADD SCHEDULED TASK                             */}
      {/* ======================================================== */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="p-5 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create Scheduled Automation</h3>
              <button onClick={() => setIsScheduleModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Task Title</label>
                <input
                  type="text"
                  placeholder="e.g. Nightly Docker Cleanup"
                  value={newSchedule.title || ''}
                  onChange={e => setNewSchedule(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">
                  Cron Expression (e.g. 0 2 * * * for Daily at 2:00 AM)
                </label>
                <input
                  type="text"
                  placeholder="0 2 * * *"
                  value={newSchedule.cronExpr || ''}
                  onChange={e => setNewSchedule(prev => ({ ...prev, cronExpr: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-black/50 border border-white/15 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1">Command Script</label>
                <textarea
                  rows={4}
                  placeholder="docker system prune -af"
                  value={newSchedule.command || ''}
                  onChange={e => setNewSchedule(prev => ({ ...prev, command: e.target.value }))}
                  className="w-full p-3 rounded-xl bg-black/60 border border-white/15 font-mono text-xs text-emerald-400 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="p-4 border-t border-white/10 bg-[#181c2e] flex items-center justify-end space-x-2">
              <button
                onClick={() => setIsScheduleModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!newSchedule.title || !newSchedule.command) return;
                  const item: ScheduledAutomation = {
                    id: `sch-${Date.now()}`,
                    title: newSchedule.title,
                    cronExpr: newSchedule.cronExpr || '0 0 * * *',
                    targetType: 'all',
                    targetServerIds: selectedServerIds,
                    command: newSchedule.command,
                    isSudo: !!newSchedule.isSudo,
                    enabled: true,
                    createdAt: Date.now(),
                  };
                  const updated = saveSchedule(item);
                  setSchedules(updated);
                  setIsScheduleModalOpen(false);
                  setBannerNotice({ text: `Schedule "${item.title}" created.` });
                  if (activeConnectionId && homeDir) {
                    saveAutomationToServer(activeConnectionId, homeDir, {
                      username,
                      customRecipes: recipes.filter(r => !r.isBuiltIn),
                      history,
                      schedules: updated,
                      lastTargetServerIds: selectedServerIds,
                    }).catch(() => {});
                  }
                }}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25"
              >
                Save Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 10. MODAL: REMOTE SERVER STORAGE (~/.sshdesktop/automation.json) */}
      {/* ======================================================== */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="w-full max-w-2xl bg-[#141726] border border-white/15 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
            {/* Modal Header */}
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
              <button onClick={() => setIsSyncModalOpen(false)} className="text-gray-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5">
              {/* Info banner */}
              <div className="p-3.5 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-200 text-xs flex items-start space-x-3">
                <HardDrive className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed">
                  All custom recipes, execution audit logs, and cron schedules are stored in your remote user profile at <code className="text-amber-300 font-mono text-[11px] bg-black/30 px-1.5 py-0.5 rounded">{serverFilePath}</code> for user <span className="font-semibold text-white">{username}</span>. When logging in from any desktop or browser, this data is restored.
                </div>
              </div>

              {/* Status Grid */}
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

              {/* Action Buttons */}
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

              {/* Raw JSON Preview */}
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
                    schedules_count: schedules.length,
                    path: serverFilePath,
                  }, null, 2)}</pre>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
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
