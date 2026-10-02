import React, { useState, useEffect, useCallback } from 'react';
import { Users, UserPlus, Shield, Trash2, Lock, Unlock, Search, RefreshCw, Terminal } from 'lucide-react';
import { userList, groupList, userAdd, userDelete, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface UserEntry {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  isSudo: boolean;
  isLocked: boolean;
}

interface GroupEntry {
  name: string;
  gid: number;
  members: string[];
}

interface ActiveSession {
  user: string;
  tty: string;
  from: string;
  loginAt: string;
  idle: string;
}

export default function UserManager() {
  const [tab, setTab] = useState<'users' | 'groups' | 'sessions'>('users');
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', shell: '/bin/bash', sudo: false });
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uList, gList, whoRes] = await Promise.all([
        userList(activeConnId),
        groupList(activeConnId),
        sshExec(activeConnId, 'who')
      ]);

      if (uList && uList.length > 0) {
        setUsers(uList.map((u: any) => ({
          username: u.username,
          uid: u.uid,
          gid: u.gid,
          home: u.home,
          shell: u.shell,
          groups: u.groups || [],
          isSudo: (u.groups || []).includes('sudo') || (u.groups || []).includes('wheel') || u.uid === 0,
          isLocked: !!u.locked
        })));
      }

      if (gList && gList.length > 0) {
        setGroups(gList.map((g: any) => ({
          name: g.name,
          gid: g.gid,
          members: g.members || []
        })));
      }

      if (whoRes && whoRes.stdout) {
        const lines = whoRes.stdout.trim().split('\n').filter(Boolean);
        const parsed = lines.map(line => {
          const parts = line.trim().split(/\s+/);
          return {
            user: parts[0] || 'unknown',
            tty: parts[1] || 'tty',
            from: parts.length > 4 ? parts.slice(4).join(' ').replace(/[()]/g, '') : 'local',
            loginAt: `${parts[2] || ''} ${parts[3] || ''}`.trim(),
            idle: 'active'
          };
        });
        setSessions(parsed);
      }
    } catch (err) {
      console.warn('Failed to load user data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleLock = async (username: string, currentlyLocked: boolean) => {
    try {
      const flag = currentlyLocked ? '-U' : '-L';
      await sshExec(activeConnId, `sudo usermod ${flag} ${username}`);
      setUsers(prev =>
        prev.map(u => (u.username === username ? { ...u, isLocked: !currentlyLocked } : u))
      );
    } catch (err) {
      console.warn('Failed to toggle lock:', err);
    }
  };

  const deleteUser = async (username: string) => {
    if (username === 'root') return;
    if (!confirm(`Are you sure you want to delete user '${username}'?`)) return;
    try {
      await userDelete(activeConnId, username, true);
      setUsers(prev => prev.filter(u => u.username !== username));
    } catch (err) {
      console.warn('Failed to delete user:', err);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username) return;
    try {
      await userAdd(
        activeConnId,
        newUser.username,
        newUser.shell,
        newUser.sudo ? ['sudo'] : []
      );
      setShowAddModal(false);
      setNewUser({ username: '', shell: '/bin/bash', sudo: false });
      await loadData();
    } catch (err) {
      console.warn('Failed to add user:', err);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Header controls */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setTab('users')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'users' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Users ({users.length})
          </button>
          <button
            onClick={() => setTab('groups')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'groups' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Groups ({groups.length})
          </button>
          <button
            onClick={() => setTab('sessions')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'sessions' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Active Logins ({sessions.length})
          </button>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-44"
            />
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Users"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 bg-[var(--accent)] hover:bg-blue-600 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add User</span>
          </button>
        </div>
      </div>

      {/* Users Tab */}
      {tab === 'users' && (
        <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Username</th>
                  <th className="py-2.5 px-3">UID / GID</th>
                  <th className="py-2.5 px-3">Home Directory</th>
                  <th className="py-2.5 px-3">Login Shell</th>
                  <th className="py-2.5 px-3">Privileges</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-gray-500">
                    {loading ? 'Fetching users from server...' : 'No users found'}
                  </td>
                </tr>
              ) : (
                users
                  .filter(u => u.username.toLowerCase().includes(search.toLowerCase()))
                  .map(user => (
                    <tr key={user.username} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-mono font-bold text-white flex items-center space-x-2">
                        <div className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-xs">
                          {user.username[0].toUpperCase()}
                        </div>
                        <span>{user.username}</span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-gray-400">{user.uid}:{user.gid}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-400">{user.home}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-300">{user.shell}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-1">
                          {user.isSudo && (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-400 font-bold">
                              sudo
                            </span>
                          )}
                          {user.isLocked && (
                            <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-400">
                              locked
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1">
                        <button
                          onClick={() => toggleLock(user.username, user.isLocked)}
                          className={`p-1.5 rounded hover:bg-white/10 ${
                            user.isLocked ? 'text-amber-400' : 'text-gray-400 hover:text-white'
                          }`}
                          title={user.isLocked ? 'Unlock User' : 'Lock Account'}
                        >
                          {user.isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        </button>
                        {user.username !== 'root' && (
                          <button
                            onClick={() => deleteUser(user.username)}
                            className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                            title="Delete User"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Groups Tab */}
      {tab === 'groups' && (
        <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Group Name</th>
                  <th className="py-2.5 px-3">GID</th>
                  <th className="py-2.5 px-3">Members</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-8 text-center text-gray-500">
                    {loading ? 'Fetching groups from server...' : 'No groups found'}
                  </td>
                </tr>
              ) : (
                groups
                  .filter(g => g.name.toLowerCase().includes(search.toLowerCase()))
                  .map(grp => (
                    <tr key={grp.name} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-mono font-bold text-white">{grp.name}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-400">{grp.gid}</td>
                      <td className="py-2.5 px-3 text-gray-300 font-mono text-[11px]">{grp.members.join(', ') || '—'}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Sessions Tab */}
      {tab === 'sessions' && (
        <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">TTY</th>
                  <th className="py-2.5 px-3">From Host</th>
                  <th className="py-2.5 px-3">Login Time</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {sessions.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    {loading ? 'Checking active logins...' : 'No other active sessions detected'}
                  </td>
                </tr>
              ) : (
                sessions.map((sess, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-mono font-bold text-emerald-400">{sess.user}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-400">{sess.tty}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-300">{sess.from}</td>
                    <td className="py-2.5 px-3 text-gray-400">{sess.loginAt}</td>
                    <td className="py-2.5 px-3 text-emerald-400 font-semibold">{sess.idle}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleAddUser} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Create New Remote User</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={newUser.username}
                  onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                  placeholder="e.g. john"
                />
              </div>
              <div>
                <label className="text-gray-400 block mb-1">Default Shell</label>
                <select
                  value={newUser.shell}
                  onChange={e => setNewUser({ ...newUser, shell: e.target.value })}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                >
                  <option value="/bin/bash">/bin/bash</option>
                  <option value="/bin/zsh">/bin/zsh</option>
                  <option value="/bin/sh">/bin/sh</option>
                </select>
              </div>
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="sudoCheck"
                  checked={newUser.sudo}
                  onChange={e => setNewUser({ ...newUser, sudo: e.target.checked })}
                  className="rounded bg-[#11111b] border-white/20 text-blue-500 focus:ring-0"
                />
                <label htmlFor="sudoCheck" className="text-gray-300">Grant sudo (administrative) privileges</label>
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
                Create User
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
