import React, { useState } from 'react';
import { Network, X, Plus, Loader2 } from 'lucide-react';

interface DockerNetworkCreateModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (networkData: {
    name: string;
    driver: string;
    subnet: string;
    gateway: string;
    ipRange: string;
    internal: boolean;
    attachable: boolean;
    ipv6: boolean;
  }) => Promise<void>;
}

export const DockerNetworkCreateModal: React.FC<DockerNetworkCreateModalProps> = ({
  isOpen,
  isSubmitting,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [ipRange, setIpRange] = useState('');
  const [internal, setInternal] = useState(false);
  const [attachable, setAttachable] = useState(false);
  const [ipv6, setIpv6] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onCreate({
      name: name.trim(),
      driver,
      subnet: subnet.trim(),
      gateway: gateway.trim(),
      ipRange: ipRange.trim(),
      internal,
      attachable,
      ipv6,
    });
    setName('');
    setSubnet('');
    setGateway('');
    setIpRange('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Network className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Create Docker Network</h3>
              <p className="text-[11px] text-gray-400">Configure bridge, overlay or custom container network</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3.5">
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Network Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="e.g. app_isolated_net"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver</label>
            <select
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#14141e] border border-white/10 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="bridge">bridge (default standalone)</option>
              <option value="overlay">overlay (swarm multi-host)</option>
              <option value="macvlan">macvlan (physical MAC assignment)</option>
              <option value="ipvlan">ipvlan (L2/L3 virtual LAN)</option>
              <option value="host">host (native host interface)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Subnet (CIDR)</label>
              <input
                type="text"
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="172.28.0.0/16"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Gateway</label>
              <input
                type="text"
                value={gateway}
                onChange={(e) => setGateway(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="172.28.0.1"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">IP Range (Optional)</label>
            <input
              type="text"
              value={ipRange}
              onChange={(e) => setIpRange(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="172.28.5.0/24"
            />
          </div>

          <div className="flex items-center space-x-4 pt-1">
            <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={internal}
                onChange={(e) => setInternal(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <span>Internal Network</span>
            </label>
            <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={attachable}
                onChange={(e) => setAttachable(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <span>Attachable</span>
            </label>
            <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={ipv6}
                onChange={(e) => setIpv6(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <span>IPv6</span>
            </label>
          </div>

          <div className="pt-3 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{isSubmitting ? 'Creating...' : 'Create Network'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
