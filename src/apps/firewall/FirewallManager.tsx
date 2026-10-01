import React, { useState, useEffect, useCallback } from 'react';
import { Flame, ShieldCheck, ShieldAlert, Plus, Trash2, Power, RotateCw, CheckCircle2, RefreshCw } from 'lucide-react';
import { firewallStatus, firewallRules, firewallAddRule, firewallDeleteRule, firewallToggle } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface FirewallRule {
  id: string;
  number: number;
  port: string;
  proto: 'TCP' | 'UDP' | 'BOTH';
  action: 'ALLOW' | 'DENY';
  source: string;
  comment: string;
}

export default function FirewallManager() {
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState<{
    port: string;
    proto: 'TCP' | 'UDP' | 'BOTH';
    action: 'ALLOW' | 'DENY';
    source: string;
    comment: string;
  }>({
    port: '',
    proto: 'TCP',
    action: 'ALLOW',
    source: 'Anywhere',
    comment: ''
  });
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadFirewall = useCallback(async () => {
    setLoading(true);
    try {
      const [statusStr, rList] = await Promise.all([
        firewallStatus(activeConnId),
        firewallRules(activeConnId)
      ]);

      setEnabled(statusStr.toLowerCase().includes('active'));

      if (rList && Array.isArray(rList)) {
        setRules(rList.map((r: any, idx: number) => ({
          id: String(r.number || idx + 1),
          number: r.number || idx + 1,
          port: String(r.to_port || r.port || 'Any'),
          proto: (r.protocol || 'TCP').toUpperCase() as any,
          action: (r.action || 'ALLOW').toUpperCase() as any,
          source: r.from_ip || r.source || 'Anywhere',
          comment: r.comment || ''
        })));
      }
    } catch (err) {
      console.warn('Failed to load firewall:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadFirewall();
  }, [loadFirewall]);

  const handleToggle = async () => {
    const nextState = !enabled;
    try {
      await firewallToggle(activeConnId, nextState);
      setEnabled(nextState);
    } catch (err) {
      console.warn('Failed to toggle firewall:', err);
    }
  };

  const deleteRule = async (ruleNum: number) => {
    if (!confirm(`Are you sure you want to delete firewall rule #${ruleNum}?`)) return;
    try {
      await firewallDeleteRule(activeConnId, ruleNum);
      await loadFirewall();
    } catch (err) {
      console.warn('Failed to delete rule:', err);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.port) return;
    try {
      await firewallAddRule(activeConnId, newRule.port, newRule.proto.toLowerCase(), newRule.action.toLowerCase());
      setShowAdd(false);
      setNewRule({ port: '', proto: 'TCP', action: 'ALLOW', source: 'Anywhere', comment: '' });
      await loadFirewall();
    } catch (err) {
      console.warn('Failed to add rule:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Status banner */}
      <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className={`p-2.5 rounded-xl ${enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base text-white">Linux Firewall (UFW / Iptables)</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}>
                {enabled ? 'ACTIVE' : 'DISABLED'}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Default policy: Incoming (DENY), Outgoing (ALLOW)
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadFirewall}
            disabled={loading}
            className="p-1.5 bg-[#11111b] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Firewall"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={handleToggle}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              enabled ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{enabled ? 'Disable Firewall' : 'Enable Firewall'}</span>
          </button>

          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center space-x-1.5 bg-[var(--accent)] hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Rule</span>
          </button>
        </div>
      </div>

      {/* Rules Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3">#</th>
              <th className="py-2.5 px-3">Port / Service</th>
              <th className="py-2.5 px-3">Protocol</th>
              <th className="py-2.5 px-3">Action</th>
              <th className="py-2.5 px-3">Allowed From</th>
              <th className="py-2.5 px-3">Comment</th>
              <th className="py-2.5 px-3 text-right">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {rules.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-500">
                  {loading ? 'Checking server firewall rules...' : 'No active rules configured'}
                </td>
              </tr>
            ) : (
              rules.map(rule => (
                <tr key={rule.id} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-3 font-mono text-gray-500">{rule.number}</td>
                  <td className="py-2.5 px-3 font-mono font-bold text-white">{rule.port}</td>
                  <td className="py-2.5 px-3 font-mono text-gray-400">{rule.proto}</td>
                  <td className="py-2.5 px-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      rule.action === 'ALLOW' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {rule.action}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-gray-300">{rule.source}</td>
                  <td className="py-2.5 px-3 text-gray-400">{rule.comment || '—'}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => deleteRule(rule.number)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
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

      {/* Add Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleAdd} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Add Firewall Rule</h3>
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 block mb-1">Port</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 8080"
                    value={newRule.port}
                    onChange={e => setNewRule({ ...newRule, port: e.target.value })}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">Protocol</label>
                  <select
                    value={newRule.proto}
                    onChange={e => setNewRule({ ...newRule, proto: e.target.value as any })}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                  >
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                    <option value="BOTH">BOTH</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Action</label>
                <select
                  value={newRule.action}
                  onChange={e => setNewRule({ ...newRule, action: e.target.value as any })}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                >
                  <option value="ALLOW">ALLOW</option>
                  <option value="DENY">DENY</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Source IP / Subnet</label>
                <input
                  type="text"
                  value={newRule.source}
                  onChange={e => setNewRule({ ...newRule, source: e.target.value })}
                  placeholder="Anywhere or 192.168.1.0/24"
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Comment</label>
                <input
                  type="text"
                  value={newRule.comment}
                  onChange={e => setNewRule({ ...newRule, comment: e.target.value })}
                  placeholder="e.g. Development Server Port"
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
              >
                Apply Rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
