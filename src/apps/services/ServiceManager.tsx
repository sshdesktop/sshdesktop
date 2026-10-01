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

const INITIAL_SERVICES: ServiceItem[] = [
  { name: 'ssh.service', description: 'OpenBSD Secure Shell server', status: 'active', subState: 'running', enabled: true },
  { name: 'nginx.service', description: 'A high performance web server and reverse proxy', status: 'active', subState: 'running', enabled: true },
  { name: 'docker.service', description: 'Docker Application Container Engine', status: 'active', subState: 'running', enabled: true },
  { name: 'postgresql.service', description: 'PostgreSQL RDBMS Server', status: 'active', subState: 'running', enabled: true },
  { name: 'redis-server.service', description: 'Advanced key-value store', status: 'inactive', subState: 'dead', enabled: false },
  { name: 'cron.service', description: 'Regular background program processing daemon', status: 'active', subState: 'running', enabled: true },
  { name: 'ufw.service', description: 'Uncomplicated firewall', status: 'active', subState: 'exited', enabled: true },
  { name: 'fail2ban.service', description: 'Fail2ban Service', status: 'active', subState: 'running', enabled: true },
  { name: 'apache2.service', description: 'The Apache HTTP Server', status: 'inactive', subState: 'dead', enabled: false },
  { name: 'certbot.timer', description: 'Run certbot twice daily', status: 'active', subState: 'waiting', enabled: true },
  { name: 'systemd-resolved.service', description: 'Network Name Resolution', status: 'active', subState: 'running', enabled: true }
];

export default function ServiceManager() {
  const [services, setServices] = useState<ServiceItem[]>(INITIAL_SERVICES);
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
      if (list && list.length > 0) {
        setServices(list.map((item: any) => ({
          name: item.name,
          description: item.description,
          status: item.active_state === 'active' ? 'active' : item.active_state === 'failed' ? 'failed' : 'inactive',
          subState: item.sub_state,
          enabled: item.enabled,
        })));
      }
    } catch {}
    setIsLoading(false);
  }, [activeConnId]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const handleAction = async (name: string, action: 'start' | 'stop' | 'restart') => {
    setActionInProgress(name);
    try {
      await serviceAction(activeConnId, name, action);
      // Optimistically update
      setServices(prev =>
        prev.map(s => {
          if (s.name === name) {
            const nextStatus = action === 'stop' ? 'inactive' : 'active';
            const nextSub = action === 'stop' ? 'dead' : 'running';
            return { ...s, status: nextStatus, subState: nextSub };
          }
          return s;
        })
      );
    } catch (err) {
      console.warn('Service action failed:', err);
    } finally {
      setActionInProgress(null);
      // Refresh live after 1s
      setTimeout(loadServices, 1000);
    }
  };

  const openLogs = async (name: string) => {
    setSelectedLogs(name);
    setLogContent('Loading live journalctl logs from server...');
    try {
      const out = await serviceLogs(activeConnId, name, 60);
      setLogContent(out || 'No log entries found for this service.');
    } catch (err: any) {
      setLogContent(`Failed to retrieve logs: ${err?.message || err}`);
    }
  };

  const filtered = services.filter(s => {
    const matchesFilter = filter === 'all' || s.status === filter;
    const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const activeCount = services.filter(s => s.status === 'active').length;
  const inactiveCount = services.filter(s => s.status === 'inactive').length;
  const failedCount = services.filter(s => s.status === 'failed').length;

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Total Units</div>
          <div className="text-xl font-bold mt-1">{services.length}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">systemd units</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Active</span>
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-emerald-400">{activeCount}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Running normally</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Inactive</span>
            <XCircle className="w-3.5 h-3.5 text-gray-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-gray-400">{inactiveCount}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Stopped / Exited</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Failed</span>
            <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-rose-400">{failedCount}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Needs attention</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex items-center justify-between space-x-3 shrink-0">
        <div className="flex items-center space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          {(['all', 'active', 'inactive', 'failed'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1 rounded-lg text-xs capitalize font-medium transition-colors ${
                filter === tab ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadServices}
            disabled={isLoading}
            className="p-2 rounded-xl bg-[#1e1e2e] border border-white/[0.08] hover:bg-white/5 text-gray-300 transition-colors"
            title="Refresh Services"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search services..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/[0.08] rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-[var(--accent)] w-60"
            />
          </div>
        </div>
      </div>

      {/* Services Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3">Status</th>
              <th className="py-2.5 px-3">Service Name</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3">Boot</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.map(service => (
              <tr key={service.name} className="hover:bg-white/[0.02] transition-colors">
                <td className="py-2.5 px-3">
                  <span className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    service.status === 'active'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : service.status === 'failed'
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      : 'bg-gray-500/10 text-gray-400 border border-gray-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      service.status === 'active' ? 'bg-emerald-400' : service.status === 'failed' ? 'bg-rose-400' : 'bg-gray-400'
                    }`} />
                    <span>{service.subState}</span>
                  </span>
                </td>
                <td className="py-2.5 px-3 font-mono font-medium text-white">{service.name}</td>
                <td className="py-2.5 px-3 text-gray-400 truncate max-w-xs">{service.description}</td>
                <td className="py-2.5 px-3">
                  <span className={`text-[11px] font-mono ${service.enabled ? 'text-blue-400' : 'text-gray-500'}`}>
                    {service.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="py-2.5 px-3 text-right space-x-1">
                  {actionInProgress === service.name ? (
                    <span className="text-[11px] text-blue-400 animate-pulse px-2">Executing...</span>
                  ) : (
                    <>
                      {service.status === 'active' ? (
                        <button
                          onClick={() => handleAction(service.name, 'stop')}
                          className="p-1.5 rounded hover:bg-white/10 text-amber-400 transition-colors"
                          title="Stop Service (systemctl stop)"
                        >
                          <Square className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(service.name, 'start')}
                          className="p-1.5 rounded hover:bg-white/10 text-emerald-400 transition-colors"
                          title="Start Service (systemctl start)"
                        >
                          <Play className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(service.name, 'restart')}
                        className="p-1.5 rounded hover:bg-white/10 text-blue-400 transition-colors"
                        title="Restart Service (systemctl restart)"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => openLogs(service.name)}
                        className="p-1.5 rounded hover:bg-white/10 text-gray-300 transition-colors"
                        title="View Journal Logs (journalctl -u)"
                      >
                        <ScrollText className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Logs Drawer Modal */}
      {selectedLogs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-96">
            <div className="flex items-center justify-between px-4 py-3 bg-[#11111b] border-b border-white/[0.08]">
              <div className="flex items-center space-x-2">
                <ScrollText className="w-4 h-4 text-blue-400" />
                <span className="font-mono text-xs font-bold text-white">journalctl -u {selectedLogs}</span>
              </div>
              <button
                onClick={() => setSelectedLogs(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-3 bg-[#11111b] overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
              {logContent}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
