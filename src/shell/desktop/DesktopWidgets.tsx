import React, { useState, useEffect } from 'react';
import { 
  Clock, HardDrive, Cpu, Activity, ShieldCheck, ShieldAlert, 
  RotateCcw, Sparkles, StickyNote, X, RefreshCw, Layers 
} from 'lucide-react';
import { useSettingsStore, useConnectionStore, useTelemetryStore } from '../../lib/store';
import { sshExec, sftpWriteTextFile, sftpMkdir } from '../../lib/tauri-bridge';
import { formatBytes } from '../../lib/utils';

interface DesktopWidgetsProps {
  showWidgetsTray: boolean;
  onCloseWidgetsTray: () => void;
  showStickiesWidget: boolean;
  setShowStickiesWidget: (val: boolean) => void;
  stickyNoteContent: string;
  onUpdateStickyNote: (content: string) => void;
  stickyColor: 'amber' | 'emerald' | 'purple' | 'rose' | 'blue';
  setStickyColor: (color: 'amber' | 'emerald' | 'purple' | 'rose' | 'blue') => void;
}

export default function DesktopWidgets({
  showWidgetsTray,
  onCloseWidgetsTray,
  showStickiesWidget,
  setShowStickiesWidget,
  stickyNoteContent,
  onUpdateStickyNote,
  stickyColor,
  setStickyColor,
}: DesktopWidgetsProps) {
  const { theme } = useSettingsStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const username = activeServer?.username || 'root';

  const cpu = useTelemetryStore(s => s.cpu);
  const ramPct = useTelemetryStore(s => s.ramPct);
  const ramUsed = useTelemetryStore(s => s.ramUsed);
  const ramTotal = useTelemetryStore(s => s.ramTotal);
  const diskPct = useTelemetryStore(s => s.diskPct);
  const diskUsed = useTelemetryStore(s => s.diskUsed);
  const diskTotal = useTelemetryStore(s => s.diskTotal);
  const loadAvg = useTelemetryStore(s => s.loadAvg);
  const uptime = useTelemetryStore(s => s.uptime);

  // Live analog clock hands rotation
  const [clockHands, setClockHands] = useState({ hourDeg: 0, minDeg: 0, secDeg: 0, timeStr: '', dateStr: '' });
  const [isScanningSecurity, setIsScanningSecurity] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<{
    firewall: string;
    sshRoot: string;
    failedLogins: number;
    openPorts: number;
    lastScanTime: string;
  }>({
    firewall: 'Active (UFW)',
    sshRoot: 'Protected',
    failedLogins: 0,
    openPorts: 4,
    lastScanTime: 'Just now',
  });

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const sec = now.getSeconds();
      const min = now.getMinutes();
      const hr = now.getHours();
      setClockHands({
        secDeg: (sec / 60) * 360,
        minDeg: ((min + sec / 60) / 60) * 360,
        hourDeg: (((hr % 12) + min / 60) / 12) * 360,
        timeStr: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        dateStr: now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
      });
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleQuickScan = async () => {
    if (!activeConnectionId || isScanningSecurity) return;
    setIsScanningSecurity(true);
    try {
      const cmd = `
        fw=$(which ufw >/dev/null 2>&1 && sudo -n ufw status 2>/dev/null | grep -i "Status:" || echo "Firewall Active")
        failed=$(journalctl -u ssh -u sshd -n 200 2>/dev/null | grep -ci "failed" || echo 0)
        ports=$(ss -tln 2>/dev/null | grep -c LISTEN || echo 4)
        echo "$fw|$failed|$ports"
      `;
      const res = await sshExec(activeConnectionId, cmd);
      const parts = (res.stdout || '').trim().split('|');
      setSecurityStatus({
        firewall: parts[0]?.trim() || 'Active',
        sshRoot: 'Protected',
        failedLogins: parseInt(parts[1]?.trim() || '0', 10) || 0,
        openPorts: parseInt(parts[2]?.trim() || '4', 10) || 4,
        lastScanTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } catch {
      setSecurityStatus(prev => ({
        ...prev,
        lastScanTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
    } finally {
      setIsScanningSecurity(false);
    }
  };

  // Format Disk Metric safely into human readable GB (Fixes "30(26312884224)%")
  const formatDiskSize = (raw: string | number) => {
    if (!raw || raw === '—') return '0 GB';
    const num = typeof raw === 'number' ? raw : parseFloat(raw);
    if (!isNaN(num) && num > 1000000) {
      return formatBytes(num);
    }
    return String(raw);
  };

  const formattedDiskUsed = formatDiskSize(diskUsed);
  const formattedDiskTotal = formatDiskSize(diskTotal);

  const stickyThemes = {
    amber: {
      bg: 'bg-amber-100/98 dark:bg-[#78350f]/80 border-amber-300 dark:border-amber-600/40 text-amber-950 dark:text-amber-100 shadow-md',
      header: 'bg-amber-200/95 dark:bg-amber-900/60 text-amber-950 dark:text-amber-200',
      accent: 'text-amber-800 dark:text-amber-400',
    },
    emerald: {
      bg: 'bg-emerald-100/98 dark:bg-[#064e3b]/80 border-emerald-300 dark:border-emerald-600/40 text-emerald-950 dark:text-emerald-100 shadow-md',
      header: 'bg-emerald-200/95 dark:bg-emerald-900/60 text-emerald-950 dark:text-emerald-200',
      accent: 'text-emerald-800 dark:text-emerald-400',
    },
    purple: {
      bg: 'bg-purple-100/98 dark:bg-[#4c1d95]/80 border-purple-300 dark:border-purple-600/40 text-purple-950 dark:text-purple-100 shadow-md',
      header: 'bg-purple-200/95 dark:bg-purple-900/60 text-purple-950 dark:text-purple-200',
      accent: 'text-purple-800 dark:text-purple-400',
    },
    rose: {
      bg: 'bg-rose-100/98 dark:bg-[#881337]/80 border-rose-300 dark:border-rose-600/40 text-rose-950 dark:text-rose-100 shadow-md',
      header: 'bg-rose-200/95 dark:bg-rose-900/60 text-rose-950 dark:text-rose-200',
      accent: 'text-rose-800 dark:text-rose-400',
    },
    blue: {
      bg: 'bg-blue-100/98 dark:bg-[#1e3a8a]/80 border-blue-300 dark:border-blue-600/40 text-blue-950 dark:text-blue-100 shadow-md',
      header: 'bg-blue-200/95 dark:bg-blue-900/60 text-blue-950 dark:text-blue-200',
      accent: 'text-blue-800 dark:text-blue-400',
    },
  };

  const isLight = theme === 'light';

  return (
    <>
      {/* Desktop Widgets Container (Fixed on right side of Desktop canvas) */}
      <div className="absolute top-12 right-6 z-10 flex flex-col space-y-4 pointer-events-none select-none max-w-xs w-72">
        {/* 1. Sonoma Analog + Digital Clock Widget */}
        <div className={`desktop-widget pointer-events-auto rounded-3xl p-4 backdrop-blur-2xl border shadow-2xl transition-all duration-300 hover:scale-[1.01] ${
          isLight 
            ? 'bg-white/85 border-slate-200/80 shadow-[0_15px_40px_rgba(0,0,0,0.08)] text-slate-800' 
            : 'bg-black/40 border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-white'
        }`}>
          <div className="flex items-center space-x-4">
            {/* Analog Clock Dial */}
            <div className={`relative w-20 h-20 rounded-full border flex items-center justify-center shrink-0 shadow-inner ${
              isLight ? 'bg-white border-slate-300 shadow-sm' : 'bg-black/60 border-white/20'
            }`}>
              {/* Dial tick marks */}
              <div className={`absolute inset-1 rounded-full border border-dashed ${isLight ? 'border-slate-300' : 'border-white/10'}`} />
              
              {/* Hour hand */}
              <div 
                className={`absolute w-1 h-5 rounded-full origin-bottom ${isLight ? 'bg-slate-800' : 'bg-white'}`}
                style={{
                  top: '15px',
                  transform: `rotate(${clockHands.hourDeg}deg)`,
                  transformOrigin: 'bottom center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }}
              />
              {/* Minute hand */}
              <div 
                className="absolute w-0.5 h-7 bg-blue-500 dark:bg-blue-400 rounded-full origin-bottom"
                style={{
                  top: '10px',
                  transform: `rotate(${clockHands.minDeg}deg)`,
                  transformOrigin: 'bottom center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
                }}
              />
              {/* Second hand */}
              <div 
                className="absolute w-[1px] h-8 bg-rose-500 rounded-full origin-bottom"
                style={{
                  top: '8px',
                  transform: `rotate(${clockHands.secDeg}deg)`,
                  transformOrigin: 'bottom center'
                }}
              />
              {/* Center pin */}
              <div className="w-2 h-2 rounded-full bg-rose-500 z-10 shadow" />
            </div>

            {/* Time & Date Display */}
            <div className="flex-1 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400">
                Live Server Time
              </span>
              <div className={`text-2xl font-black tracking-tight leading-tight font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
                {clockHands.timeStr || '--:--'}
              </div>
              <div className={`text-xs font-medium truncate ${isLight ? 'text-slate-500' : 'text-gray-300'}`}>
                {clockHands.dateStr}
              </div>
              <div className="text-[10px] text-gray-400 truncate mt-0.5 font-mono">
                {username}@{activeServer?.host || 'server'}
              </div>
            </div>
          </div>
        </div>

        {/* 2. Sonoma Performance Monitor Widget */}
        <div className={`desktop-widget pointer-events-auto rounded-3xl p-4 backdrop-blur-2xl border shadow-2xl transition-all duration-300 hover:scale-[1.01] ${
          isLight 
            ? 'bg-white/80 border-black/10 shadow-[0_15px_40px_rgba(0,0,0,0.1)] text-slate-800' 
            : 'bg-black/40 border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-white'
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className={`text-xs font-bold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                Server Monitor
              </span>
            </div>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/20">
              Load {loadAvg || '0.00'}
            </span>
          </div>

          <div className="space-y-2.5">
            {/* CPU Metric */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className={isLight ? 'text-slate-600' : 'text-gray-300'}>CPU Load</span>
                <span className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>{cpu}%</span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-slate-200/90' : 'bg-black/30 dark:bg-black/50'}`}>
                <div 
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.min(cpu, 100)}%` }}
                />
              </div>
            </div>

            {/* RAM Metric */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className={isLight ? 'text-slate-600' : 'text-gray-300'}>Memory (RAM)</span>
                <span className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {ramPct}% <span className="text-[10px] font-normal text-gray-400">({ramUsed} / {ramTotal})</span>
                </span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-slate-200/90' : 'bg-black/30 dark:bg-black/50'}`}>
                <div 
                  className="h-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.min(ramPct, 100)}%` }}
                />
              </div>
            </div>

            {/* Root Disk Metric (Human readable GB formatted: 24.5 GB / 80.0 GB (30%)) */}
            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className={isLight ? 'text-slate-600' : 'text-gray-300'}>Root Disk (/)</span>
                <span className={`font-mono font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {diskPct}% <span className="text-[10px] font-normal text-gray-400">({formattedDiskUsed} / {formattedDiskTotal})</span>
                </span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden ${isLight ? 'bg-slate-200/90' : 'bg-black/30 dark:bg-black/50'}`}>
                <div 
                  className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-500 rounded-full"
                  style={{ width: `${Math.min(diskPct, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 4. Stickies Widget */}
        {showStickiesWidget && (
          <div className={`desktop-widget pointer-events-auto rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300 hover:scale-[1.01] ${stickyThemes[stickyColor].bg}`}>
            <div className={`flex items-center justify-between px-3.5 py-2 ${stickyThemes[stickyColor].header}`}>
              <div className="flex items-center space-x-2">
                <StickyNote className="w-3.5 h-3.5" />
                <span className="text-xs font-bold tracking-tight">Stickies</span>
              </div>
              
              {/* Color dots */}
              <div className="flex items-center space-x-1.5">
                {(['amber', 'emerald', 'purple', 'rose', 'blue'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => setStickyColor(c)}
                    className={`w-2.5 h-2.5 rounded-full transition-transform cursor-pointer ${
                      c === 'amber' ? 'bg-amber-400' : c === 'emerald' ? 'bg-emerald-400' : c === 'purple' ? 'bg-purple-400' : c === 'rose' ? 'bg-rose-400' : 'bg-blue-400'
                    } ${stickyColor === c ? 'scale-125 ring-1 ring-white' : 'opacity-70 hover:opacity-100'}`}
                  />
                ))}
              </div>
            </div>

            <textarea
              value={stickyNoteContent}
              onChange={(e) => onUpdateStickyNote(e.target.value)}
              placeholder="Jot down quick commands, ports, or reminder notes..."
              rows={4}
              className="w-full bg-transparent p-3 text-xs focus:outline-none resize-none font-sans placeholder-gray-500/70"
            />
          </div>
        )}
      </div>

      {/* Widgets Tray / Drawer Modal (Toggle from Desktop Context Menu) */}
      {showWidgetsTray && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in select-none">
          <div className={`border rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4 ${
            isLight ? 'bg-white border-slate-300 text-slate-800' : 'bg-[#181825] border-white/20 text-white'
          }`}>
            <div className="flex items-center justify-between border-b pb-3 border-white/10 light:border-slate-200">
              <h3 className="font-bold text-sm">Desktop Widgets Manager</h3>
              <button onClick={onCloseWidgetsTray} className="text-gray-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">

              <label className="flex items-center justify-between p-3 rounded-2xl bg-white/5 light:bg-slate-100 cursor-pointer">
                <div className="flex items-center space-x-3">
                  <StickyNote className="w-5 h-5 text-amber-400" />
                  <div>
                    <div className="text-xs font-semibold">Desktop Stickies Widget</div>
                    <div className="text-[10px] text-gray-400 light:text-slate-500">Persistent notes synced to ~/.sshdesktop</div>
                  </div>
                </div>
                <input 
                  type="checkbox" 
                  checked={showStickiesWidget} 
                  onChange={(e) => setShowStickiesWidget(e.target.checked)} 
                  className="rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </label>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={onCloseWidgetsTray}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
