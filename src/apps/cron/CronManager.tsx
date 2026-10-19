import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Clock, Plus, Trash2, Calendar, CheckCircle2, Search, RefreshCw, 
  Play, Edit3, Terminal, Sliders, FileText, Check, Copy, AlertCircle, 
  AlertTriangle, Layers, Zap, X, Shield, ArrowRight, CornerDownRight, 
  RotateCcw, Sparkles, Server, ChevronRight
} from 'lucide-react';
import { cronList, cronAdd, cronRemove, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface CronEntry {
  id: string;
  lineNumber: number;
  schedule: string;
  human: string;
  command: string;
  user: string;
  enabled: boolean;
  comment?: string;
}

interface CronTemplate {
  title: string;
  desc: string;
  schedule: string;
  command: string;
  category: 'maintenance' | 'database' | 'security' | 'sync';
}

const PRODUCTION_TEMPLATES: CronTemplate[] = [
  {
    title: 'MySQL / MariaDB Nightly Dump',
    desc: 'Exports compressed SQL dump to /var/backups every night at 2:00 AM',
    schedule: '0 2 * * *',
    command: 'mysqldump --all-databases | gzip > /var/backups/db-$(date +\\%F).sql.gz',
    category: 'database'
  },
  {
    title: 'PostgreSQL Database Backup',
    desc: 'Runs pg_dumpall with timestamp every night at 2:30 AM',
    schedule: '30 2 * * *',
    command: 'pg_dumpall -U postgres | gzip > /var/backups/pg-$(date +\\%F).sql.gz',
    category: 'database'
  },
  {
    title: 'Purge /tmp & Stale Caches Weekly',
    desc: 'Safely removes files older than 7 days from /tmp every Sunday at 3:00 AM',
    schedule: '0 3 * * 0',
    command: 'find /tmp -type f -atime +7 -delete',
    category: 'maintenance'
  },
  {
    title: 'Certbot SSL Certificate Auto-Renew',
    desc: 'Checks and renews Let\'s Encrypt SSL certificates twice a month',
    schedule: '0 0 1,15 * *',
    command: 'certbot renew --quiet --post-hook "systemctl reload nginx"',
    category: 'security'
  },
  {
    title: 'Docker System Prune Weekly',
    desc: 'Reclaims disk space by pruning unused containers & images every Sunday at 4:00 AM',
    schedule: '0 4 * * 0',
    command: 'docker system prune -af --volumes',
    category: 'maintenance'
  },
  {
    title: 'NTP Time Synchronization Daily',
    desc: 'Synchronizes system clock with global NTP time servers daily at 1:00 AM',
    schedule: '0 1 * * *',
    command: 'chronyc makestep || ntpdate -s pool.ntp.org',
    category: 'sync'
  },
  {
    title: 'Git Repository Auto-Pull',
    desc: 'Pulls latest release commits from origin branch every 15 minutes',
    schedule: '*/15 * * * *',
    command: 'cd /var/www/app && git pull --ff-only',
    category: 'sync'
  },
  {
    title: 'Rotate System Logs Daily',
    desc: 'Forces logrotate execution every night at 4:30 AM',
    schedule: '30 4 * * *',
    command: '/usr/sbin/logrotate -f /etc/logrotate.conf',
    category: 'maintenance'
  }
];

function humanizeCron(schedule: string): string {
  const s = schedule.trim();
  if (s === '@reboot') return 'Once at system boot';
  if (s === '@hourly' || s === '0 * * * *') return 'Hourly at minute 0';
  if (s === '@daily' || s === '@midnight' || s === '0 0 * * *') return 'Daily at midnight (00:00)';
  if (s === '@weekly' || s === '0 0 * * 0') return 'Weekly on Sunday at 00:00';
  if (s === '@monthly' || s === '0 0 1 * *') return 'Monthly on the 1st at 00:00';
  if (s === '@yearly' || s === '@annually' || s === '0 0 1 1 *') return 'Yearly on Jan 1st at 00:00';

  const parts = s.split(/\s+/);
  if (parts.length < 5) return 'Custom Schedule';

  const [min, hour, dom, mon, dow] = parts;

  if (min === '*' && hour === '*') return 'Every minute';
  if (min.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} minutes`;
  if (hour.startsWith('*/') && min === '0') return `Every ${hour.slice(2)} hours at :00`;

  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  if (dom === '*' && mon === '*' && dow === '*') {
    return `Daily at ${timeStr}`;
  }

  if (dom === '*' && mon === '*' && dow !== '*') {
    const dName = dowNames[parseInt(dow, 10)] || `Day ${dow}`;
    return `Weekly on ${dName} at ${timeStr}`;
  }

  if (dom !== '*' && mon === '*') {
    return `Monthly on day ${dom} at ${timeStr}`;
  }

  return `Scheduled for ${schedule}`;
}

export default function CronManager() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'builder' | 'templates' | 'raw'>('tasks');
  const [crons, setCrons] = useState<CronEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // New Cron Modal & Form State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCron, setNewCron] = useState({
    schedule: '0 0 * * *',
    command: '',
    human: 'Daily at midnight (00:00)'
  });
  const [addModalError, setAddModalError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Visual Builder State
  const [builderMin, setBuilderMin] = useState('0');
  const [builderHour, setBuilderHour] = useState('0');
  const [builderDom, setBuilderDom] = useState('*');
  const [builderMon, setBuilderMon] = useState('*');
  const [builderDow, setBuilderDow] = useState('*');
  const [builderCmd, setBuilderCmd] = useState('');

  // Raw Crontab State
  const [rawCrontab, setRawCrontab] = useState('');
  const [isSavingRaw, setIsSavingRaw] = useState(false);

  // Test Run Output Modal
  const [testOutput, setTestOutput] = useState<{ command: string; stdout: string; stderr: string; code: number; timeMs: number } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const showNotification = (msg: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  // Load Crons from Server
  const loadCrons = useCallback(async () => {
    setLoading(true);
    try {
      // Load parsed list
      const list = await cronList(activeConnId);
      if (list && Array.isArray(list)) {
        setCrons(list.map((c: any, idx: number) => ({
          id: String(c.line_number || idx + 1),
          lineNumber: c.line_number || idx + 1,
          schedule: c.schedule || '0 0 * * *',
          human: humanizeCron(c.schedule || ''),
          command: c.command || '',
          user: c.user || 'root',
          enabled: !String(c.schedule || '').startsWith('#'),
        })));
      } else {
        setCrons([]);
      }

      // Load raw crontab
      const rawRes = await sshExec(activeConnId, 'crontab -l 2>/dev/null || echo "# No crontab for current user"');
      setRawCrontab(rawRes.stdout || '');

    } catch (err) {
      console.warn('Failed to load crontab:', err);
      setCrons([]);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadCrons();
  }, [loadCrons]);

  // Remove Cron
  const removeCron = async (lineNum: number, cmdText: string) => {
    if (!confirm(`Are you sure you want to remove this scheduled cron job?\n\n"${cmdText.slice(0, 60)}..."`)) return;
    try {
      await cronRemove(activeConnId, lineNum);
      showNotification('Cron task removed successfully');
      await loadCrons();
    } catch (err: any) {
      showNotification(`Failed to remove task: ${err?.message || err}`, 'error');
    }
  };

  // Add Cron
  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCron.command.trim()) return;
    setIsSubmitting(true);
    setAddModalError(null);
    try {
      await cronAdd(activeConnId, newCron.schedule.trim(), newCron.command.trim());
      showNotification('Scheduled cron task created successfully');
      setShowAddModal(false);
      setAddModalError(null);
      setNewCron({ schedule: '0 0 * * *', command: '', human: 'Daily at midnight (00:00)' });
      await loadCrons();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setAddModalError(msg);
      showNotification(`Error adding cron task: ${msg}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Execute / Test Run Cron Command Right Now
  const handleTestRun = async (command: string) => {
    setIsTesting(true);
    setTestOutput({
      command,
      stdout: 'Executing scheduled task on remote Linux host...',
      stderr: '',
      code: 0,
      timeMs: 0
    });
    try {
      const startTime = Date.now();
      const res = await sshExec(activeConnId, command);
      const elapsed = Date.now() - startTime;
      setTestOutput({
        command,
        stdout: res.stdout || 'Command completed successfully with no output.',
        stderr: res.stderr || '',
        code: res.exit_code,
        timeMs: elapsed
      });
    } catch (err: any) {
      setTestOutput({
        command,
        stdout: '',
        stderr: String(err?.message || err),
        code: 1,
        timeMs: 0
      });
    } finally {
      setIsTesting(false);
    }
  };

  // Save Raw Crontab
  const handleSaveRaw = async () => {
    setIsSavingRaw(true);
    try {
      const escaped = rawCrontab.replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `echo '${escaped}' | crontab -`);
      if (res.exit_code === 0) {
        showNotification('Crontab saved and reloaded');
        await loadCrons();
      } else {
        alert(`Failed to save crontab:\n${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error saving raw crontab: ${err?.message || err}`);
    } finally {
      setIsSavingRaw(false);
    }
  };

  // Visual Builder Computed Expression
  const builderExpr = useMemo(() => {
    return `${builderMin} ${builderHour} ${builderDom} ${builderMon} ${builderDow}`;
  }, [builderMin, builderHour, builderDom, builderMon, builderDow]);

  const builderHuman = useMemo(() => {
    return humanizeCron(builderExpr);
  }, [builderExpr]);

  const handleBuilderSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!builderCmd.trim()) return;
    try {
      await cronAdd(activeConnId, builderExpr, builderCmd.trim());
      showNotification(`Task created: ${builderHuman}`);
      setBuilderCmd('');
      setActiveTab('tasks');
      await loadCrons();
    } catch (err: any) {
      showNotification(`Error: ${err?.message || err}`, 'error');
    }
  };

  const handleApplyTemplate = (tmpl: CronTemplate) => {
    setNewCron({
      schedule: tmpl.schedule,
      command: tmpl.command,
      human: humanizeCron(tmpl.schedule)
    });
    setShowAddModal(true);
  };

  const filteredCrons = useMemo(() => {
    return crons.filter(c => 
      c.command.toLowerCase().includes(search.toLowerCase()) ||
      c.schedule.toLowerCase().includes(search.toLowerCase()) ||
      c.human.toLowerCase().includes(search.toLowerCase()) ||
      c.user.toLowerCase().includes(search.toLowerCase())
    );
  }, [crons, search]);

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans relative ${loading || isSubmitting ? 'cursor-mac-wait' : ''}`}>
      {(loading || isSubmitting) && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      
      {/* Toast Feedback */}
      {feedback && (
        <div className="fixed top-12 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center space-x-2 text-xs font-medium ${
            feedback.type === 'success' 
              ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-200' 
              : 'bg-rose-950/85 border-rose-500/40 text-rose-200'
          }`}>
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.msg}</span>
          </div>
        </div>
      )}

      {/* 1. macOS Top Header Toolbar */}
      <header className="px-5 py-3.5 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-3">
        
        {/* Left: App Identity */}
        <div className="flex items-center space-x-3.5 shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25 border border-white/20">
            <Clock className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold tracking-tight text-white">Cron Task Studio</span>
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>crond Active</span>
              </span>
            </div>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">macOS Automated Background Job Orchestrator</p>
          </div>
        </div>

        {/* Center: Segmented Navigation Switcher */}
        <div className="flex items-center bg-[#1e1e2e]/90 p-1 rounded-2xl border border-white/10 shadow-inner shrink-0">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'tasks'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Scheduled Tasks</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'tasks' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {crons.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('builder')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'builder'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sliders className="w-3.5 h-3.5 text-sky-400" />
            <span>Visual Builder</span>
          </button>

          <button
            onClick={() => setActiveTab('templates')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'templates'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span>Templates</span>
          </button>

          <button
            onClick={() => setActiveTab('raw')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'raw'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>Crontab Raw</span>
          </button>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-600/25 transition-all border border-blue-400/30"
          >
            <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>New Task</span>
          </button>

          <button
            onClick={loadCrons}
            disabled={loading}
            className="p-2 bg-white/10 hover:bg-white/15 active:scale-95 text-gray-300 hover:text-white rounded-xl transition-all border border-white/10"
            title="Refresh Crontab"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. Sub-Toolbar Metrics & Filter */}
      <div className="px-5 py-3 bg-[#161622] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4 overflow-x-auto no-scrollbar">
        
        {/* Metric Summary Pill Cards */}
        <div className="flex items-center space-x-3 overflow-x-auto py-0.5 shrink-0">
          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[11px] text-gray-400">Total Tasks:</span>
            <span className="text-xs font-bold text-white font-mono">{crons.length}</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[11px] text-gray-400">Daily Recurrence:</span>
            <span className="text-xs font-bold text-white font-mono">
              {crons.filter(c => c.schedule.includes('0 * * * *') || c.schedule.includes('0 0 * * *')).length}
            </span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Server className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px] text-gray-400">Target User:</span>
            <span className="text-xs font-bold text-purple-300 font-mono">
              {crons[0]?.user || 'root'}
            </span>
          </div>
        </div>

        {/* Search Input */}
        {activeTab === 'tasks' && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search scheduled jobs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono w-52"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* 3. Main Content Area */}
      <div className="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
        
        {/* TAB 1: ALL SCHEDULED TASKS */}
        {activeTab === 'tasks' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider text-[10px] font-sans">
                  <tr>
                    <th className="py-3 px-4 w-32">Schedule</th>
                    <th className="py-3 px-4 w-56">Frequency</th>
                    <th className="py-3 px-4">Command</th>
                    <th className="py-3 px-4 w-24">User</th>
                    <th className="py-3 px-4 text-right pr-6 w-32 font-sans">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredCrons.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center font-sans">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Clock className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">
                            {loading ? 'Reading crontab from Linux server...' : 'No scheduled cron tasks found'}
                          </div>
                          <button
                            onClick={() => setShowAddModal(true)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all font-sans"
                          >
                            Create First Scheduled Task
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCrons.map((job, idx) => (
                      <tr
                        key={job.id}
                        className={`group transition-colors ${
                          idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10`}
                      >
                        {/* Schedule Badge */}
                        <td className="py-3 px-4">
                          <span className="font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-lg text-xs">
                            {job.schedule}
                          </span>
                        </td>

                        {/* Frequency / Human Description */}
                        <td className="py-3 px-4 text-gray-200 font-sans font-medium text-xs">
                          {job.human}
                        </td>

                        {/* Command */}
                        <td className="py-3 px-4 text-gray-300 font-mono text-[11px] truncate max-w-md select-text">
                          <span className="text-cyan-400">$ </span>
                          <span>{job.command}</span>
                        </td>

                        {/* User */}
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-300 border border-purple-500/30 text-[10px] font-sans font-semibold">
                            {job.user}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right pr-6 font-sans">
                          <div className="flex items-center justify-end space-x-1.5">
                            {/* Run Now */}
                            <button
                              onClick={() => handleTestRun(job.command)}
                              className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-400 border border-emerald-500/30 active:scale-95 transition-all"
                              title="Execute Task Immediately (Test Run)"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => removeCron(job.lineNumber, job.command)}
                              className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 active:scale-95 transition-all"
                              title="Delete Cron Task"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: INTERACTIVE VISUAL BUILDER */}
        {activeTab === 'builder' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-6 overflow-y-auto backdrop-blur-md space-y-6">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-sky-400" />
                <span>Visual Cron Expression Generator</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Visually construct execution frequencies without memorizing cron syntax</p>
            </div>

            <form onSubmit={handleBuilderSubmit} className="space-y-6">
              {/* 5 Field Visual Selectors */}
              <div className="grid grid-cols-5 gap-3">
                {/* Minute */}
                <div className="bg-[#14141e] p-3.5 rounded-2xl border border-white/10 space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Minute (0-59)</label>
                  <select
                    value={builderMin}
                    onChange={e => setBuilderMin(e.target.value)}
                    className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="*">Every Minute (*)</option>
                    <option value="0">At Minute :00</option>
                    <option value="*/5">Every 5 Minutes (*/5)</option>
                    <option value="*/15">Every 15 Minutes (*/15)</option>
                    <option value="*/30">Every 30 Minutes (*/30)</option>
                    <option value="30">At Minute :30</option>
                  </select>
                </div>

                {/* Hour */}
                <div className="bg-[#14141e] p-3.5 rounded-2xl border border-white/10 space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Hour (0-23)</label>
                  <select
                    value={builderHour}
                    onChange={e => setBuilderHour(e.target.value)}
                    className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="*">Every Hour (*)</option>
                    <option value="0">Midnight (00:00)</option>
                    <option value="*/2">Every 2 Hours (*/2)</option>
                    <option value="*/6">Every 6 Hours (*/6)</option>
                    <option value="*/12">Every 12 Hours (*/12)</option>
                    <option value="2">At 2:00 AM</option>
                    <option value="4">At 4:00 AM</option>
                    <option value="12">At Noon (12:00)</option>
                  </select>
                </div>

                {/* Day of Month */}
                <div className="bg-[#14141e] p-3.5 rounded-2xl border border-white/10 space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Day of Month</label>
                  <select
                    value={builderDom}
                    onChange={e => setBuilderDom(e.target.value)}
                    className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="*">Every Day (*)</option>
                    <option value="1">1st of Month</option>
                    <option value="1,15">1st and 15th</option>
                    <option value="L">Last Day of Month</option>
                  </select>
                </div>

                {/* Month */}
                <div className="bg-[#14141e] p-3.5 rounded-2xl border border-white/10 space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Month</label>
                  <select
                    value={builderMon}
                    onChange={e => setBuilderMon(e.target.value)}
                    className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="*">Every Month (*)</option>
                    <option value="1">January (1)</option>
                    <option value="*/3">Quarterly (*/3)</option>
                    <option value="*/6">Semi-Annually (*/6)</option>
                  </select>
                </div>

                {/* Day of Week */}
                <div className="bg-[#14141e] p-3.5 rounded-2xl border border-white/10 space-y-2">
                  <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">Day of Week</label>
                  <select
                    value={builderDow}
                    onChange={e => setBuilderDow(e.target.value)}
                    className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="*">Every Day (*)</option>
                    <option value="1-5">Monday to Friday (1-5)</option>
                    <option value="0">Sunday (0)</option>
                    <option value="6,0">Weekends (Sat & Sun)</option>
                  </select>
                </div>
              </div>

              {/* Expression Preview Card */}
              <div className="bg-[#14141e] p-4 rounded-2xl border border-white/10 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-gray-400 block font-medium">Computed Cron Schedule</span>
                  <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">{builderExpr}</div>
                  <div className="text-xs text-emerald-400 mt-1 flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{builderHuman}</span>
                  </div>
                </div>

                <div className="text-right text-xs text-gray-500 font-mono">
                  Standard 5-part POSIX crontab
                </div>
              </div>

              {/* Command Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-300">Linux Command to Execute</label>
                <input
                  type="text"
                  required
                  placeholder="/usr/bin/python3 /opt/scripts/backup.py or /usr/local/bin/sync.sh"
                  value={builderCmd}
                  onChange={e => setBuilderCmd(e.target.value)}
                  className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Submit */}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!builderCmd.trim()}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-600/30 active:scale-95 transition-all flex items-center space-x-2"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Schedule Task</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* TAB 3: CURATED PRODUCTION TEMPLATES */}
        {activeTab === 'templates' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-6 overflow-y-auto backdrop-blur-md space-y-4">
            <div className="border-b border-white/10 pb-4">
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <span>Curated Production Cron Job Catalog</span>
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Industry-standard backup, maintenance, and security automation recipes</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {PRODUCTION_TEMPLATES.map((tmpl, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-[#14141e] hover:bg-[#161622] rounded-2xl border border-white/10 flex flex-col justify-between transition-all group hover:border-blue-500/30 shadow-md"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                        {tmpl.title}
                      </span>
                      <span className="font-mono text-xs text-amber-400 bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 rounded-lg">
                        {tmpl.schedule}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-relaxed">{tmpl.desc}</p>
                    <div className="bg-[#0e0f17] p-2 rounded-xl text-[10px] font-mono text-cyan-300 break-all select-text border border-white/5">
                      {tmpl.command}
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-end">
                    <button
                      onClick={() => handleApplyTemplate(tmpl)}
                      className="px-3.5 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium flex items-center space-x-1.5 active:scale-95 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Use Recipe</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: RAW CRONTAB EDITOR */}
        {activeTab === 'raw' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-5 overflow-hidden flex flex-col backdrop-blur-md space-y-3">
            <div className="flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold text-white">Direct Crontab Text Editor (crontab -e)</h3>
                <p className="text-[11px] text-gray-400">Directly inspect and modify crontab contents on the server</p>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={loadCrons}
                  className="px-3 py-1.5 rounded-xl text-xs bg-white/5 hover:bg-white/10 text-gray-300 transition-colors"
                >
                  Discard Changes
                </button>
                <button
                  onClick={handleSaveRaw}
                  disabled={isSavingRaw}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {isSavingRaw && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Crontab</span>
                </button>
              </div>
            </div>

            <textarea
              value={rawCrontab}
              onChange={e => setRawCrontab(e.target.value)}
              className="flex-1 w-full bg-[#0d0e15] border border-white/10 rounded-xl p-4 font-mono text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 leading-relaxed resize-none select-text"
              placeholder="# Crontab entries appear here"
            />
          </div>
        )}

      </div>

      {/* ================= MODAL: NEW CRON TASK ================= */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-2xl bg-amber-600/30 border border-amber-400/30 flex items-center justify-center text-amber-400">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Scheduled Task</h3>
                  <p className="text-[11px] text-gray-400">Add an automated execution rule to user crontab</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleAddSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Preset Frequency</label>
                <select
                  onChange={e => {
                    const sched = e.target.value;
                    const human = e.target.options[e.target.selectedIndex].text;
                    setNewCron(prev => ({ ...prev, schedule: sched, human }));
                  }}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="0 0 * * *">Daily at midnight (00:00)</option>
                  <option value="0 * * * *">Hourly at minute 0</option>
                  <option value="*/15 * * * *">Every 15 minutes</option>
                  <option value="0 3 * * *">Daily at 3:00 AM</option>
                  <option value="0 0 * * 0">Weekly on Sunday at 00:00</option>
                  <option value="0 0 1 * *">Monthly on the 1st</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Cron Expression (5 Fields)</label>
                <input
                  type="text"
                  required
                  value={newCron.schedule}
                  onChange={e => setNewCron(prev => ({ ...prev, schedule: e.target.value, human: humanizeCron(e.target.value) }))}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-amber-300 font-mono focus:outline-none focus:border-blue-500 font-bold"
                />
                <span className="text-[11px] text-emerald-400 mt-1 block">{newCron.human}</span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Command to Execute</label>
                <textarea
                  required
                  rows={3}
                  value={newCron.command}
                  onChange={e => setNewCron(prev => ({ ...prev, command: e.target.value }))}
                  placeholder="/usr/bin/python3 /opt/scripts/backup.py"
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl p-3 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>

              {addModalError && (
                <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{addModalError}</div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setAddModalError(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !newCron.command.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2"
                >
                  {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save Task</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: TEST RUN OUTPUT ================= */}
      {testOutput && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col h-[480px]">
            {/* Header */}
            <div className="px-5 py-3.5 bg-[#12121a] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-mono font-bold text-white">Manual Execution Test</span>
                {testOutput.timeMs > 0 && (
                  <span className="text-[10px] text-gray-400 font-mono">({testOutput.timeMs}ms)</span>
                )}
              </div>
              <button 
                onClick={() => setTestOutput(null)}
                className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Command summary */}
            <div className="px-5 py-2 bg-[#161622] border-b border-white/5 font-mono text-[11px] text-cyan-300 break-all select-text">
              $ {testOutput.command}
            </div>

            {/* Terminal Body */}
            <div className="flex-1 p-4 font-mono text-xs text-gray-300 bg-[#0d0e15] overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
              {isTesting ? (
                <div className="flex items-center space-x-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Executing task on remote Linux host...</span>
                </div>
              ) : (
                <>
                  {testOutput.stdout}
                  {testOutput.stderr && (
                    <div className="text-rose-400 mt-2 font-semibold">
                      [STDERR]: {testOutput.stderr}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 bg-[#12121a] border-t border-white/10 flex items-center justify-between text-xs">
              <span className={`font-mono text-[11px] font-bold ${testOutput.code === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                Exit Code: {testOutput.code}
              </span>
              <button
                onClick={() => setTestOutput(null)}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export { CronManager };
