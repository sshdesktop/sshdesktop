import React, { useState, useEffect, useCallback } from 'react';
import { 
  Container, Layers, Play, Square, RotateCw, Trash2, 
  Terminal, Search, Plus, RefreshCw, AlertCircle, FileText
} from 'lucide-react';
import { dockerContainers, dockerAction, dockerLogs, dockerImages } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped';
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

export default function DockerManager() {
  const [activeTab, setActiveTab] = useState<'containers' | 'images'>('containers');
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [search, setSearch] = useState('');
  const [selectedLogs, setSelectedLogs] = useState<ContainerItem | null>(null);
  const [logsText, setLogsText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadDockerData = useCallback(async () => {
    setIsLoading(true);
    try {
      const cList = await dockerContainers(activeConnId);
      if (cList && Array.isArray(cList)) {
        setContainers(cList.map((c: any) => ({
          id: (c.id || '').slice(0, 12),
          name: (c.name || 'container').replace(/^\//, ''),
          image: c.image || '',
          status: c.state === 'running' || (c.status || '').toLowerCase().includes('up') ? 'running' : 'stopped',
          statusText: c.status || 'Active',
          ports: c.ports || '—',
          created: c.created || 'Recently',
          cpu: `${c.cpu_percent || 0.0}%`,
          mem: c.mem_usage || '—',
        })));
      } else {
        setContainers([]);
      }

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
    } catch (err) {
      console.warn('Docker load failed:', err);
      setContainers([]);
      setImages([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadDockerData();
  }, [loadDockerData]);

  const handleAction = async (id: string, action: string) => {
    try {
      await dockerAction(activeConnId, id, action);
      await loadDockerData();
    } catch (err) {
      alert(`Docker action failed: ${err}`);
    }
  };

  const openLogs = async (container: ContainerItem) => {
    setSelectedLogs(container);
    setLogsText('Fetching container logs from server...');
    try {
      const out = await dockerLogs(activeConnId, container.id, 100);
      setLogsText(out || 'No log output produced by container.');
    } catch (err: any) {
      setLogsText(`Error reading logs: ${err?.message || err}`);
    }
  };

  const runningCount = containers.filter(c => c.status === 'running').length;

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Containers</span>
            <Container className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-bold mt-1">{isLoading ? '...' : containers.length}</div>
          <div className="text-[11px] text-emerald-400 mt-0.5">{runningCount} Running</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Images</span>
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold mt-1">{isLoading ? '...' : images.length}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Local Docker Storage</div>
        </div>
      </div>

      {/* Tabs and Controls */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('containers')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'containers' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Containers ({containers.length})
          </button>
          <button
            onClick={() => setActiveTab('images')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'images' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Images ({images.length})
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-48"
            />
          </div>

          <button
            onClick={loadDockerData}
            disabled={isLoading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Docker"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Containers View */}
      {activeTab === 'containers' && (
        <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3">Image</th>
                  <th className="py-2.5 px-3">Ports</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {containers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    {isLoading ? 'Querying docker daemon...' : 'No docker containers found on this server'}
                  </td>
                </tr>
              ) : (
                containers
                  .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase()))
                  .map(container => (
                    <tr key={container.id} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          container.status === 'running' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {container.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-white">{container.name}</td>
                      <td className="py-2.5 px-3 text-gray-400 font-mono">{container.image}</td>
                      <td className="py-2.5 px-3 text-gray-400 font-mono text-[11px]">{container.ports}</td>
                      <td className="py-2.5 px-3 text-right space-x-1">
                        <button
                          onClick={() => handleAction(container.id, container.status === 'running' ? 'stop' : 'start')}
                          className={`p-1.5 rounded hover:bg-white/10 ${
                            container.status === 'running' ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                          title={container.status === 'running' ? 'Stop Container' : 'Start Container'}
                        >
                          {container.status === 'running' ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => handleAction(container.id, 'restart')}
                          className="p-1.5 rounded hover:bg-white/10 text-cyan-400"
                          title="Restart Container"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => openLogs(container)}
                          className="p-1.5 rounded hover:bg-white/10 text-blue-400"
                          title="View Live Logs"
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleAction(container.id, 'rm -f')}
                          className="p-1.5 rounded hover:bg-white/10 text-red-400"
                          title="Force Delete"
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

      {/* Images View */}
      {activeTab === 'images' && (
        <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Repository</th>
                  <th className="py-2.5 px-3">Tag</th>
                  <th className="py-2.5 px-3">Image ID</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Created</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {images.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-500">
                    {isLoading ? 'Querying docker images...' : 'No docker images found'}
                  </td>
                </tr>
              ) : (
                images.map(img => (
                  <tr key={img.id} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-medium text-white">{img.repository}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-400">{img.tag}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-500">{img.id}</td>
                    <td className="py-2.5 px-3 text-gray-300">{img.size}</td>
                    <td className="py-2.5 px-3 text-gray-400">{img.created}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Logs Modal */}
      {selectedLogs && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col h-96">
            <div className="flex items-center justify-between px-4 py-3 bg-[#11111b] border-b border-white/[0.08]">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="font-semibold text-xs font-mono text-white">docker logs {selectedLogs.name}</span>
              </div>
              <button
                onClick={() => setSelectedLogs(null)}
                className="text-gray-400 hover:text-white text-xs px-2 py-1 rounded bg-white/5"
              >
                Close
              </button>
            </div>
            <div className="flex-1 p-3 font-mono text-xs text-gray-300 bg-[#11111b] overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
