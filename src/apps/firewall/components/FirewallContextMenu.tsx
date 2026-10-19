import React, { useEffect, useRef } from 'react';
import {
  Trash2, Edit, RefreshCw, Copy, ExternalLink, Zap, Lock, Radio, Sliders, Check
} from 'lucide-react';
import { FirewallRuleItem } from '../../../lib/tauri-bridge';

interface FirewallContextMenuProps {
  x: number;
  y: number;
  rule: FirewallRuleItem;
  backend: string;
  onClose: () => void;
  onDelete: (rule: FirewallRuleItem) => void;
  onEdit: (rule: FirewallRuleItem) => void;
  onToggleAction: (rule: FirewallRuleItem) => void;
  onTestPort?: (rule: FirewallRuleItem) => void;
}

export default function FirewallContextMenu({
  x,
  y,
  rule,
  backend,
  onClose,
  onDelete,
  onEdit,
  onToggleAction,
  onTestPort,
}: FirewallContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const posX = Math.min(x, window.innerWidth - 220);
  const posY = Math.min(y, window.innerHeight - 260);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onClose();
  };

  const getShellCommand = () => {
    const act = rule.action.toLowerCase();
    const port = rule.to_port;
    const proto = rule.protocol.toLowerCase();
    if (backend === 'firewalld') {
      return `sudo firewall-cmd --permanent --add-port=${port}/${proto} && sudo firewall-cmd --reload`;
    }
    return `sudo ufw ${act} ${port}/${proto}`;
  };

  return (
    <div
      ref={menuRef}
      style={{ left: posX, top: posY }}
      className="fixed z-50 w-56 bg-[#181825]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl py-1.5 text-xs text-gray-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between font-mono text-[11px] text-gray-400">
        <span className="font-bold text-white truncate">Rule #{rule.number}: {rule.to_port}</span>
        <span className={`text-[10px] uppercase px-1.5 py-0.2 rounded font-sans font-bold ${
          rule.action === 'ALLOW' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
        }`}>
          {rule.action}
        </span>
      </div>

      <div className="py-1">
        {/* Toggle Action */}
        <button
          onClick={() => { onToggleAction(rule); onClose(); }}
          className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-amber-300"
        >
          <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
          <span>Change to {rule.action === 'ALLOW' ? 'DENY' : 'ALLOW'}</span>
        </button>

        {/* Edit Rule */}
        <button
          onClick={() => { onEdit(rule); onClose(); }}
          className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-blue-300"
        >
          <Edit className="w-3.5 h-3.5 text-blue-400" />
          <span>Edit Rule...</span>
        </button>

        {/* Test Port */}
        {onTestPort && (
          <button
            onClick={() => { onTestPort(rule); onClose(); }}
            className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-emerald-300"
          >
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Check Listening Status</span>
          </button>
        )}

        <div className="my-1 border-t border-white/10" />

        {/* Copy Port */}
        <button
          onClick={() => copyToClipboard(rule.to_port)}
          className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
        >
          <Copy className="w-3.5 h-3.5 text-gray-400" />
          <span>Copy Port / Service</span>
        </button>

        {/* Copy Shell Command */}
        <button
          onClick={() => copyToClipboard(getShellCommand())}
          className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
        >
          <Copy className="w-3.5 h-3.5 text-gray-400" />
          <span>Copy Shell Command</span>
        </button>

        <div className="my-1 border-t border-white/10" />

        {/* Delete Rule */}
        <button
          onClick={() => { onDelete(rule); onClose(); }}
          className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-rose-500/20 text-left transition-colors text-rose-400 font-medium"
        >
          <Trash2 className="w-3.5 h-3.5 text-rose-400" />
          <span>Delete Rule</span>
        </button>
      </div>
    </div>
  );
}
