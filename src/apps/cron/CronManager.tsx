import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Plus, Trash2, Calendar, CheckCircle2, Search, RefreshCw } from 'lucide-react';
import { cronList, cronAdd, cronRemove } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface CronEntry {
  id: string;
  lineNumber: number;
  schedule: string;
  human: string;
  command: string;
  user: string;
}

function parseCronHuman(schedule: string): string {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return 'Custom schedule';
  const [min, hour, dom, mon, dow] = parts;
  if (min === '*' && hour === '*') return 'Every minute';
  if (min === '*/15') return 'Every 15 minutes';
  if (min === '0' && hour === '*') return 'Every hour at minute 0';
  if (min === '0' && hour === '0' && dom === '*' && mon === '*' && dow === '*') return 'Daily at midnight (00:00)';
  if (dow === '0' || dow === '7') return `Weekly on Sunday at ${hour}:${min.padStart(2, '0')}`;
  return `At ${hour}:${min.padStart(2, '0')}`;
}

export default function CronManager() {
  const [crons, setCrons] = useState<CronEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCron, setNewCron] = useState({
    schedule: '0 * * * *',
    command: '',
    human: 'Every hour at minute 0'
  });
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadCrons = useCallback(async () => {
    setLoading(true);
    try {
      const list = await cronList(activeConnId);
      if (list && Array.isArray(list)) {
        setCrons(list.map((c: any, idx: number) => ({
          id: String(c.line_number || idx + 1),
          lineNumber: c.line_number || idx + 1,
          schedule: c.schedule || '0 0 * * *',
          human: parseCronHuman(c.schedule || ''),
          command: c.command || '',
          user: c.user || 'root'
        })));
      }
    } catch (err) {
      console.warn('Failed to load crontab:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadCrons();
  }, [loadCrons]);

  const removeCron = async (lineNum: number) => {
    if (!confirm(`Are you sure you want to remove cron job on line #${lineNum}?`)) return;
    try {
      await cronRemove(activeConnId, lineNum);
      await loadCrons();
    } catch (err) {
      console.warn('Failed to remove cron:', err);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCron.command) return;
    try {
      await cronAdd(activeConnId, newCron.schedule, newCron.command);
      setShowAddModal(false);
      setNewCron({ schedule: '0 * * * *', command: '', human: 'Every hour' });
      await loadCrons();
    } catch (err) {
      console.warn('Failed to add cron:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <Clock className="w-5 h-5 text-amber-400" />
          <h2 className="font-bold text-sm text-white">Scheduled Tasks (crontab)</h2>
          <span className="text-xs text-gray-500">({crons.length} scheduled jobs)</span>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={loadCrons}
            disabled={loading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Crontab"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 bg-[var(--accent)] hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Cron Job</span>
          </button>
        </div>
      </div>

      {/* Crons Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3">Schedule</th>
              <th className="py-2.5 px-3">Frequency</th>
              <th className="py-2.5 px-3">Command</th>
              <th className="py-2.5 px-3">User</th>
              <th className="py-2.5 px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {crons.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-gray-500">
                  {loading ? 'Reading crontab from server...' : 'No cron jobs found'}
                </td>
              </tr>
            ) : (
              crons.map(job => (
                <tr key={job.id} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-mono font-bold text-amber-400">{job.schedule}</td>
                  <td className="py-2.5 px-3 text-gray-300 font-medium">{job.human}</td>
                  <td className="py-2.5 px-3 font-mono text-gray-400 truncate max-w-md">{job.command}</td>
                  <td className="py-2.5 px-3 font-mono text-purple-400">{job.user}</td>
                  <td className="py-2.5 px-3 text-right space-x-1">
                    <button
                      onClick={() => removeCron(job.lineNumber)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                      title="Delete Job"
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
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleAdd} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Create Scheduled Cron Task</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Preset Schedule</label>
                <select
                  onChange={e => {
                    const val = e.target.value;
                    const humanDesc = e.target.options[e.target.selectedIndex].text;
                    setNewCron({ ...newCron, schedule: val, human: humanDesc });
                  }}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                >
                  <option value="0 * * * *">Every hour at minute 0</option>
                  <option value="*/15 * * * *">Every 15 minutes</option>
                  <option value="0 0 * * *">Every day at midnight (00:00)</option>
                  <option value="0 3 * * *">Daily at 3:00 AM</option>
                  <option value="0 0 * * 0">Weekly on Sunday midnight</option>
                  <option value="0 0 1 * *">Monthly on the 1st</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Cron Expression (5 fields)</label>
                <input
                  type="text"
                  required
                  value={newCron.schedule}
                  onChange={e => setNewCron({ ...newCron, schedule: e.target.value })}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-amber-300 font-mono focus:outline-none"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Command to Execute</label>
                <textarea
                  required
                  rows={3}
                  value={newCron.command}
                  onChange={e => setNewCron({ ...newCron, command: e.target.value })}
                  placeholder="/usr/bin/python3 /opt/scripts/backup.py"
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg p-2.5 font-mono text-white focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
              >
                Save Cron Job
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
