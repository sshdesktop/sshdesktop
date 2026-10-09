import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Users, UserPlus, Shield, Trash2, Lock, Unlock, Search, RefreshCw, 
  Terminal, Key, X, Check, Plus, Folder, UserCheck, ShieldAlert, 
  LogOut, Layers, AlertCircle, CheckCircle2, ChevronRight, UserX,
  Settings, ExternalLink, HardDrive, ShieldCheck
} from 'lucide-react';
import { userList, groupList, userAdd, userDelete, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

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

const AVATAR_COLORS = [
  'from-blue-500 to-indigo-600',
  'from-purple-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-red-600',
  'from-cyan-500 to-blue-600'
];

export default function UserManager() {
  const [tab, setTab] = useState<'users' | 'groups' | 'sessions'>('users');
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  
  // Selected user for Master-Detail macOS view
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', shell: '/bin/bash', sudo: false, password: '' });
  const [addUserError, setAddUserError] = useState<string | null>(null);

  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addGroupError, setAddGroupError] = useState<string | null>(null);

  // Password & Group Management Modals
  const [passwordModalUser, setPasswordModalUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  const [groupModalUser, setGroupModalUser] = useState<UserEntry | null>(null);
  const [customGroupName, setCustomGroupName] = useState('');
  const [groupStatus, setGroupStatus] = useState<string | null>(null);

  // Notification Toast
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const { navigateFinder, runTerminalCommand } = useEditorStore();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uList, gList, whoRes] = await Promise.all([
        userList(activeConnId),
        groupList(activeConnId),
        sshExec(activeConnId, 'who')
      ]);

      if (uList && uList.length > 0) {
        const mappedUsers: UserEntry[] = uList.map((u: any) => ({
          username: u.username,
          uid: u.uid,
          gid: u.gid,
          home: u.home || `/home/${u.username}`,
          shell: u.shell || '/bin/bash',
          groups: u.groups || [],
          isSudo: (u.groups || []).includes('sudo') || (u.groups || []).includes('wheel') || u.uid === 0,
          isLocked: !!u.locked
        }));
        setUsers(mappedUsers);
        if (!selectedUsername && mappedUsers.length > 0) {
          // Default select the logged in user or first non-root user
          setSelectedUsername(mappedUsers.find(u => u.uid >= 1000)?.username || mappedUsers[0].username);
        }
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
            from: parts.length > 4 ? parts.slice(4).join(' ').replace(/[()]/g, '') : 'local/pty',
            loginAt: `${parts[2] || ''} ${parts[3] || ''}`.trim(),
            idle: 'Active Now'
          };
        });
        setSessions(parsed);
      }
    } catch (err) {
      console.warn('Failed to load user data:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId, selectedUsername]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const selectedUserObj = useMemo(() => {
    return users.find(u => u.username === selectedUsername) || users[0] || null;
  }, [users, selectedUsername]);

  const toggleLock = async (username: string, currentlyLocked: boolean) => {
    try {
      const flag = currentlyLocked ? '-U' : '-L';
      await sshExec(activeConnId, `sudo usermod ${flag} ${username}`);
      setUsers(prev =>
        prev.map(u => (u.username === username ? { ...u, isLocked: !currentlyLocked } : u))
      );
      setNotice({ 
        text: `User account '${username}' ${currentlyLocked ? 'unlocked' : 'locked'}.`, 
        isError: false 
      });
      setTimeout(() => setNotice(null), 3500);
    } catch (err: any) {
      setNotice({ text: `Failed to toggle lock: ${err?.message || err}`, isError: true });
    }
  };

  const toggleSudoPrivilege = async (username: string, currentlySudo: boolean) => {
    try {
      if (currentlySudo) {
        await sshExec(activeConnId, `sudo gpasswd -d ${username} sudo || sudo gpasswd -d ${username} wheel`);
        setNotice({ text: `Revoked sudo administrative privileges from '${username}'.`, isError: false });
      } else {
        await sshExec(activeConnId, `sudo usermod -aG sudo ${username} || sudo usermod -aG wheel ${username}`);
        setNotice({ text: `Granted sudo administrative privileges to '${username}'.`, isError: false });
      }
      setTimeout(() => setNotice(null), 3500);
      await loadData();
    } catch (err: any) {
      setNotice({ text: `Failed to change administrative privileges: ${err?.message || err}`, isError: true });
    }
  };

  const deleteUser = async (username: string) => {
    if (username === 'root') {
      alert('Cannot delete the root superuser account.');
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete user '${username}' and their home folder?`)) return;
    try {
      await userDelete(activeConnId, username, true);
      setUsers(prev => prev.filter(u => u.username !== username));
      if (selectedUsername === username) {
        setSelectedUsername(users[0]?.username || null);
      }
      setNotice({ text: `User '${username}' has been deleted.`, isError: false });
      setTimeout(() => setNotice(null), 3500);
    } catch (err: any) {
      setNotice({ text: `Failed to delete user: ${err?.message || err}`, isError: true });
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username.trim()) return;
    setAddUserError(null);
    try {
      await userAdd(
        activeConnId,
        newUser.username.trim(),
        newUser.shell,
        newUser.sudo ? ['sudo'] : []
      );
      if (newUser.password.trim()) {
        await sshExec(activeConnId, `echo "${newUser.username.trim()}:${newUser.password.trim()}" | sudo chpasswd`);
      }
      setShowAddModal(false);
      setAddUserError(null);
      const createdUsername = newUser.username.trim();
      setNewUser({ username: '', shell: '/bin/bash', sudo: false, password: '' });
      setSelectedUsername(createdUsername);
      setNotice({ text: `User '${createdUsername}' created successfully!`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setAddUserError(msg);
      setNotice({ text: `Failed to create user: ${msg}`, isError: true });
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setAddGroupError(null);
    try {
      await sshExec(activeConnId, `sudo groupadd ${newGroupName.trim()}`);
      setShowAddGroupModal(false);
      setAddGroupError(null);
      setNewGroupName('');
      setNotice({ text: `Group '${newGroupName.trim()}' created!`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setAddGroupError(msg);
      setNotice({ text: `Failed to create group: ${msg}`, isError: true });
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalUser || !newPassword) return;
    try {
      setPasswordStatus('Applying new password...');
      await sshExec(activeConnId, `echo "${passwordModalUser}:${newPassword}" | sudo chpasswd`);
      setPasswordStatus('Password updated successfully!');
      setTimeout(() => {
        setPasswordModalUser(null);
        setNewPassword('');
        setPasswordStatus(null);
      }, 1000);
    } catch (err: any) {
      setPasswordStatus(`Failed: ${err?.message || err}`);
    }
  };

  const handleJoinGroup = async (groupName: string) => {
    if (!groupModalUser || !groupName) return;
    try {
      setGroupStatus(`Adding to ${groupName}...`);
      await sshExec(activeConnId, `sudo usermod -aG ${groupName} ${groupModalUser.username}`);
      setGroupStatus(`User joined group '${groupName}'!`);
      await loadData();
      setGroupModalUser(prev => prev ? { ...prev, groups: [...prev.groups, groupName] } : null);
    } catch (err: any) {
      setGroupStatus(`Failed: ${err?.message || err}`);
    }
  };

  const handleRemoveFromGroup = async (groupName: string) => {
    if (!groupModalUser || !groupName) return;
    try {
      setGroupStatus(`Removing from ${groupName}...`);
      await sshExec(activeConnId, `sudo gpasswd -d ${groupModalUser.username} ${groupName}`);
      setGroupStatus(`User removed from group '${groupName}'!`);
      await loadData();
      setGroupModalUser(prev => prev ? { ...prev, groups: prev.groups.filter(g => g !== groupName) } : null);
    } catch (err: any) {
      setGroupStatus(`Failed: ${err?.message || err}`);
    }
  };

  const handleKickSession = async (session: ActiveSession) => {
    if (!confirm(`Terminate active session for '${session.user}' on ${session.tty}?`)) return;
    try {
      await sshExec(activeConnId, `sudo pkill -9 -t ${session.tty} || sudo fuser -k /dev/${session.tty}`);
      setNotice({ text: `Session on ${session.tty} disconnected.`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadData();
    } catch (err: any) {
      setNotice({ text: `Failed to disconnect session: ${err?.message || err}`, isError: true });
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      String(u.uid).includes(search) ||
      u.shell.toLowerCase().includes(search.toLowerCase()) ||
      u.groups.some(g => g.toLowerCase().includes(search.toLowerCase()))
    );
  }, [users, search]);

  const filteredGroups = useMemo(() => {
    return groups.filter(g => 
      g.name.toLowerCase().includes(search.toLowerCase()) ||
      String(g.gid).includes(search) ||
      g.members.some(m => m.toLowerCase().includes(search.toLowerCase()))
    );
  }, [groups, search]);

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative ${loading ? 'cursor-mac-wait' : ''}`}>
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      {/* macOS Top Navigation Toolbar */}
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3">
        {/* Segmented Tab Controls */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10">
            <button
              onClick={() => setTab('users')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'users' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Users ({users.length})</span>
            </button>
            <button
              onClick={() => setTab('groups')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'groups' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Groups ({groups.length})</span>
            </button>
            <button
              onClick={() => setTab('sessions')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'sessions' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Active Logins ({sessions.length})</span>
            </button>
          </div>
        </div>

        {/* Right Tools: Add User, Add Group, Search, Refresh */}
        <div className="flex items-center space-x-2">
          {tab === 'users' && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded-xl transition-all font-medium shadow-md active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          )}

          {tab === 'groups' && (
            <button
              onClick={() => setShowAddGroupModal(true)}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded-xl transition-all font-medium shadow-md active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Group</span>
            </button>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-36 focus:w-48 transition-all shadow-inner"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-all active:scale-95 disabled:opacity-50"
            title="Refresh Users & Groups"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice Toast */}
      {notice && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-xl text-xs flex items-center justify-between animate-in fade-in slide-in-from-top-1 ${
          notice.isError ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}>
          <span className="font-mono">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 bg-[#161622] flex overflow-hidden relative">
        {/* 1. USERS TAB: macOS Master-Detail Settings View */}
        {tab === 'users' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Column: Users List */}
            <div className="w-72 border-r border-white/[0.08] bg-[#141624] flex flex-col shrink-0 overflow-y-auto scrollbar-thin p-2 space-y-1">
              <div className="text-[10px] font-bold text-gray-400 uppercase px-3 py-1.5 tracking-wider">
                Accounts ({filteredUsers.length})
              </div>

              {filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500">No users found</div>
              ) : (
                filteredUsers.map((user, idx) => {
                  const isSelected = selectedUsername === user.username;
                  const colorGradient = AVATAR_COLORS[idx % AVATAR_COLORS.length];

                  return (
                    <div
                      key={user.username}
                      onClick={() => setSelectedUsername(user.username)}
                      className={`p-2.5 rounded-2xl cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'hover:bg-white/[0.05] text-gray-200'
                      }`}
                    >
                      <div className="flex items-center space-x-3 overflow-hidden">
                        <div className={`w-9 h-9 rounded-2xl bg-gradient-to-br ${colorGradient} flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-sm border border-white/20`}>
                          {user.username[0].toUpperCase()}
                        </div>
                        <div className="truncate">
                          <div className="font-bold text-xs truncate flex items-center space-x-1.5">
                            <span>{user.username}</span>
                            {user.isLocked && <Lock className="w-3 h-3 text-amber-300" />}
                          </div>
                          <div className={`text-[10px] truncate ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                            {user.isSudo ? 'Administrator' : user.uid < 1000 ? 'System User' : 'Standard User'}
                          </div>
                        </div>
                      </div>

                      <ChevronRight className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Pane: Selected User Detail Profile Card */}
            {selectedUserObj ? (
              <div className="flex-1 overflow-y-auto p-6 scrollbar-thin flex justify-center">
                <div className="w-full max-w-xl space-y-6">
                  {/* User Profile Header Card */}
                  <div className="bg-[#1a1d2e] border border-white/10 rounded-3xl p-6 shadow-sm flex items-center justify-between">
                    <div className="flex items-center space-x-4">
                      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 flex items-center justify-center font-bold text-2xl text-white shadow-lg border border-white/25">
                        {selectedUserObj.username[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <h2 className="font-bold text-lg text-white">{selectedUserObj.username}</h2>
                          {selectedUserObj.isSudo && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30 flex items-center space-x-1">
                              <ShieldCheck className="w-3 h-3" />
                              <span>Admin</span>
                            </span>
                          )}
                          {selectedUserObj.isLocked && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Locked
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">UID: {selectedUserObj.uid} · GID: {selectedUserObj.gid}</p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => {
                          setPasswordModalUser(selectedUserObj.username);
                          setNewPassword('');
                          setPasswordStatus(null);
                        }}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1.5"
                      >
                        <Key className="w-3.5 h-3.5" />
                        <span>Change Password</span>
                      </button>
                    </div>
                  </div>

                  {/* Account Settings Configuration List */}
                  <div className="bg-[#1a1d2e] border border-white/10 rounded-3xl p-5 shadow-sm space-y-4">
                    <h3 className="font-bold text-xs text-white uppercase tracking-wider text-gray-400">Account Configuration</h3>

                    {/* Sudo Admin Switch */}
                    <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
                      <div>
                        <div className="text-xs font-semibold text-white">Administrator Privileges (sudo)</div>
                        <div className="text-[11px] text-gray-400">Allow this user to execute administrative commands via sudo.</div>
                      </div>
                      <button
                        onClick={() => toggleSudoPrivilege(selectedUserObj.username, selectedUserObj.isSudo)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          selectedUserObj.isSudo ? 'bg-blue-600' : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            selectedUserObj.isSudo ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Lock Account Switch */}
                    <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
                      <div>
                        <div className="text-xs font-semibold text-white">Lock Account Access</div>
                        <div className="text-[11px] text-gray-400">Disables password login for this user account.</div>
                      </div>
                      <button
                        onClick={() => toggleLock(selectedUserObj.username, selectedUserObj.isLocked)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          selectedUserObj.isLocked ? 'bg-amber-600' : 'bg-gray-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            selectedUserObj.isLocked ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Home Directory Pill with Open in Finder */}
                    <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
                      <div>
                        <div className="text-xs font-semibold text-white">Home Directory</div>
                        <div className="text-[11px] text-gray-400 font-mono">{selectedUserObj.home}</div>
                      </div>
                      <button
                        onClick={() => {
                          navigateFinder(selectedUserObj.home);
                          openApp('files', 'Finder');
                        }}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
                      >
                        <Folder className="w-3.5 h-3.5 text-blue-400" />
                        <span>Open in Finder</span>
                      </button>
                    </div>

                    {/* Login Shell */}
                    <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
                      <div>
                        <div className="text-xs font-semibold text-white">Login Shell</div>
                        <div className="text-[11px] text-gray-400 font-mono">{selectedUserObj.shell}</div>
                      </div>
                      <button
                        onClick={() => {
                          runTerminalCommand(`sudo su - ${selectedUserObj.username}\n`);
                          openApp('terminal', 'Terminal');
                        }}
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
                      >
                        <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Switch User Shell</span>
                      </button>
                    </div>

                    {/* Groups Membership */}
                    <div className="py-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-white">Group Memberships ({selectedUserObj.groups.length})</div>
                        <button
                          onClick={() => {
                            setGroupModalUser(selectedUserObj);
                            setCustomGroupName('');
                            setGroupStatus(null);
                          }}
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                        >
                          + Manage Groups
                        </button>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {selectedUserObj.groups.map(grp => (
                          <span
                            key={grp}
                            className="px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-gray-300"
                          >
                            {grp}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Delete Account */}
                    {selectedUserObj.username !== 'root' && (
                      <div className="pt-3 border-t border-white/[0.08] flex justify-end">
                        <button
                          onClick={() => deleteUser(selectedUserObj.username)}
                          className="px-3.5 py-1.5 bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white rounded-xl text-xs font-semibold border border-rose-500/30 transition-all flex items-center space-x-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete User Account</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500 text-xs">
                Select a user to inspect profile
              </div>
            )}
          </div>
        )}

        {/* 2. GROUPS TAB */}
        {tab === 'groups' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">Group Name</th>
                  <th className="py-2.5 px-3 w-28">GID</th>
                  <th className="py-2.5 px-3">Member Users</th>
                  <th className="py-2.5 px-3 text-right w-28">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredGroups.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Fetching groups from server...' : 'No groups found'}
                    </td>
                  </tr>
                ) : (
                  filteredGroups.map(grp => (
                    <tr key={grp.name} className="hover:bg-white/[0.04] transition-colors">
                      <td className="py-2 px-3 font-mono font-bold text-white flex items-center space-x-2">
                        <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span>{grp.name}</span>
                      </td>
                      <td className="py-2 px-3 text-gray-400 font-mono">{grp.gid}</td>
                      <td className="py-2 px-3 text-gray-300 font-sans">
                        {grp.members.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {grp.members.map(m => (
                              <span key={m} className="px-2 py-0.5 rounded bg-white/10 text-white font-mono text-[10px]">
                                {m}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete group '${grp.name}'?`)) return;
                            try {
                              await sshExec(activeConnId, `sudo groupdel ${grp.name}`);
                              setNotice({ text: `Group '${grp.name}' deleted.`, isError: false });
                              await loadData();
                            } catch (err: any) {
                              setNotice({ text: `Failed to delete group: ${err?.message || err}`, isError: true });
                            }
                          }}
                          className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                          title="Delete Group"
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
        )}

        {/* 3. ACTIVE SESSIONS TAB */}
        {tab === 'sessions' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3">User</th>
                  <th className="py-2.5 px-3">TTY / Terminal</th>
                  <th className="py-2.5 px-3">Login From Host</th>
                  <th className="py-2.5 px-3">Login Time</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Kick</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Checking active logins...' : 'No active sessions detected'}
                    </td>
                  </tr>
                ) : (
                  sessions.map((sess, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.04] transition-colors">
                      <td className="py-2 px-3 font-mono font-bold text-emerald-400 flex items-center space-x-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <span>{sess.user}</span>
                      </td>
                      <td className="py-2 px-3 text-gray-300">{sess.tty}</td>
                      <td className="py-2 px-3 text-gray-400">{sess.from}</td>
                      <td className="py-2 px-3 text-gray-300 font-sans">{sess.loginAt}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 font-sans font-semibold">
                          {sess.idle}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => handleKickSession(sess)}
                          className="px-2 py-0.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-[10px] font-medium transition-colors"
                          title="Disconnect Session"
                        >
                          Kick
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form onSubmit={handleAddUser} className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="font-bold text-base text-white">Create New Remote User</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-300 block mb-1 font-medium">Username</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newUser.username}
                  onChange={e => setNewUser({ ...newUser, username: e.target.value })}
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="e.g. alex"
                />
              </div>

              <div>
                <label className="text-gray-300 block mb-1 font-medium">Initial Password (Optional)</label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={e => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Set initial password..."
                />
              </div>

              <div>
                <label className="text-gray-300 block mb-1 font-medium">Default Login Shell</label>
                <select
                  value={newUser.shell}
                  onChange={e => setNewUser({ ...newUser, shell: e.target.value })}
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
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
                  className="rounded bg-[#101018] border-white/20 text-blue-600 focus:ring-0"
                />
                <label htmlFor="sudoCheck" className="text-gray-300 font-medium">Grant sudo (administrative) privileges</label>
              </div>
            </div>

            {addUserError && (
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{addUserError}</div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => { setShowAddModal(false); setAddUserError(null); }}
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-all active:scale-95"
              >
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Group Modal */}
      {showAddGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form onSubmit={handleCreateGroup} className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="font-bold text-base text-white">Create New Group</h3>
              <button type="button" onClick={() => { setShowAddGroupModal(false); setAddGroupError(null); }} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs text-gray-300 block mb-1 font-medium">Group Name</label>
              <input
                type="text"
                required
                autoFocus
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                placeholder="e.g. developers, docker, analytics"
                className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
            </div>

            {addGroupError && (
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{addGroupError}</div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => { setShowAddGroupModal(false); setAddGroupError(null); }}
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-all active:scale-95"
              >
                Create Group
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Set Password Modal */}
      {passwordModalUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form onSubmit={handleSetPassword} className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Key className="w-4 h-4 text-blue-400" />
                <span>Password for {passwordModalUser}</span>
              </div>
              <button type="button" onClick={() => setPasswordModalUser(null)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordStatus && (
              <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-mono">
                {passwordStatus}
              </div>
            )}

            <div>
              <label className="text-xs text-gray-300 block mb-1 font-medium">New Password</label>
              <input
                type="password"
                required
                autoFocus
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new account password"
                className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setPasswordModalUser(null)}
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newPassword}
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow-md transition-all active:scale-95"
              >
                Update Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Manage Groups Modal */}
      {groupModalUser && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Users className="w-4 h-4 text-blue-400" />
                <span>Groups for &ldquo;{groupModalUser.username}&rdquo;</span>
              </div>
              <button type="button" onClick={() => setGroupModalUser(null)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {groupStatus && (
              <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-mono">
                {groupStatus}
              </div>
            )}

            {/* Quick Add Custom Group */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={customGroupName}
                onChange={e => setCustomGroupName(e.target.value)}
                placeholder="Group name (e.g. docker, sudo)..."
                className="flex-1 bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
              />
              <button
                onClick={() => {
                  if (customGroupName.trim()) {
                    handleJoinGroup(customGroupName.trim());
                    setCustomGroupName('');
                  }
                }}
                disabled={!customGroupName.trim()}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-xl text-xs text-white font-semibold transition-all active:scale-95"
              >
                Join
              </button>
            </div>

            {/* Current Memberships */}
            <div className="text-xs font-medium text-gray-300">Active Memberships:</div>
            <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-2 bg-[#101018] rounded-2xl border border-white/[0.06] scrollbar-thin">
              {groupModalUser.groups.length === 0 ? (
                <span className="text-gray-500 text-xs p-1">No secondary groups</span>
              ) : (
                groupModalUser.groups.map(grp => (
                  <span
                    key={grp}
                    className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-white/10 text-white text-xs font-mono"
                  >
                    <span>{grp}</span>
                    <button
                      onClick={() => handleRemoveFromGroup(grp)}
                      className="hover:text-red-400 text-gray-400"
                      title="Remove from group"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Available Server Groups */}
            <div className="text-xs font-medium text-gray-300">Available Server Groups:</div>
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] border border-white/[0.08] rounded-2xl max-h-44 bg-[#101018] scrollbar-thin">
              {groups
                .filter(g => !groupModalUser.groups.includes(g.name))
                .slice(0, 40)
                .map(g => (
                  <div key={g.name} className="flex items-center justify-between px-3.5 py-2 text-xs hover:bg-white/[0.03]">
                    <span className="font-mono text-gray-300">{g.name} (GID: {g.gid})</span>
                    <button
                      onClick={() => handleJoinGroup(g.name)}
                      className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white text-[11px] font-semibold transition-colors"
                    >
                      + Add
                    </button>
                  </div>
                ))}
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setGroupModalUser(null)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
