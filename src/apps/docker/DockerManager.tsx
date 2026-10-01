import React, { useState, useEffect, useCallback } from 'react';
import { 
  Container, Play, Square, RotateCw, Trash2, Terminal, 
  FileText, Plus, RefreshCw, Layers, HardDrive, Network as NetworkIcon, Search, X 
} from 'lucide-react';
import { dockerContainers, dockerAction, dockerLogs, dockerImages } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused';
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

const INITIAL_CONTAINERS: ContainerItem[] = [
  {
    id: 'c8f12a4b89e1',
    name: 'clouddesk-api',
    image: 'node:22-alpine',
    status: 'running',
    statusText: 'Up 18 hours',
    ports: '0.0.0.0:3000->3000/tcp',
    created: '2 days ago',
    cpu: '0.8%',
    mem: '64.2 MB'
  },
  {
    id: 'e92f1b88301a',
    name: 'clouddesk-proxy',
    image: 'nginx:stable-alpine',
    status: 'running',
    statusText: 'Up 18 hours',
    ports: '0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp',
    created: '2 days ago',
    cpu: '0.2%',
    mem: '14.5 MB'
  },
  {
    id: 'a10b44fe2899',
    name: 'clouddesk-db',
    image: 'postgres:16-alpine',
    status: 'running',
    statusText: 'Up 4 days',
    ports: '127.0.0.1:5432->5432/tcp',
    created: '4 days ago',
    cpu: '1.4%',
    mem: '142.8 MB'
  }
];

const INITIAL_IMAGES: ImageItem[] = [
  { id: 'sha256:7f10b2', repository: 'node', tag: '22-alpine', size: '188 MB', created: '2 weeks ago' },
  { id: 'sha256:4a81bc', repository: 'nginx', tag: 'stable-alpine', size: '42 MB', created: '3 weeks ago' },
  { id: 'sha256:10e4a9', repository: 'postgres', tag: '16-alpine', size: '379 MB', created: '1 month ago' },
  { id: 'sha256:bc31f9', repository: 'redis', tag: '7.2-alpine', size: '45 MB', created: '1 month ago' }
];

export default function DockerManager() {
  const [activeTab, setActiveTab] = useState<'containers' | 'images' | 'volumes' | 'networks'>('containers');
  const [containers, setContainers] = useState<ContainerItem[]>(INITIAL_CONTAINERS);
  const [images, setImages] = useState<ImageItem[]>(INITIAL_IMAGES);
  const [search, setSearch] = useState('');
  const [selectedLogs, setSelectedLogs] = useState<ContainerItem | null>(null);
  const [logsText, setLogsText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadDockerData = useCallback(async () => {
    setIsLoading(true);
    try {
      const cList = await dockerContainers(activeConnId);
      if (cList && cList.length > 0) {
        setContainers(cList.map((c: any) => ({
          id: c.id.slice(0, 12),
          name: c.name.replace(/^\//, ''),
          image: c.image,
          status: c.state === 'running' || c.status.toLowerCase().includes('up') ? 'running' : 'stopped',
          statusText: c.status,
          ports: c.ports || '—',
          created: c.created || 'Recently',
          cpu: `${c.cpu_percent || 0.5}%`,
          mem: c.mem_usage || '45 MB',
        })));
      }

      const imgList = await dockerImages(activeConnId);
      if (imgList && imgList.length > 0) {
        setImages(imgList.map((img: any) => ({
          id: img.id.slice(0, 12),
          repository: img.repository,
          tag: img.tag,
          size: img.size,
          created: img.created,
        })));
      }
    } catch {}
    setIsLoading(false);
  }, [activeConnId]);

  useEffect(() => {
    loadDockerData();
  }, [loadDockerData]);

  const handleAction = async (id: string, action: string) => {
    try {
      await dockerAction(activeConnId, id, action);
    } catch {}
    setTimeout(loadDockerData, 1000);
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
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Containers</span>
            <Container className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-bold mt-1">{containers.length}</div>
          <div className="text-[11px] text-emerald-400 mt-0.5">{runningCount} Running</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Images</span>
            <Layers className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-xl font-bold mt-1">{images.length}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">732 MB total</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Volumes</span>
            <HardDrive className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold mt-1">3</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Local storage</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Bridge Networks</span>
            <NetworkIcon className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-xl font-bold mt-1">2</div>
          <div className="text-[11px] text-gray-400 mt-0.5">Isolated nets</div>
        </div>
      </div>

      {/* Tabs & Search Bar */}
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
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[var(--accent)] w-48"
            />
          </div>
          <button className="flex items-center space-x-1 bg-[var(--accent)] hover:bg-blue-600 text-white text-xs px-2.5 py-1.5 rounded-lg transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span>Deploy</span>
          </button>
        </div>
      </div>

      {/* Main Table View */}
      {activeTab === 'containers' && (
        <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">Name</th>
                <th className="py-2.5 px-3">Image</th>
                <th className="py-2.5 px-3">Ports</th>
                <th className="py-2.5 px-3">CPU</th>
                <th className="py-2.5 px-3">Memory</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {containers
                .filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase()))
                .map(container => (
                  <tr key={container.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-2.5 px-3">
                      <span className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        container.status === 'running'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${container.status === 'running' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                        <span>{container.status}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-white">{container.name}</td>
                    <td className="py-2.5 px-3 text-gray-400 font-mono">{container.image}</td>
                    <td className="py-2.5 px-3 text-gray-400 font-mono text-[11px]">{container.ports}</td>
                    <td className="py-2.5 px-3 font-mono">{container.cpu}</td>
                    <td className="py-2.5 px-3 font-mono">{container.mem}</td>
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
                ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'images' && (
        <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">Repository</th>
                <th className="py-2.5 px-3">Tag</th>
                <th className="py-2.5 px-3">Image ID</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {images.map(img => (
                <tr key={img.id} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-3 font-medium text-white">{img.repository}</td>
                  <td className="py-2.5 px-3 font-mono text-gray-400">{img.tag}</td>
                  <td className="py-2.5 px-3 font-mono text-gray-500">{img.id}</td>
                  <td className="py-2.5 px-3 text-gray-300">{img.size}</td>
                  <td className="py-2.5 px-3 text-gray-400">{img.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <div className="flex-1 p-3 font-mono text-xs text-gray-300 bg-[#11111b] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {logsText}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
