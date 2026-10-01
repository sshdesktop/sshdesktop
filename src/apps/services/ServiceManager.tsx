import React, { useState, useEffect, useCallback } from 'react';
import { Server, Play, Square, RotateCw, CheckCircle, AlertTriangle, XCircle, Search, ScrollText, RefreshCw, X } from 'lucide-react';
import { serviceList, serviceAction, serviceLogs } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface ServiceItem {
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'failed';
  subState: string;
  enabled: boolean;
}

export default function ServiceManager() {
  const [services, setServices] = useState<ServiceItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive' | 'failed'>('all');
  const [search, setSearch] = useState('');
  const [selectedLogs, setSelectedLogs] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

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

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
    setActionInProgress(name);
    try {
      await serviceAction(activeConnId, name, action);
      await loadServices();
    } catch (err) {
      alert(`Action failed: ${err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleViewLogs = async (name: string) => {
    setSelectedLogs(name);
    setLogContent('Loading live journalctl logs...');
    try {
      const logs = await serviceLogs(activeConnId, name, 80);
      setLogContent(logs || 'No recent journalctl logs for this service');
    } catch (err) {
      setLogContent(`Error fetching logs: ${err}`);
    }
  };

  const filtered = services.filter(s => {
    if (filter === 'active') return s.status === 'active';
    if (filter === 'inactive') return s.status === 'inactive';
    if (filter === 'failed') return s.status === 'failed';
    return true;
  }).filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Total Services</div>
          <div className="text-xl font-bold mt-1">{isLoading ? '...' : services.length}</div>
        </div>
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Running</span>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-emerald-400">
            {isLoading ? '...' : services.filter(s => s.status === 'active').length}
          </div>
        </div>
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Failed</span>
            <XCircle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-rose-400">
            {isLoading ? '...' : services.filter(s => s.status === 'failed').length}
          </div>
        </div>
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Inactive</span>
            <AlertTriangle className="w-3.5 h-3.5 text-gray-500" />
          </div>
          <div className="text-xl font-bold mt-1 text-gray-400">
            {isLoading ? '...' : services.filter(s => s.status === 'inactive').length}
          </div>
        </div>
      </div>

      {/* Filter and Actions Bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          {(['all', 'active', 'failed', 'inactive'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === tab ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search services..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-56"
            />
          </div>

          <button
            onClick={loadServices}
            disabled={isLoading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Services"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Services List Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3">Service Unit</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3">State</th>
              <th className="py-2.5 px-3">Substate</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-500">
                  {isLoading ? 'Querying systemd via SSH...' : 'No systemd services found'}
                </td>
              </tr>
            ) : (
              filtered.map(service => (
                <tr key={service.name} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-mono font-bold text-white flex items-center space-x-2">
                    <Server className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>{service.name}</span>
                  </td>
                  <td className="py-2.5 px-3 text-gray-400 truncate max-w-md">{service.description || '—'}</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      service.status === 'active'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : service.status === 'failed'
                        ? 'bg-rose-500/20 text-rose-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {service.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-gray-500">{service.subState}</td>
                  <td className="py-2.5 px-3 text-right space-x-1">
                    <button
                      onClick={() => handleViewLogs(service.name)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
                      title="View Logs (journalctl)"
                    >
                      <ScrollText className="w-3.5 h-3.5" />
                    </button>
                    {service.status === 'active' ? (
                      <button
                        onClick={() => handleAction(service.name, 'stop')}
                        disabled={actionInProgress === service.name}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-amber-400"
                        title="Stop Service"
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(service.name, 'start')}
                        disabled={actionInProgress === service.name}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-emerald-400"
                        title="Start Service"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(service.name, 'restart')}
                      disabled={actionInProgress === service.name}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-blue-400"
                      title="Restart Service"
                    >
                      <RotateCw className={`w-3.5 h-3.5 ${actionInProgress === service.name ? 'animate-spin' : ''}`} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Logs Modal */}
      {selectedLogs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-3xl h-[480px] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-3 border-b border-white/[0.08] flex items-center justify-between bg-[#181825]">
              <span className="font-mono text-xs font-bold text-white">journalctl -u {selectedLogs}</span>
              <button onClick={() => setSelectedLogs(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-4 bg-[#11111b] font-mono text-xs text-gray-300 overflow-y-auto whitespace-pre-wrap select-text">
              {logContent}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
