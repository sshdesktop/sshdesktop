import React, { useState } from 'react';
import { ShieldAlert, HelpCircle, ChevronDown, ChevronUp, Terminal, Shield, Lock } from 'lucide-react';
import { useUserPrivilege } from '../lib/permissions';

interface PermissionAlertBannerProps {
  appName: string;
  customMessage?: string;
  className?: string;
}

export default function PermissionAlertBanner({
  appName,
  customMessage,
  className = '',
}: PermissionAlertBannerProps) {
  const { hasSudo, isRoot, username, uid } = useUserPrivilege();
  const [showHelp, setShowHelp] = useState(false);

  // If user is root or has sudo, do not show this banner
  if (hasSudo || isRoot) {
    return null;
  }

  return (
    <div className={`mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-900 dark:text-amber-200 shadow-sm backdrop-blur-sm transition-all ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-amber-950 dark:text-amber-100">
                Standard User Mode (No Sudo Rights)
              </span>
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono font-medium text-amber-800 dark:text-amber-300">
                {username} (UID: {uid})
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-300/90">
              {customMessage || (
                <>
                  You are logged in as an unprivileged user. Standard data and read-only metrics in <span className="font-medium text-amber-950 dark:text-amber-100">{appName}</span> are displayed below. Administrative modifications require administrator (sudo) privileges.
                </>
              )}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowHelp(prev => !prev)}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/15 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 transition-colors"
        >
          <HelpCircle className="h-3 w-3" />
          <span>Sudo Help</span>
          {showHelp ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      </div>

      {showHelp && (
        <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-950/30 p-2.5 text-[11px] text-amber-200/90 font-mono space-y-1.5">
          <div className="font-sans font-semibold text-amber-200 flex items-center gap-1.5">
            <Terminal className="h-3 w-3" />
            To grant administrator privileges to user &apos;{username}&apos;, run as root on your server:
          </div>
          <div className="rounded bg-black/40 px-2 py-1 text-[10.5px] select-all text-emerald-400">
            usermod -aG sudo {username} <span className="text-zinc-500"># Ubuntu / Debian</span>
          </div>
          <div className="rounded bg-black/40 px-2 py-1 text-[10.5px] select-all text-emerald-400">
            usermod -aG wheel {username} <span className="text-zinc-500"># Amazon Linux / RHEL / CentOS / Fedora</span>
          </div>
          <div className="text-[10px] text-amber-300/70 font-sans">
            Or reconnect in SSH Desktop as user <span className="font-bold text-amber-200">root</span> using your private key.
          </div>
        </div>
      )}
    </div>
  );
}
