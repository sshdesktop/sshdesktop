import React from 'react';
import { ShieldAlert, X, AlertTriangle, Key } from 'lucide-react';

interface PermissionAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  actionName: string;
  username: string;
  appName?: string;
}

export default function PermissionAlertModal({
  isOpen,
  onClose,
  actionName,
  username,
  appName,
}: PermissionAlertModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div 
        className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-500/40 bg-zinc-900 text-zinc-100 shadow-2xl animate-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 bg-amber-500/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100">
                Administrator Privileges Required
              </h3>
              {appName && (
                <span className="text-[11px] text-zinc-400">{appName}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3.5 text-xs text-zinc-300">
          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-3.5 flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold text-amber-200">
                Action Restricted: {actionName}
              </span>
              <p className="text-[11.5px] text-amber-300/80 leading-relaxed">
                Logged-in user <span className="font-mono font-bold text-amber-100">{username}</span> does not have <span className="font-semibold text-white">sudo</span> rights on this server.
              </p>
            </div>
          </div>

          <p className="text-[11.5px] text-zinc-400 leading-relaxed">
            Standard unprivileged users can view system data and monitor status, but cannot execute administrative operations such as altering firewall rules, stopping/starting services, installing packages, or managing system users.
          </p>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2.5 space-y-1 text-[11px] font-mono text-zinc-400">
            <div className="text-zinc-300 font-sans font-medium flex items-center gap-1.5">
              <Key className="h-3 w-3 text-amber-400" />
              How to perform this action:
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-zinc-400 pl-1 font-sans">
              <li>Connect to SSH Desktop as <span className="font-mono text-amber-200">root</span> using your private key.</li>
              <li>Ask the server administrator to add <span className="font-mono text-amber-200">{username}</span> to the <span className="font-mono text-zinc-300">sudo</span> or <span className="font-mono text-zinc-300">wheel</span> group.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-zinc-800 bg-zinc-900/80 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 px-4 py-1.5 text-xs font-semibold shadow transition-colors"
          >
            Understood
          </button>
        </div>
      </div>
    </div>
  );
}
