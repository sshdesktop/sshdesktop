import { useState, useEffect, useRef } from 'react';
import { systemGetStats } from '../tauri-api';
import { SystemStats } from '../types';
import { useSettingsStore, useTelemetryStore, useConnectionStore } from '../store';

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<SystemStats[]>([]);
  const intervalSeconds = useSettingsStore((s) => s.pollingInterval) || 15;
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const fetchStats = async () => {
      // Guard: do not poll if document is hidden/minimized or another request is currently in-flight
      if (typeof document !== 'undefined' && document.hidden) return;
      if (isFetchingRef.current || controller.signal.aborted) return;

      isFetchingRef.current = true;
      try {
        const current = await systemGetStats();
        if (mounted && !controller.signal.aborted && current) {
          setStats(current);
          setHistory(prev => [...prev.slice(-30), current]);

          // Update shared telemetry store so other UI components don't duplicate calls
          const cpuVal = Array.isArray(current.cpu_percent) && current.cpu_percent.length > 0
            ? Math.round(current.cpu_percent[0])
            : 0;
          const ramTotal = current.ram_total || 1;
          const ramUsed = current.ram_used || 0;
          const ramPct = Math.round((ramUsed / ramTotal) * 100);

          useTelemetryStore.getState().updateTelemetry({
            cpu: cpuVal,
            ramPct,
            ramUsed: `${(ramUsed / 1024 / 1024 / 1024).toFixed(1)} GB`,
            ramTotal: `${(ramTotal / 1024 / 1024 / 1024).toFixed(1)} GB`,
            loadAvg: Array.isArray(current.load_avg) && current.load_avg.length >= 3
              ? `${Number(current.load_avg[0]).toFixed(2)}, ${Number(current.load_avg[1]).toFixed(2)}, ${Number(current.load_avg[2]).toFixed(2)}`
              : '—',
            uptime: typeof current.uptime_seconds === 'number' && current.uptime_seconds > 0
              ? `${Math.floor(current.uptime_seconds / 86400)}d ${Math.floor((current.uptime_seconds % 86400) / 3600)}h`
              : '—',
            kernel: current.kernel ? current.kernel.split('-')[0] : 'Linux'
          });
        }
      } catch (e) {
        console.warn('Telemetry fetch error:', e);
      } finally {
        isFetchingRef.current = false;
      }
    };

    fetchStats();
    // Safe server-friendly interval: at least 10 seconds (default 15s)
    const safeIntervalMs = Math.max(intervalSeconds, 10) * 1000;
    const id = setInterval(fetchStats, safeIntervalMs);

    return () => {
      mounted = false;
      controller.abort();
      clearInterval(id);
    };
  }, [intervalSeconds, activeConnectionId]);

  return { stats, history };
}
