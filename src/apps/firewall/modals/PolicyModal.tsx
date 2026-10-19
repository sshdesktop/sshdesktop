import React, { useState } from 'react';
import { X, Sliders, Shield, AlertCircle, AlertTriangle } from 'lucide-react';
import { firewallSetDefaultPolicy } from '../../../lib/tauri-bridge';

interface PolicyModalProps {
  connId: string;
  defaultIncoming: string;
  defaultOutgoing: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function PolicyModal({
  connId,
  defaultIncoming,
  defaultOutgoing,
  onClose,
  onSuccess,
}: PolicyModalProps) {
  const [incoming, setIncoming] = useState(defaultIncoming || 'deny');
  const [outgoing, setOutgoing] = useState(defaultOutgoing || 'allow');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await firewallSetDefaultPolicy(connId, 'incoming', (incoming === 'allow' ? 'allow' : 'deny'));
      await firewallSetDefaultPolicy(connId, 'outgoing', (outgoing === 'deny' ? 'deny' : 'allow'));
      onSuccess(`Default policies updated: Incoming=${incoming.toUpperCase()}, Outgoing=${outgoing.toUpperCase()}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Default Firewall Policies</h3>
              <p className="text-xs text-gray-400">Configure global inbound and outbound traffic rules</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Default Incoming Policy</label>
            <select
              value={incoming}
              onChange={(e) => setIncoming(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
            >
              <option value="deny">DENY (Drop all unallowed incoming packets — Recommended)</option>
              <option value="reject">REJECT (Reject all incoming packets with ICMP)</option>
              <option value="allow">ALLOW (Permit all incoming packets unless blocked)</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Default Outgoing Policy</label>
            <select
              value={outgoing}
              onChange={(e) => setOutgoing(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
            >
              <option value="allow">ALLOW (Permit server to make outbound connections — Recommended)</option>
              <option value="deny">DENY (Block all outgoing connections)</option>
            </select>
          </div>

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
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
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all"
            >
              {loading ? 'Saving...' : 'Apply Policies'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
