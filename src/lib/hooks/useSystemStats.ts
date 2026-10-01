import { useState, useEffect } from 'react';
import { systemGetStats } from '../tauri-api';
import { SystemStats } from '../types';
import { useSettingsStore } from '../store';

export function useSystemStats() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [history, setHistory] = useState<SystemStats[]>([]);
  const interval = useSettingsStore((s) => s.pollingInterval);

  useEffect(() => {
    let mounted = true;
    const fetchStats = async () => {
      try {
        const current = await systemGetStats();
        if (mounted) {
          setStats(current);
          setHistory(prev => [...prev.slice(-30), current]);
        }
      } catch (e) {
        console.error(e);
      }
    };

    fetchStats();
    const id = setInterval(fetchStats, interval);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [interval]);

  return { stats, history };
}
