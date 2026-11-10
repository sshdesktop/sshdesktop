import React, { useState } from 'react';
import {
  X, Plus, Shield, AlertCircle, AlertTriangle, Check, Layers, Radio, Tag
} from 'lucide-react';
import { FirewallRuleItem, firewallAddRuleAdvanced, AddRuleRequest } from '../../../lib/tauri-bridge';

interface AddRuleModalProps {
  connId: string;
  backend: string;
  zones: string[];
  initialRule?: FirewallRuleItem | null;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

const COMMON_SERVICES = [
  { name: 'SSH', port: '22', proto: 'TCP', desc: 'Secure Shell remote access' },
  { name: 'HTTP', port: '80', proto: 'TCP', desc: 'Web traffic' },
  { name: 'HTTPS', port: '443', proto: 'TCP', desc: 'Encrypted web traffic' },
  { name: 'MySQL', port: '3306', proto: 'TCP', desc: 'MySQL / MariaDB database' },
  { name: 'Postgres', port: '5432', proto: 'TCP', desc: 'PostgreSQL database' },
  { name: 'Redis', port: '6379', proto: 'TCP', desc: 'In-memory cache & store' },
  { name: 'DNS', port: '53', proto: 'UDP', desc: 'Domain Name System' },
  { name: 'WireGuard', port: '51820', proto: 'UDP', desc: 'VPN Tunnel' },
  { name: 'RDP', port: '3389', proto: 'TCP', desc: 'Remote Desktop Protocol' },
  { name: 'Cockpit', port: '9090', proto: 'TCP', desc: 'Linux Admin Web Console' },
];

export default function AddRuleModal({
  connId,
  backend,
  zones,
  initialRule,
  onClose,
  onSuccess,
}: AddRuleModalProps) {
  const isEditing = !!initialRule;

  const [port, setPort] = useState(initialRule?.to_port || '');
  const [protocol, setProtocol] = useState(initialRule?.protocol?.toUpperCase() || 'TCP');
  const [action, setAction] = useState(initialRule?.action?.toUpperCase() || 'ALLOW');
  const [direction, setDirection] = useState(initialRule?.direction?.toUpperCase() || 'IN');
  const [fromIp, setFromIp] = useState(initialRule?.from_ip && initialRule.from_ip !== 'Anywhere' ? initialRule.from_ip : 'Anywhere');
  const [zone, setZone] = useState(initialRule?.zone || (zones.length > 0 ? zones[0] : 'public'));
  const [comment, setComment] = useState(initialRule?.comment || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSshPort = port === '22' || port.toLowerCase() === 'ssh';
  const isBlockingSsh = isSshPort && (action === 'DENY' || action === 'REJECT');

  const handleSelectPreset = (preset: typeof COMMON_SERVICES[0]) => {
    setPort(preset.port);
    setProtocol(preset.proto);
    if (!comment) setComment(preset.desc);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!port.trim()) {
      setError('Please enter a valid port or service name.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload: AddRuleRequest = {
        port: port.trim(),
        protocol: protocol.toLowerCase(),
        action: action.toLowerCase(),
        direction: direction.toLowerCase(),
        from_ip: fromIp.trim() === 'Anywhere' ? undefined : fromIp.trim(),
        backend,
        zone: backend === 'firewalld' ? zone : undefined,
        comment: comment.trim() || undefined,
      };

      const res = await firewallAddRuleAdvanced(connId, payload);
      onSuccess(res || `Firewall rule ${action} ${port} saved successfully!`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {isEditing ? `Edit Firewall Rule #${initialRule.number}` : 'Add New Firewall Rule'}
              </h3>
              <p className="text-xs text-gray-400 font-mono">
                Target Backend: {backend.toUpperCase()} {backend === 'firewalld' ? `(Zone: ${zone})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {isBlockingSsh && (
          <div className="p-3 bg-amber-500/20 border border-amber-500/40 rounded-2xl text-xs text-amber-200 flex items-start space-x-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-amber-300 font-bold">Warning: SSH Port 22 Blocked!</strong>
              <p className="text-[11px] text-amber-200/80 mt-0.5">
                Blocking SSH port 22 may immediately disconnect your active remote session. Only proceed if you access this server over an alternative port or console.
              </p>
            </div>
          </div>
        )}

        {/* Quick Service Presets */}
        {!isEditing && (
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold text-gray-400">Quick Service Presets</span>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_SERVICES.map((srv) => (
                <button
                  key={srv.name}
                  type="button"
                  onClick={() => handleSelectPreset(srv)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-mono border transition-all ${
                    port === srv.port
                      ? 'bg-blue-600 text-white border-blue-400 shadow-sm'
                      : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
                  }`}
                  title={`${srv.desc} (${srv.port}/${srv.proto})`}
                >
                  {srv.name} ({srv.port})
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Port and Protocol */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1.5">
              <label className="font-medium text-gray-300">Port, Range, or Service</label>
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="e.g. 80, 8080:8090, or ssh"
                required
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Protocol</label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="TCP">TCP</option>
                <option value="UDP">UDP</option>
                <option value="ANY">ANY (Both)</option>
              </select>
            </div>
          </div>

          {/* Action & Direction */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Action Policy</label>
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
                className={`w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none font-bold ${
                  action === 'ALLOW' ? 'text-emerald-400' : action === 'DENY' ? 'text-rose-400' : 'text-amber-400'
                }`}
              >
                <option value="ALLOW">ALLOW (Accept traffic)</option>
                <option value="DENY">DENY (Silently drop)</option>
                <option value="REJECT">REJECT (Drop with ICMP reply)</option>
                <option value="LIMIT">LIMIT (Rate limit brute-force)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Direction</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="IN">Inbound (Incoming Traffic)</option>
                <option value="OUT">Outbound (Outgoing Traffic)</option>
              </select>
            </div>
          </div>

          {/* Source IP / Subnet */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="font-medium text-gray-300">Source IP / CIDR Subnet</label>
              <button
                type="button"
                onClick={() => setFromIp('Anywhere')}
                className="text-[10px] text-blue-400 hover:underline"
              >
                Reset to Anywhere
              </button>
            </div>
            <input
              type="text"
              value={fromIp}
              onChange={(e) => setFromIp(e.target.value)}
              placeholder="Anywhere, 192.168.1.0/24, or 10.0.0.5"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
            />
          </div>

          {/* Firewalld Zone selection */}
          {backend === 'firewalld' && zones.length > 0 && (
            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Firewalld Target Zone</label>
              <select
                value={zone}
                onChange={(e) => setZone(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                {zones.map(z => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </select>
            </div>
          )}

          {/* Comment */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Comment / Note (Optional)</label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Production Web Server, Admin VPN"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white placeholder-gray-600"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
            >
              {loading ? <span>Saving...</span> : <span>{isEditing ? 'Save Changes' : 'Add Rule'}</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
