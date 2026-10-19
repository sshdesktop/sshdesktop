import React, { useState } from 'react';
import { X, Trash2, AlertTriangle, AlertCircle } from 'lucide-react';
import { FirewallRuleItem, firewallDeleteRuleAdvanced } from '../../../lib/tauri-bridge';

interface DeleteRuleModalProps {
  connId: string;
  rule: FirewallRuleItem;
  backend: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function DeleteRuleModal({
  connId,
  rule,
  backend,
  onClose,
  onSuccess,
}: DeleteRuleModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSsh = rule.to_port === '22' || rule.to_port.toLowerCase() === 'ssh';

  const handleDelete = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await firewallDeleteRuleAdvanced(
        connId,
        rule.number,
        rule.to_port,
        rule.protocol,
        backend,
        rule.zone
      );
      onSuccess(res || `Rule #${rule.number} deleted successfully.`);
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
        <div className="flex items-center space-x-3 pb-3 border-b border-white/10">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
            <Trash2 className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-white">Delete Firewall Rule</h3>
            <p className="text-xs text-gray-400 font-mono">
              Rule #{rule.number} • {rule.to_port}/{rule.protocol}
            </p>
          </div>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <div className="space-y-3 text-xs">
          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl space-y-1.5">
            <div className="flex justify-between py-0.5 border-b border-white/5">
              <span className="text-gray-400">Port / Service:</span>
              <span className="font-mono text-white font-bold">{rule.to_port}</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-white/5">
              <span className="text-gray-400">Protocol:</span>
              <span className="font-mono text-purple-300 uppercase">{rule.protocol}</span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-white/5">
              <span className="text-gray-400">Action:</span>
              <span className={`font-bold ${rule.action === 'ALLOW' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {rule.action}
              </span>
            </div>
            <div className="flex justify-between py-0.5">
              <span className="text-gray-400">Source:</span>
              <span className="font-mono text-blue-300">{rule.from_ip}</span>
            </div>
          </div>

          {isSsh && (
            <div className="p-3 bg-amber-500/20 border border-amber-500/40 rounded-2xl text-amber-200 flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-amber-300 font-bold">Warning: SSH Access Rule</strong>
                <p className="text-[11px] text-amber-200/80 mt-0.5">
                  Removing this rule may lock you out of SSH if the default firewall policy denies incoming traffic!
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium transition-colors text-xs"
            >
              Cancel
            </button>
            <button
              onClick={handleDelete}
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all text-xs"
            >
              {loading ? 'Deleting...' : 'Delete Rule'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
