import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Server, Play, Square, RotateCw, CheckCircle, AlertTriangle, XCircle, 
  Search, ScrollText, RefreshCw, X, ShieldAlert, Sliders, Copy, Terminal, 
  Layers, Check, ExternalLink, Power, Eye, Filter, ArrowUpRight, FileCode,
  Flame, Lock, Unlock, PlayCircle, StopCircle, ArrowUp, ArrowDown, 
  ChevronsUp, ChevronsDown, ArrowDownToLine, Pause, Download, Trash2
} from 'lucide-react';
import { serviceList, serviceAction, serviceLogs, serviceStatus, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import EditServiceModal from './modals/EditServiceModal';

interface ServiceItem {
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'failed';
  subState: string;
  enabled: boolean;
  mainPid?: number;
  memory?: string;
  loaded?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  service: ServiceItem;
}

export default function ServiceManager() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'failed' | 'inactive'>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');
  const [selectedServiceName, setSelectedServiceName] = useState<string | null>(null);

  // Modals & Panels
  const [selectedLogsService, setSelectedLogsService] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [logLinesCount, setLogLinesCount] = useState<number>(100);
  const [logFilterQuery, setLogFilterQuery] = useState<string>('');
  const [logSeverityFilter, setLogSeverityFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const [isLogRefreshing, setIsLogRefreshing] = useState(false);
  const [isLiveStreaming, setIsLiveStreaming] = useState<boolean>(true);
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const liveIntervalRef = useRef<any>(null);

  const [inspectService, setInspectService] = useState<ServiceItem | null>(null);
  const [serviceStatusOutput, setServiceStatusOutput] = useState<string>('');
  const [editingService, setEditingService] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; isError: boolean } | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const { runTerminalCommand } = useEditorStore();

  const loadServices = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await serviceList(activeConnId);
      if (list && Array.isArray(list)) {
        setServices(list.map((item: any) => ({
          name: item.name,
          description: item.description || '',
          status: item.active_state === 'active' ? 'active' : item.active_state === 'failed' ? 'failed' : 'inactive',
          subState: item.sub_state || 'dead',
          enabled: item.enabled ?? true,
        })));
      } else {
        setServices([]);
      }
    } catch (err) {
      console.warn('Failed to load services:', err);
      setServices([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  // Close context menu on outside click
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable') => {
    setActionInProgress(`${name}-${action}`);
    setContextMenu(null);
    try {
      await serviceAction(activeConnId, name, action);
      setActionNotice({ text: `Service '${name}' successfully ${action}ed.`, isError: false });
      setTimeout(() => setActionNotice(null), 3500);
      await loadServices();
    } catch (err: any) {
      setActionNotice({ text: `Failed to ${action} ${name}: ${err?.message || err}`, isError: true });
    } finally {
      setActionInProgress(null);
    }
  };

  const handleViewLogs = async (name: string, lines: number = logLinesCount) => {
    setSelectedLogsService(name);
    setIsLogRefreshing(true);
    setIsLiveStreaming(true);
    setAutoScroll(true);
    setLogContent('Fetching journalctl output...');
    try {
      const logs = await serviceLogs(activeConnId, name, lines);
      setLogContent(logs || 'No journalctl entries available for this service.');
    } catch (err: any) {
      setLogContent(`Error fetching logs: ${err?.message || err}`);
    } finally {
      setIsLogRefreshing(false);
    }
  };

  // Live journalctl log streaming interval
  useEffect(() => {
    if (!selectedLogsService || !isLiveStreaming) {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
      return;
    }

    liveIntervalRef.current = setInterval(async () => {
      try {
        const logs = await serviceLogs(activeConnId, selectedLogsService, logLinesCount);
        if (logs) {
          setLogContent(logs);
        }
      } catch (err) {
        console.warn('Live log stream poll error:', err);
      }
    }, 2000);

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
  }, [selectedLogsService, isLiveStreaming, activeConnId, logLinesCount]);

  // Auto-scroll log container to bottom on new log content if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logContent, autoScroll]);

  const handleInspect = async (service: ServiceItem) => {
    setInspectService(service);
    setServiceStatusOutput('Querying systemctl status...');
    try {
      const statusText = await serviceStatus(activeConnId, service.name);
      setServiceStatusOutput(statusText || 'No status details available.');
    } catch (err: any) {
      setServiceStatusOutput(`Error fetching status: ${err?.message || err}`);
    }
  };

  const handleEditServiceFile = (name: string) => {
    setContextMenu(null);
    setEditingService(name);
  };

  // Stream Live in Terminal: Open fresh terminal tab and immediately execute live journalctl
  const handleOpenTerminalLogs = (name: string) => {
    setContextMenu(null);
    const cmd = `journalctl -u ${name} -f -n 50\n`;
    const title = `journalctl: ${name}`;
    runTerminalCommand({ cmd, title, newTab: true });
    window.dispatchEvent(new CustomEvent('sshdesktop:terminal-run-command', {
      detail: { cmd, title, newTab: true }
    }));
    window.dispatchEvent(new CustomEvent('clouddesk:terminal-run-command', {
      detail: { cmd, title, newTab: true }
    }));
    openApp('terminal', 'Terminal');
  };

  const filtered = useMemo(() => {
    return services.filter(s => {
      if (filter === 'active') return s.status === 'active';
      if (filter === 'inactive') return s.status === 'inactive';
      if (filter === 'failed') return s.status === 'failed';
      return true;
    }).filter(s =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
    );
  }, [services, filter, search]);

  const activeCount = useMemo(() => services.filter(s => s.status === 'active').length, [services]);
  const failedCount = useMemo(() => services.filter(s => s.status === 'failed').length, [services]);
  const inactiveCount = useMemo(() => services.filter(s => s.status === 'inactive').length, [services]);

  // Navigate rows (Up, Down, Start, End) and auto-scroll target element into view
  const navigateRow = useCallback((direction: 'up' | 'down' | 'start' | 'end') => {
    if (filtered.length === 0) return;
    const currentIndex = filtered.findIndex(s => s.name === selectedServiceName);
    let nextIndex = 0;

    if (direction === 'down') {
      nextIndex = currentIndex < 0 ? 0 : Math.min(filtered.length - 1, currentIndex + 1);
    } else if (direction === 'up') {
      nextIndex = currentIndex < 0 ? filtered.length - 1 : Math.max(0, currentIndex - 1);
    } else if (direction === 'start') {
      nextIndex = 0;
    } else if (direction === 'end') {
      nextIndex = filtered.length - 1;
    }

    const target = filtered[nextIndex];
    if (target) {
      setSelectedServiceName(target.name);
      requestAnimationFrame(() => {
        const el = document.getElementById(`service-row-${target.name}`) || document.getElementById(`service-card-${target.name}`);
        if (el) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }
  }, [filtered, selectedServiceName]);

  // Keyboard Navigation: ArrowUp/ArrowDown, Home/End, Enter to inspect, Ctrl+E to edit, Space to start/stop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      if (selectedLogsService || inspectService || editingService) {
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateRow('down');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateRow('up');
      } else if (e.key === 'Home') {
        e.preventDefault();
        navigateRow('start');
      } else if (e.key === 'End') {
        e.preventDefault();
        navigateRow('end');
      } else if (e.key === 'Enter') {
        if (selectedServiceName) {
          const s = services.find(x => x.name === selectedServiceName);
          if (s) handleInspect(s);
        }
      } else if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (selectedServiceName) {
          handleEditServiceFile(selectedServiceName);
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        if (selectedServiceName) {
          const s = services.find(x => x.name === selectedServiceName);
          if (s) {
            handleAction(s.name, s.status === 'active' ? 'stop' : 'start');
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigateRow, selectedLogsService, inspectService, editingService, selectedServiceName, services]);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative">
      {/* macOS Top Toolbar & Segmented View Bar */}
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3 overflow-x-auto no-scrollbar">
        {/* Left: macOS Segmented Filter Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="mac-segmented-container">
            <button
              onClick={() => setFilter('all')}
              className={`mac-segmented-item ${filter === 'all' ? 'active' : ''}`}
            >
              All ({services.length})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${filter === 'active' ? 'active' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span>Running ({activeCount})</span>
            </button>
            <button
              onClick={() => setFilter('failed')}
              className={`mac-segmented-item flex items-center space-x-1.5 ${filter === 'failed' ? 'active' : ''}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span>Failed ({failedCount})</span>
            </button>
            <button
              onClick={() => setFilter('inactive')}
              className={`mac-segmented-item ${filter === 'inactive' ? 'active' : ''}`}
            >
              Inactive ({inactiveCount})
            </button>
          </div>

          {/* Table vs Cards Toggle */}
          <div className="mac-segmented-container">
            <button
              onClick={() => setViewMode('table')}
              className={`mac-segmented-item ${viewMode === 'table' ? 'active' : ''}`}
              title="Table View"
            >
              List
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`mac-segmented-item ${viewMode === 'cards' ? 'active' : ''}`}
              title="Grid Cards View"
            >
              Cards
            </button>
          </div>

          {/* Up / Down Row Selection & Auto-Scroll Navigation Controls */}
          <div className="flex items-center space-x-1 bg-[#101018] border border-white/10 rounded-xl px-1.5 py-0.5 text-xs text-gray-400">
            <span className="text-[10px] px-1 font-mono text-gray-500 hidden xl:inline">Row:</span>
            <button
              onClick={() => navigateRow('start')}
              disabled={filtered.length === 0}
              className="p-1 hover:bg-white/10 rounded-lg hover:text-white transition-colors disabled:opacity-30"
              title="Jump to Start of List (Home)"
            >
              <ChevronsUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateRow('up')}
              disabled={filtered.length === 0}
              className="p-1 hover:bg-white/10 rounded-lg hover:text-white transition-colors disabled:opacity-30"
              title="Select Previous Row (Arrow Up)"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateRow('down')}
              disabled={filtered.length === 0}
              className="p-1 hover:bg-white/10 rounded-lg hover:text-white transition-colors disabled:opacity-30"
              title="Select Next Row (Arrow Down)"
            >
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateRow('end')}
              disabled={filtered.length === 0}
              className="p-1 hover:bg-white/10 rounded-lg hover:text-white transition-colors disabled:opacity-30"
              title="Jump to End of List (End)"
            >
              <ChevronsDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Search Pill & Refresh */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search service units..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-44 focus:w-60 transition-all shadow-inner"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={loadServices}
            disabled={isLoading}
            className="mac-btn-icon"
            title="Refresh Services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Action Notification Toast */}
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

      {/* Main View Area: Table or Cards */}
      <div className={`flex-1 min-h-0 bg-[#161622] flex flex-col overflow-hidden relative ${isLoading ? 'cursor-mac-wait' : ''}`}>
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-20 pointer-events-none" />
        )}
        {viewMode === 'table' ? (
          /* 1. TABLE VIEW */
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Service Unit</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="py-2.5 px-3 w-28">Status</th>
                  <th className="py-2.5 px-3 w-24">Substate</th>
                  <th className="py-2.5 px-3 w-28 text-center">Autostart</th>
                  <th className="py-2.5 px-3 text-right w-52">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {isLoading ? 'Scanning systemd services over SSH...' : 'No matching services found'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((service, index) => {
                    const isSelected = selectedServiceName === service.name;
                    const isZebra = index % 2 === 1;

                    return (
                      <tr
                        id={`service-row-${service.name}`}
                        key={service.name}
                        onClick={() => setSelectedServiceName(service.name)}
                        onDoubleClick={() => handleInspect(service)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedServiceName(service.name);
                          setContextMenu({ x: e.clientX, y: e.clientY, service });
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium shadow-[inset_0_0_12px_rgba(59,130,246,0.15)]'
                            : isZebra
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-bold text-white flex items-center space-x-2">
                          <Server className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="truncate max-w-xs">{service.name}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-400 truncate max-w-sm font-sans" title={service.description}>
                          {service.description || '—'}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center space-x-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${
                              service.status === 'active'
                                ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse'
                                : service.status === 'failed'
                                ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]'
                                : 'bg-gray-500'
                            }`} />
                            <span className={`text-[10px] font-bold uppercase font-mono ${
                              service.status === 'active'
                                ? 'text-emerald-400'
                                : service.status === 'failed'
                                ? 'text-rose-400'
                                : 'text-gray-400'
                            }`}>
                              {service.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3 font-mono text-gray-400 text-[11px]">
                          {service.subState}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {/* macOS Toggle Switch for Autostart */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAction(service.name, service.enabled ? 'disable' : 'enable');
                            }}
                            className={`relative inline-flex h-4 w-8 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              service.enabled ? 'bg-blue-600' : 'bg-gray-700'
                            }`}
                            title={service.enabled ? 'Autostart Enabled (Click to Disable)' : 'Autostart Disabled (Click to Enable)'}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                                service.enabled ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </td>
                        <td className="py-2 px-3 text-right space-x-1">
                          {/* Inspect Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleInspect(service); }}
                            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                            title="Inspect Service Status (Enter)"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Logs Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewLogs(service.name); }}
                            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-blue-400 transition-colors"
                            title="View Journalctl Live Logs"
                          >
                            <ScrollText className="w-3.5 h-3.5 text-blue-400" />
                          </button>

                          {/* Edit Service Unit File Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleEditServiceFile(service.name); }}
                            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-cyan-400 transition-colors"
                            title="Edit Service Unit File (Ctrl+E)"
                          >
                            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                          </button>

                          {/* Start / Stop Toggle */}
                          {service.status === 'active' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(service.name, 'stop'); }}
                              disabled={actionInProgress === `${service.name}-stop`}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                              title="Stop Service (Space)"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAction(service.name, 'start'); }}
                              disabled={actionInProgress === `${service.name}-start`}
                              className="p-1 rounded-lg hover:bg-emerald-500/20 text-gray-400 hover:text-emerald-400 transition-colors"
                              title="Start Service (Space)"
                            >
                              <Play className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Restart Button */}
                          <button
                            onClick={(e) => { e.stopPropagation(); handleAction(service.name, 'restart'); }}
                            disabled={actionInProgress === `${service.name}-restart`}
                            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-amber-400 transition-colors"
                            title="Restart Service"
                          >
                            <RotateCw className={`w-3.5 h-3.5 ${actionInProgress === `${service.name}-restart` ? 'animate-spin text-amber-400' : ''}`} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        ) : (
          /* 2. CARDS GRID VIEW */
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map(service => (
                <div
                  id={`service-card-${service.name}`}
                  key={service.name}
                  onClick={() => setSelectedServiceName(service.name)}
                  onDoubleClick={() => handleInspect(service)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelectedServiceName(service.name);
                    setContextMenu({ x: e.clientX, y: e.clientY, service });
                  }}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    selectedServiceName === service.name
                      ? 'bg-blue-600/15 border-blue-500/60 shadow-lg'
                      : 'bg-[#1a1d2e] border-white/[0.06] hover:border-white/20 hover:bg-[#20243a]'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5 overflow-hidden">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        service.status === 'active'
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : service.status === 'failed'
                          ? 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                          : 'bg-white/5 border-white/10 text-gray-400'
                      }`}>
                        <Server className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono font-bold text-white text-xs truncate">{service.name}</div>
                        <div className="text-[10px] text-gray-400 font-sans truncate">{service.description || 'System service'}</div>
                      </div>
                    </div>

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase font-mono ${
                      service.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : service.status === 'failed'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-white/5 text-gray-400 border border-white/10'
                    }`}>
                      {service.status}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06] text-xs">
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] text-gray-400">Autostart:</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAction(service.name, service.enabled ? 'disable' : 'enable');
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-md font-semibold ${
                          service.enabled ? 'bg-blue-500/20 text-blue-300' : 'bg-white/5 text-gray-500'
                        }`}
                      >
                        {service.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleViewLogs(service.name); }}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
                        title="Logs"
                      >
                        <ScrollText className="w-3.5 h-3.5 text-blue-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEditServiceFile(service.name); }}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-cyan-400"
                        title="Edit Service Unit File"
                      >
                        <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAction(service.name, service.status === 'active' ? 'stop' : 'start'); }}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
                        title={service.status === 'active' ? 'Stop' : 'Start'}
                      >
                        {service.status === 'active' ? <Square className="w-3.5 h-3.5 text-amber-400" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleAction(service.name, 'restart'); }}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
                        title="Restart"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* macOS Bottom Status Bar */}
        <div className="bg-[#11111a] border-t border-white/[0.08] px-4 py-2 flex items-center justify-between text-xs text-gray-400 shrink-0 font-sans">
          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>{activeCount} Running</span>
            </span>
            <span>·</span>
            <span className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span>{failedCount} Failed</span>
            </span>
            <span>·</span>
            <span>Total: <b className="text-white font-mono">{services.length}</b></span>
            {selectedServiceName && (
              <>
                <span>·</span>
                <span className="text-blue-400 font-mono truncate max-w-xs font-semibold">
                  Selected: {selectedServiceName}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center space-x-3 text-[11px] text-gray-500 hidden sm:flex">
            <span>[↑ / ↓] Select Row</span>
            <span>·</span>
            <span>[Enter] Inspect</span>
            <span>·</span>
            <span>[Ctrl+E] Edit File</span>
            <span>·</span>
            <span>[Space] Start/Stop</span>
          </div>
        </div>
      </div>

      {/* macOS Live Journalctl Logs Modal with Auto-Scroll & Start/Stop */}
      {selectedLogsService && (
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 animate-in fade-in duration-150"
          onClick={() => setSelectedLogsService(null)}
        >
          <div 
            className="bg-[#181a2c] border border-white/20 rounded-2xl w-full max-w-4xl h-full max-h-[calc(100%-1rem)] flex flex-col shadow-2xl overflow-hidden font-sans"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-4 py-3 border-b border-white/10 bg-[#121422] flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2.5">
                <ScrollText className="w-4 h-4 text-blue-400" />
                <span className="font-mono text-xs font-bold text-white">
                  journalctl -u {selectedLogsService}
                </span>
                {/* Live Streaming Badge */}
                {isLiveStreaming ? (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-mono font-bold animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>LIVE (2s)</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-mono font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    <span>PAUSED</span>
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                {/* Start / Stop Toggle Button */}
                <button
                  onClick={() => setIsLiveStreaming(!isLiveStreaming)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-medium flex items-center space-x-1.5 border transition-all ${
                    isLiveStreaming
                      ? 'bg-amber-500/15 border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                  }`}
                  title={isLiveStreaming ? 'Pause live log stream' : 'Resume live log stream'}
                >
                  {isLiveStreaming ? (
                    <>
                      <Pause className="w-3.5 h-3.5" />
                      <span>Pause Live</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" />
                      <span>Start Live</span>
                    </>
                  )}
                </button>

                {/* Auto-Scroll Toggle Button */}
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`px-2.5 py-1 rounded-xl text-xs font-medium flex items-center space-x-1.5 border transition-all ${
                    autoScroll
                      ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Toggle automatic scrolling to latest log entries"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}</span>
                </button>

                {/* Lines Selector */}
                <select
                  value={logLinesCount}
                  onChange={(e) => {
                    const count = Number(e.target.value);
                    setLogLinesCount(count);
                    handleViewLogs(selectedLogsService, count);
                  }}
                  className="bg-[#101018] border border-white/10 rounded-xl px-2 py-1 text-xs text-gray-300 font-mono focus:outline-none"
                >
                  <option value="50">50 lines</option>
                  <option value="100">100 lines</option>
                  <option value="200">200 lines</option>
                  <option value="500">500 lines</option>
                </select>

                {/* Refresh Logs Button */}
                <button
                  onClick={() => handleViewLogs(selectedLogsService)}
                  disabled={isLogRefreshing}
                  className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
                  title="Reload Logs Now"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLogRefreshing ? 'animate-spin text-blue-400' : ''}`} />
                </button>

                {/* Copy Logs */}
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(logContent);
                    setActionNotice({ text: 'Logs copied to clipboard!', isError: false });
                    setTimeout(() => setActionNotice(null), 3000);
                  }}
                  className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
                  title="Copy to Clipboard"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>

                <button 
                  onClick={() => setSelectedLogsService(null)} 
                  className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Filter Search & Severity Toolbar */}
            <div className="px-4 py-2 bg-[#141624] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-3">
              <div className="flex items-center space-x-2 flex-1">
                <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Filter logs by keywords, timestamps, exit codes..."
                  value={logFilterQuery}
                  onChange={e => setLogFilterQuery(e.target.value)}
                  className="bg-transparent text-xs text-white placeholder-gray-500 focus:outline-none w-full font-mono"
                />
                {logFilterQuery && (
                  <button onClick={() => setLogFilterQuery('')} className="text-gray-500 hover:text-white text-xs">
                    Clear
                  </button>
                )}
              </div>

              {/* Severity Quick Filters */}
              <div className="flex items-center space-x-1 shrink-0 text-xs">
                <button
                  onClick={() => setLogSeverityFilter('all')}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                    logSeverityFilter === 'all' ? 'bg-white/20 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setLogSeverityFilter('error')}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                    logSeverityFilter === 'error' ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40' : 'text-gray-400 hover:text-rose-300'
                  }`}
                >
                  Errors
                </button>
                <button
                  onClick={() => setLogSeverityFilter('warn')}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                    logSeverityFilter === 'warn' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-gray-400 hover:text-amber-300'
                  }`}
                >
                  Warnings
                </button>
              </div>
            </div>

            {/* Logs Body with Auto-Scroll ref */}
            <div 
              ref={logsContainerRef}
              className="flex-1 p-4 bg-[#0d0f18] font-mono text-[11px] text-gray-300 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed scrollbar-thin"
            >
              {logContent.split('\n')
                .filter(line => {
                  if (logFilterQuery && !line.toLowerCase().includes(logFilterQuery.toLowerCase())) {
                    return false;
                  }
                  if (logSeverityFilter === 'error') {
                    return /error|failed|failure|crit|alert|emerg|exception/i.test(line);
                  }
                  if (logSeverityFilter === 'warn') {
                    return /warn|warning|notice/i.test(line);
                  }
                  return true;
                })
                .map((line, i) => {
                  const isError = /error|failed|failure|crit|alert|emerg|exception/i.test(line);
                  const isWarn = /warn|warning|notice/i.test(line);
                  return (
                    <div 
                      key={i} 
                      className={`py-0.5 px-1 rounded transition-colors ${
                        isError 
                          ? 'bg-rose-500/10 text-rose-300 font-medium border-l-2 border-rose-500' 
                          : isWarn 
                          ? 'bg-amber-500/5 text-amber-300 border-l-2 border-amber-500' 
                          : 'text-gray-300 hover:bg-white/[0.02]'
                      }`}
                    >
                      {line}
                    </div>
                  );
                })}
            </div>

            {/* Logs Footer with Stream Live in Terminal action */}
            <div className="px-4 py-2.5 bg-[#121422] border-t border-white/[0.08] flex items-center justify-between text-xs text-gray-400 shrink-0">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenTerminalLogs(selectedLogsService)}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl flex items-center space-x-1.5 transition-colors border border-white/10"
                  title="Open live journalctl in interactive terminal tab"
                >
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Stream Live in Terminal (journalctl -f)</span>
                </button>
                <button
                  onClick={() => handleEditServiceFile(selectedLogsService)}
                  className="px-3 py-1 bg-white/5 hover:bg-white/15 text-cyan-300 rounded-xl flex items-center space-x-1.5 transition-colors border border-cyan-500/20"
                  title="Edit service unit configuration"
                >
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Edit Unit File</span>
                </button>
              </div>

              <button
                onClick={() => setSelectedLogsService(null)}
                className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* macOS Detailed Service Inspector Modal */}
      {inspectService && (
        <div 
          className="absolute inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150"
          onClick={() => setInspectService(null)}
        >
          <div 
            className="bg-[#1c1d2e] border border-white/20 rounded-2xl w-full max-w-lg max-h-[calc(100%-1rem)] overflow-y-auto p-5 sm:p-6 shadow-2xl space-y-4 font-sans scrollbar-thin"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
                  <Server className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">{inspectService.name}</h3>
                  <div className="text-xs text-gray-400">{inspectService.description || 'Systemd Service Unit'}</div>
                </div>
              </div>
              <button
                onClick={() => setInspectService(null)}
                className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Status Output Console */}
            <div className="space-y-1.5">
              <div className="text-xs font-bold text-gray-300">systemctl status output:</div>
              <div className="bg-[#101018] p-3 rounded-2xl border border-white/10 font-mono text-[11px] text-gray-200 whitespace-pre-wrap max-h-56 overflow-y-auto select-text scrollbar-thin">
                {serviceStatusOutput}
              </div>
            </div>

            {/* Quick Actions inside Inspector */}
            <div className="flex items-center justify-between pt-3 border-t border-white/10">
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleViewLogs(inspectService.name)}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
                >
                  <ScrollText className="w-3.5 h-3.5 text-blue-400" />
                  <span>Logs</span>
                </button>
                <button
                  onClick={() => handleEditServiceFile(inspectService.name)}
                  className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
                >
                  <FileCode className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Edit File</span>
                </button>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleAction(inspectService.name, 'restart')}
                  className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow-sm active:scale-95 transition-all"
                >
                  Restart Unit
                </button>
                {inspectService.status === 'active' ? (
                  <button
                    onClick={() => handleAction(inspectService.name, 'stop')}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-sm active:scale-95 transition-all"
                  >
                    Stop Service
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction(inspectService.name, 'start')}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold shadow-sm active:scale-95 transition-all"
                  >
                    Start Service
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Service Unit File Modal */}
      {editingService && (
        <EditServiceModal
          serviceName={editingService}
          activeConnId={activeConnId}
          onClose={() => setEditingService(null)}
          onRestartService={async (name) => {
            await handleAction(name, 'restart');
          }}
          onReloadServices={loadServices}
        />
      )}

      {/* macOS Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-60 text-xs text-gray-200 font-sans select-none animate-in fade-in duration-100"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 340),
            left: Math.min(contextMenu.x, window.innerWidth - 260)
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3.5 py-1 text-[11px] font-bold text-gray-400 border-b border-white/10 mb-1 truncate">
            {contextMenu.service.name}
          </div>

          <div
            onClick={() => { handleInspect(contextMenu.service); setContextMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
          >
            <Eye className="w-3.5 h-3.5 text-blue-400" />
            <span>Inspect Status...</span>
          </div>

          <div
            onClick={() => { handleViewLogs(contextMenu.service.name); setContextMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <ScrollText className="w-3.5 h-3.5 text-blue-400" />
            <span>View Logs (journalctl)</span>
          </div>

          <div
            onClick={() => { handleEditServiceFile(contextMenu.service.name); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer text-cyan-300"
          >
            <FileCode className="w-3.5 h-3.5 text-cyan-400" />
            <span>Edit Service Unit File...</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          {contextMenu.service.status === 'active' ? (
            <div
              onClick={() => handleAction(contextMenu.service.name, 'stop')}
              className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white flex items-center space-x-2 cursor-pointer text-rose-300"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop Service</span>
            </div>
          ) : (
            <div
              onClick={() => handleAction(contextMenu.service.name, 'start')}
              className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer text-emerald-300"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start Service</span>
            </div>
          )}

          <div
            onClick={() => handleAction(contextMenu.service.name, 'restart')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <RotateCw className="w-3.5 h-3.5 text-amber-400" />
            <span>Restart Service</span>
          </div>

          <div
            onClick={() => handleAction(contextMenu.service.name, 'reload')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reload Configuration</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div
            onClick={() => handleAction(contextMenu.service.name, contextMenu.service.enabled ? 'disable' : 'enable')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            {contextMenu.service.enabled ? (
              <>
                <Unlock className="w-3.5 h-3.5 text-gray-400" />
                <span>Disable at Boot</span>
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5 text-blue-400" />
                <span>Enable at Boot</span>
              </>
            )}
          </div>

          <div
            onClick={() => handleOpenTerminalLogs(contextMenu.service.name)}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Stream Live in Terminal</span>
          </div>

          <div
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.service.name);
              setContextMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy Unit Name</span>
          </div>
        </div>
      )}
    </div>
  );
}
