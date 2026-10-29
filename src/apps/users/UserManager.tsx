import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Users, UserPlus, Shield, Trash2, Lock, Unlock, Search, RefreshCw, 
  Terminal, Key, X, Check, Plus, Folder, UserCheck, ShieldAlert, 
  LogOut, Layers, AlertCircle, CheckCircle2, ChevronRight, UserX,
  Settings, ExternalLink, HardDrive, ShieldCheck, Copy, MoreHorizontal,
  UserMinus, AlertTriangle
} from 'lucide-react';
import { 
  userList, groupList, userAdd, userDelete, userLock, userUnlock, sshExec,
  groupAdd, groupDelete, groupAddUser, groupRemoveUser, whoIsLoggedIn,
  userSetPassword, userToggleSudo
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { useUserPrivilege } from '../../lib/permissions';
import PermissionAlertBanner from '../../components/PermissionAlertBanner';
import PermissionAlertModal from '../../components/PermissionAlertModal';
import { PortalContextMenu } from '../../components/PortalContextMenu';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'users' | 'groups' | 'sessions'>('users');
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [groups, setGroups] = useState<GroupEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  
  // Selected user, group, and session for keyboard navigation and inspection
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [selectedSessionIndex, setSelectedSessionIndex] = useState<number | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUser, setNewUser] = useState({ username: '', shell: '/bin/bash', sudo: false, password: '' });
  const [addUserError, setAddUserError] = useState<string | null>(null);
  const [isAddingUser, setIsAddingUser] = useState(false);

  const [showAddGroupModal, setShowAddGroupModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addGroupError, setAddGroupError] = useState<string | null>(null);
  const [isAddingGroup, setIsAddingGroup] = useState(false);

  // Edit Group Modal
  const [editGroupModal, setEditGroupModal] = useState<GroupEntry | null>(null);
  const [selectedUserToAdd, setSelectedUserToAdd] = useState<string>('');
  const [editGroupError, setEditGroupError] = useState<string | null>(null);
  const [editGroupLoading, setEditGroupLoading] = useState(false);

  // Confirmation Alert Modal State (for Delete User, Delete Group, and Kick Session)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    confirmVariant?: 'danger' | 'warning' | 'info';
    isAlertOnly?: boolean;
    onConfirm?: () => Promise<void> | void;
    isExecuting?: boolean;
    icon?: React.ElementType;
  } | null>(null);

  // Action Loading tracking (for lock toggle, sudo toggle, etc.)
  const [lockingUser, setLockingUser] = useState<string | null>(null);
  const [togglingSudoUser, setTogglingSudoUser] = useState<string | null>(null);
  const [isSubmittingPassword, setIsSubmittingPassword] = useState(false);

  // Context Menu
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    type: 'user' | 'group' | 'session';
    data: any;
  } | null>(null);

  // Password & Group Management Modals
  const [passwordModalUser, setPasswordModalUser] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<{ text: string; isError?: boolean } | null>(null);

  const [groupModalUser, setGroupModalUser] = useState<UserEntry | null>(null);
  const [customGroupName, setCustomGroupName] = useState('');
  const [groupStatus, setGroupStatus] = useState<string | null>(null);

  // Notification Toast
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [restrictedAction, setRestrictedAction] = useState<string | null>(null);

  // Popup Window Error Alert Modal
  const showErrorModal = useCallback((title: string, message: string) => {
    setConfirmModal({
      isOpen: true,
      title,
      icon: ShieldAlert,
      confirmVariant: 'danger',
      isAlertOnly: true,
      confirmText: 'Dismiss',
      onConfirm: () => setConfirmModal(null),
      message: (
        <div className="space-y-3 text-xs text-left">
          <p className="text-gray-300 font-sans">An error occurred while executing this administrative action on the server:</p>
          <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 font-mono text-[11px] leading-relaxed break-words max-h-48 overflow-y-auto">
            {message}
          </div>
        </div>
      )
    });
  }, []);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { hasSudo, isRoot, username: currentUsername } = useUserPrivilege();
  const { openApp } = useWindowManager();
  const { navigateFinder, runTerminalCommand } = useEditorStore();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [uList, gList, whoOutput] = await Promise.all([
        userList(activeConnId).catch(() => []),
        groupList(activeConnId).catch(() => []),
        whoIsLoggedIn(activeConnId).catch(() => '')
      ]);

      if (uList && uList.length > 0) {
        const mappedUsers: UserEntry[] = uList.map((u: any) => ({
          username: u.username,
          uid: u.uid,
          gid: u.gid,
          home: u.home || `/home/${u.username}`,
          shell: u.shell || '/bin/bash',
          groups: u.groups || [],
          isSudo: (u.groups || []).includes('sudo') || (u.groups || []).includes('wheel') || (u.groups || []).includes('admin') || u.uid === 0,
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

      // Active login sessions: parse whoIsLoggedIn output with fallback
      let rawWho = whoOutput || '';
      if (!rawWho || !rawWho.trim()) {
        try {
          const res = await sshExec(activeConnId, 'who 2>/dev/null || w -h 2>/dev/null || loginctl list-sessions --no-legend 2>/dev/null');
          rawWho = res?.stdout || '';
        } catch {
          // fallback
        }
      }

      const parsedSessions: ActiveSession[] = [];
      if (rawWho && rawWho.trim()) {
        const lines = rawWho.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          if (line.includes('(No active login sessions found)')) continue;
          const parts = line.includes('\t')
            ? line.split('\t').map(s => s.trim())
            : line.trim().split(/\s+/);
          if (parts.length >= 2) {
            parsedSessions.push({
              user: parts[0] || 'unknown',
              tty: parts[1] || 'pty',
              from: parts.length > 4 ? parts.slice(4).join(' ').replace(/[()]/g, '') : (parts[2] || 'local/pty').replace(/[()]/g, ''),
              loginAt: parts.length > 3 ? `${parts[2] || ''} ${parts[3] || ''}`.trim() : (parts[2] || 'Active Now'),
              idle: 'Active Now'
            });
          }
        }
      }

      // If still empty, check active user via whoami
      if (parsedSessions.length === 0) {
        try {
          const whoamiRes = await sshExec(activeConnId, 'whoami 2>/dev/null; tty 2>/dev/null; date "+%Y-%m-%d %H:%M" 2>/dev/null');
          if (whoamiRes && whoamiRes.stdout) {
            const [me, myTty, myDate] = whoamiRes.stdout.trim().split('\n').map(s => s.trim());
            if (me) {
              parsedSessions.push({
                user: me,
                tty: myTty && myTty.startsWith('/dev/') ? myTty.replace('/dev/', '') : (myTty || 'pts/0'),
                from: 'SSH Desktop (SSH Session)',
                loginAt: myDate || 'Active Now',
                idle: 'Active Now'
              });
            }
          }
        } catch {
          // ignore
        }
      }

      setSessions(parsedSessions);
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
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`${currentlyLocked ? 'Unlock' : 'Lock'} User Account '${username}'`);
      return;
    }
    if (username === 'root') {
      setNotice({ text: 'Cannot lock the root superuser account.', isError: true });
      return;
    }
    setLockingUser(username);
    try {
      if (currentlyLocked) {
        await userUnlock(activeConnId, username);
      } else {
        await userLock(activeConnId, username);
      }
      setUsers(prev =>
        prev.map(u => (u.username === username ? { ...u, isLocked: !currentlyLocked } : u))
      );
      setNotice({ 
        text: `User account '${username}' successfully ${currentlyLocked ? 'unlocked' : 'locked'}.`, 
        isError: false 
      });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setNotice({ text: `Failed to ${currentlyLocked ? 'unlock' : 'lock'} user '${username}': ${msg}`, isError: true });
      showErrorModal(`Failed to ${currentlyLocked ? 'Unlock' : 'Lock'} User`, msg);
    } finally {
      setLockingUser(null);
    }
  };

  const toggleSudoPrivilege = async (username: string, currentlySudo: boolean) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`${currentlySudo ? 'Revoke' : 'Grant'} Sudo Privileges for '${username}'`);
      return;
    }
    if (username === 'root') {
      showErrorModal('Operation Restricted', 'Root superuser always has full administrative privileges.');
      return;
    }
    setTogglingSudoUser(username);
    try {
      await userToggleSudo(activeConnId, username, !currentlySudo);
      setNotice({ 
        text: currentlySudo 
          ? `Revoked sudo administrative privileges from '${username}'.` 
          : `Granted sudo administrative privileges to '${username}'.`, 
        isError: false 
      });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setNotice({ text: `Failed to change administrative privileges for '${username}': ${msg}`, isError: true });
      showErrorModal('Failed to Modify Administrative Privileges', msg);
    } finally {
      setTogglingSudoUser(null);
    }
  };

  // Safe user delete with custom confirmation modal
  const promptDeleteUser = (username: string) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Delete User Account '${username}'`);
      return;
    }
    if (username === 'root') {
      setNotice({ text: 'Cannot delete the root superuser account.', isError: true });
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'Delete User Account',
      confirmText: 'Delete User Permanently',
      confirmVariant: 'danger',
      icon: Trash2,
      message: (
        <div className="space-y-3 text-xs">
          <div className="flex items-center space-x-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center font-bold text-white text-sm shadow">
              {username[0]?.toUpperCase()}
            </div>
            <div>
              <div className="font-bold text-sm text-white font-mono">{username}</div>
              <div className="text-[11px] text-gray-400">Home: /home/{username}</div>
            </div>
          </div>
          <p className="text-gray-300">
            Are you sure you want to permanently delete this user account from the server?
          </p>
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px] flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>
              <strong>Warning:</strong> The user account and their entire home directory (<span className="font-mono">/home/{username}</span>) will be removed. This operation cannot be undone.
            </span>
          </div>
        </div>
      ),
      onConfirm: async () => {
        try {
          setConfirmModal(prev => prev ? { ...prev, isExecuting: true } : null);
          await userDelete(activeConnId, username, true);
          setUsers(prev => prev.filter(u => u.username !== username));
          if (selectedUsername === username) {
            setSelectedUsername(users.find(u => u.username !== username)?.username || null);
          }
          setNotice({ text: `User account '${username}' and home directory deleted successfully.`, isError: false });
          setTimeout(() => setNotice(null), 4000);
          setConfirmModal(null);
          await loadData();
        } catch (err: any) {
          const msg = err?.message || String(err);
          setNotice({ text: `Failed to delete user '${username}': ${msg}`, isError: true });
          showErrorModal('Failed to Delete User', msg);
          setConfirmModal(prev => prev ? { ...prev, isExecuting: false } : null);
        }
      }
    });
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username.trim()) return;
    setIsAddingUser(true);
    setAddUserError(null);
    try {
      // Determine appropriate administrative group based on the server's existing groups
      let sudoGroups: string[] = [];
      if (newUser.sudo) {
        const hasWheel = groups.some(g => g.name === 'wheel');
        const hasSudo = groups.some(g => g.name === 'sudo');
        if (hasWheel && !hasSudo) {
          sudoGroups = ['wheel'];
        } else {
          sudoGroups = ['sudo'];
        }
      }

      await userAdd(
        activeConnId,
        newUser.username.trim(),
        newUser.password.trim() || undefined,
        newUser.shell,
        sudoGroups
      );
      setShowAddModal(false);
      setAddUserError(null);
      const createdUsername = newUser.username.trim();
      setNewUser({ username: '', shell: '/bin/bash', sudo: false, password: '' });
      setSelectedUsername(createdUsername);
      setNotice({ text: `User account '${createdUsername}' created successfully!`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setAddUserError(msg);
      setNotice({ text: `Failed to create user: ${msg}`, isError: true });
      showErrorModal('Failed to Create User', msg);
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setIsAddingGroup(true);
    setAddGroupError(null);
    try {
      await groupAdd(activeConnId, newGroupName.trim());
      setShowAddGroupModal(false);
      setAddGroupError(null);
      const createdGroup = newGroupName.trim();
      setNewGroupName('');
      setSelectedGroupName(createdGroup);
      setNotice({ text: `Group '${createdGroup}' created successfully!`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setAddGroupError(msg);
      setNotice({ text: `Failed to create group: ${msg}`, isError: true });
      showErrorModal('Failed to Create Group', msg);
    } finally {
      setIsAddingGroup(false);
    }
  };

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordModalUser || !newPassword) return;
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Change Password for '${passwordModalUser}'`);
      return;
    }
    setIsSubmittingPassword(true);
    setPasswordStatus({ text: 'Applying new password...' });
    try {
      await userSetPassword(activeConnId, passwordModalUser, newPassword);
      setPasswordStatus({ text: 'Password updated successfully!' });
      setNotice({ text: `Password for '${passwordModalUser}' updated successfully!`, isError: false });
      setTimeout(() => {
        setPasswordModalUser(null);
        setNewPassword('');
        setPasswordStatus(null);
        setIsSubmittingPassword(false);
      }, 1000);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setPasswordStatus({ text: `Failed: ${msg}`, isError: true });
      setNotice({ text: `Failed to update password: ${msg}`, isError: true });
      showErrorModal('Failed to Change Password', msg);
      setIsSubmittingPassword(false);
    }
  };

  const handleJoinGroup = async (groupName: string) => {
    if (!groupModalUser || !groupName) return;
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Add User '${groupModalUser.username}' to Group '${groupName}'`);
      return;
    }
    try {
      setGroupStatus(`Adding to ${groupName}...`);
      await groupAddUser(activeConnId, groupName, groupModalUser.username);
      setGroupStatus(`User joined group '${groupName}'!`);
      setNotice({ text: `Added user '${groupModalUser.username}' to group '${groupName}'.`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
      setGroupModalUser(prev => prev ? { ...prev, groups: [...prev.groups, groupName] } : null);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setGroupStatus(`Failed: ${msg}`);
      setNotice({ text: `Failed to join group: ${msg}`, isError: true });
      showErrorModal('Failed to Join Group', msg);
    }
  };

  const handleRemoveFromGroup = async (groupName: string) => {
    if (!groupModalUser || !groupName) return;
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Remove User '${groupModalUser.username}' from Group '${groupName}'`);
      return;
    }
    try {
      setGroupStatus(`Removing from ${groupName}...`);
      await groupRemoveUser(activeConnId, groupName, groupModalUser.username);
      setGroupStatus(`User removed from group '${groupName}'!`);
      setNotice({ text: `Removed user '${groupModalUser.username}' from group '${groupName}'.`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      await loadData();
      setGroupModalUser(prev => prev ? { ...prev, groups: prev.groups.filter(g => g !== groupName) } : null);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setGroupStatus(`Failed: ${msg}`);
      setNotice({ text: `Failed to remove from group: ${msg}`, isError: true });
      showErrorModal('Failed to Remove from Group', msg);
    }
  };

  // Helper to compute all effective member users for a group
  const getGroupMembers = useCallback((grp: GroupEntry) => {
    const directMembers = grp.members || [];
    const inferredMembers = users
      .filter(u => (u.groups || []).includes(grp.name) || u.gid === grp.gid)
      .map(u => u.username);
    return Array.from(new Set([...directMembers, ...inferredMembers]));
  }, [users]);

  // Safe group delete with active user prevention and confirmation modal
  const promptDeleteGroup = (grp: GroupEntry) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Delete Group '${grp.name}'`);
      return;
    }
    const mems = getGroupMembers(grp);
    if (mems.length > 0) {
      setConfirmModal({
        isOpen: true,
        title: 'Cannot Delete Group',
        confirmText: 'Understood',
        confirmVariant: 'info',
        isAlertOnly: true,
        icon: ShieldAlert,
        message: (
          <div className="space-y-3 text-xs">
            <div className="flex items-center space-x-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-bold text-white shadow">
                <Layers className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-sm text-white font-mono">{grp.name}</div>
                <div className="text-[11px] text-gray-400 font-mono">GID: {grp.gid} · {mems.length} Active Member(s)</div>
              </div>
            </div>
            <p className="text-gray-300">
              Cannot delete group <strong className="text-white font-mono">{grp.name}</strong> because it still contains active member users:
            </p>
            <div className="flex flex-wrap gap-1.5 p-2.5 rounded-xl bg-black/40 border border-white/10 max-h-28 overflow-y-auto font-mono text-[11px]">
              {mems.map(m => (
                <span key={m} className="px-2.5 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  {m}
                </span>
              ))}
            </div>
            <p className="text-amber-300/90 text-[11px] bg-amber-500/10 p-2.5 rounded-xl border border-amber-500/20">
              💡 Please edit the group and remove all member users before deleting this group.
            </p>
          </div>
        ),
        onConfirm: () => {
          setConfirmModal(null);
        }
      });
      return;
    }

    if (['root', 'sudo', 'wheel', 'daemon', 'admin'].includes(grp.name)) {
      setNotice({ text: `Cannot delete protected system group '${grp.name}'.`, isError: true });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Delete Group',
      confirmText: 'Delete Group',
      confirmVariant: 'danger',
      icon: Trash2,
      message: (
        <div className="space-y-3 text-xs">
          <div className="flex items-center space-x-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center font-bold text-white shadow">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-white font-mono">{grp.name}</div>
              <div className="text-[11px] text-gray-400 font-mono">GID: {grp.gid}</div>
            </div>
          </div>
          <p className="text-gray-300">
            Are you sure you want to permanently delete group <strong className="text-white font-mono">{grp.name}</strong>?
          </p>
          <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[11px]">
            ⚠️ This will remove the group definition from the remote server.
          </div>
        </div>
      ),
      onConfirm: async () => {
        try {
          setConfirmModal(prev => prev ? { ...prev, isExecuting: true } : null);
          await groupDelete(activeConnId, grp.name);
          setNotice({ text: `Group '${grp.name}' deleted successfully.`, isError: false });
          setTimeout(() => setNotice(null), 4000);
          setGroups(prev => prev.filter(g => g.name !== grp.name));
          if (selectedGroupName === grp.name) setSelectedGroupName(null);
          setConfirmModal(null);
          await loadData();
        } catch (err: any) {
          const msg = err?.message || String(err);
          setNotice({ text: `Failed to delete group '${grp.name}': ${msg}`, isError: true });
          showErrorModal('Failed to Delete Group', msg);
          setConfirmModal(prev => prev ? { ...prev, isExecuting: false } : null);
        }
      }
    });
  };

  const handleAddUserToGroup = async (groupName: string, username: string) => {
    if (!groupName || !username) return;
    setEditGroupLoading(true);
    setEditGroupError(null);
    try {
      await groupAddUser(activeConnId, groupName, username);
      setNotice({ text: `Added user '${username}' to group '${groupName}' successfully.`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      setEditGroupModal(prev => prev ? {
        ...prev,
        members: Array.from(new Set([...prev.members, username]))
      } : null);
      setSelectedUserToAdd('');
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setEditGroupError(`Failed to add user: ${msg}`);
      setNotice({ text: `Failed to add user to group: ${msg}`, isError: true });
    } finally {
      setEditGroupLoading(false);
    }
  };

  const handleRemoveUserFromGroup = async (groupName: string, username: string) => {
    if (!groupName || !username) return;
    setEditGroupLoading(true);
    setEditGroupError(null);
    try {
      await groupRemoveUser(activeConnId, groupName, username);
      setNotice({ text: `Removed user '${username}' from group '${groupName}' successfully.`, isError: false });
      setTimeout(() => setNotice(null), 4000);
      setEditGroupModal(prev => prev ? {
        ...prev,
        members: prev.members.filter(m => m !== username)
      } : null);
      await loadData();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setEditGroupError(`Failed to remove user: ${msg}`);
      setNotice({ text: `Failed to remove user from group: ${msg}`, isError: true });
    } finally {
      setEditGroupLoading(false);
    }
  };

  // Safe session termination with confirmation modal
  const promptKickSession = (session: ActiveSession) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Terminate Session for '${session.user}'`);
      return;
    }
    setConfirmModal({
      isOpen: true,
      title: 'Disconnect Active Session',
      confirmText: 'Disconnect / Kick',
      confirmVariant: 'danger',
      icon: LogOut,
      message: (
        <div className="space-y-3 text-xs">
          <div className="flex items-center space-x-3 p-3 rounded-2xl bg-white/[0.03] border border-white/10">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-rose-500 to-red-600 flex items-center justify-center font-bold text-white shadow">
              <LogOut className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm text-emerald-400 font-mono flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>{session.user}</span>
              </div>
              <div className="text-[11px] text-gray-400 font-mono">Terminal: {session.tty} · Host: {session.from}</div>
            </div>
          </div>
          <p className="text-gray-300">
            Are you sure you want to terminate the active session for user <strong className="text-white font-mono">{session.user}</strong> on terminal <strong className="text-white font-mono">{session.tty}</strong>?
          </p>
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px]">
            ⚠️ This will forcibly kill the terminal session and disconnect the user immediately.
          </div>
        </div>
      ),
      onConfirm: async () => {
        try {
          setConfirmModal(prev => prev ? { ...prev, isExecuting: true } : null);
          const res = await sshExec(activeConnId, `sudo pkill -9 -t '${session.tty}' 2>&1 || sudo fuser -k '/dev/${session.tty}' 2>&1`);
          if (res.exit_code !== 0 && !res.stdout.includes('killed')) {
            throw new Error(res.stderr || res.stdout || 'Command failed to kill session process');
          }
          setNotice({ text: `Active session on ${session.tty} (${session.user}) disconnected successfully.`, isError: false });
          setTimeout(() => setNotice(null), 4000);
          setConfirmModal(null);
          await loadData();
        } catch (err: any) {
          const msg = err?.message || String(err);
          setNotice({ text: `Failed to disconnect session: ${msg}`, isError: true });
          showErrorModal('Failed to Terminate Session', msg);
          setConfirmModal(prev => prev ? { ...prev, isExecuting: false } : null);
        }
      }
    });
  };

  // Clamped Right-Click Context Menu using universal Portal
  const openContextMenu = (e: React.MouseEvent, type: 'user' | 'group' | 'session', data: any) => {
    e.preventDefault();
    e.stopPropagation();

    if (type === 'user') setSelectedUsername(data.username);
    if (type === 'group') setSelectedGroupName(data.name);
    if (type === 'session') {
      const idx = sessions.findIndex(s => s === data);
      if (idx >= 0) setSelectedSessionIndex(idx);
    }

    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      type,
      data
    });
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

  // Arrow Up / Down selection navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAddModal || showAddGroupModal || passwordModalUser || groupModalUser || editGroupModal) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (tab === 'users' && filteredUsers.length > 0) {
        const curIdx = filteredUsers.findIndex(u => u.username === selectedUsername);
        const nextIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, filteredUsers.length - 1);
        setSelectedUsername(filteredUsers[nextIdx].username);
        const el = document.getElementById(`user-row-${filteredUsers[nextIdx].username}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (tab === 'groups' && filteredGroups.length > 0) {
        const curIdx = filteredGroups.findIndex(g => g.name === selectedGroupName);
        const nextIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, filteredGroups.length - 1);
        setSelectedGroupName(filteredGroups[nextIdx].name);
        const el = document.getElementById(`group-row-${filteredGroups[nextIdx].name}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (tab === 'sessions' && sessions.length > 0) {
        const curIdx = selectedSessionIndex === null ? -1 : selectedSessionIndex;
        const nextIdx = curIdx < 0 ? 0 : Math.min(curIdx + 1, sessions.length - 1);
        setSelectedSessionIndex(nextIdx);
        const el = document.getElementById(`session-row-${nextIdx}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (tab === 'users' && filteredUsers.length > 0) {
        const curIdx = filteredUsers.findIndex(u => u.username === selectedUsername);
        const prevIdx = curIdx <= 0 ? 0 : curIdx - 1;
        setSelectedUsername(filteredUsers[prevIdx].username);
        const el = document.getElementById(`user-row-${filteredUsers[prevIdx].username}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (tab === 'groups' && filteredGroups.length > 0) {
        const curIdx = filteredGroups.findIndex(g => g.name === selectedGroupName);
        const prevIdx = curIdx <= 0 ? 0 : curIdx - 1;
        setSelectedGroupName(filteredGroups[prevIdx].name);
        const el = document.getElementById(`group-row-${filteredGroups[prevIdx].name}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else if (tab === 'sessions' && sessions.length > 0) {
        const curIdx = selectedSessionIndex === null ? 0 : selectedSessionIndex;
        const prevIdx = curIdx <= 0 ? 0 : curIdx - 1;
        setSelectedSessionIndex(prevIdx);
        const el = document.getElementById(`session-row-${prevIdx}`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    } else if (e.key === 'Escape') {
      setContextMenu(null);
    }
  }, [tab, filteredUsers, selectedUsername, filteredGroups, selectedGroupName, sessions, selectedSessionIndex, showAddModal, showAddGroupModal, passwordModalUser, groupModalUser, editGroupModal]);

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onClick={() => setContextMenu(null)}
      className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative outline-none ${loading ? 'cursor-mac-wait' : ''}`}
    >
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      {/* macOS Top Navigation Toolbar */}
      <div className="bg-[#14141e]/95 backdrop-blur-2xl border-b border-white/[0.08] px-4 pt-1.5 pb-0 flex items-center justify-between shrink-0 space-x-3 overflow-x-auto scrollbar-thin">
        {/* Animated Straight Line Moving Left Right Tab Bar */}
        <div className="flex items-center space-x-1 relative">
          {[
            { id: 'users', label: 'Users', count: users.length, icon: Users },
            { id: 'groups', label: 'Groups', count: groups.length, icon: Layers },
            { id: 'sessions', label: 'Active Logins', count: sessions.length, icon: UserCheck },
          ].map(t => {
            const isActive = tab === t.id;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id as any)}
                className={`relative px-4 py-2.5 text-xs font-semibold flex items-center space-x-2 transition-colors cursor-pointer select-none rounded-t-xl ${
                  isActive ? 'text-white' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-blue-400' : 'text-gray-400'}`} />
                <span>{t.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono transition-colors ${
                  isActive ? 'bg-blue-500/25 text-blue-300 font-bold' : 'bg-white/5 text-gray-500'
                }`}>
                  {t.count}
                </span>

                {/* Animated Straight Line Moving Left Right */}
                {isActive && (
                  <motion.div
                    layoutId="activeTabUnderline"
                    className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.9)] rounded-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Right Tools: Add User, Add Group, Search, Refresh */}
        <div className="flex items-center space-x-2 shrink-0 pb-1.5">
          {tab === 'users' && (
            <button
              onClick={() => {
                if (!hasSudo && !isRoot) {
                  setRestrictedAction('Create User Account');
                  return;
                }
                setShowAddModal(true);
              }}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-xl transition-all font-medium shadow-md active:scale-95 cursor-pointer"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Add User</span>
            </button>
          )}

          {tab === 'groups' && (
            <button
              onClick={() => {
                if (!hasSudo && !isRoot) {
                  setRestrictedAction('Create New Group');
                  return;
                }
                setShowAddGroupModal(true);
              }}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-xl transition-all font-medium shadow-md active:scale-95 cursor-pointer"
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
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 cursor-pointer">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Refresh Users & Groups"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice Toast */}
      {notice && (
        <div className={`mx-4 mt-2.5 px-3.5 py-2.5 rounded-2xl text-xs flex items-center justify-between shadow-xl animate-in fade-in slide-in-from-top-1 ${
          notice.isError 
            ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40 shadow-rose-900/20' 
            : 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 shadow-emerald-900/20'
        }`}>
          <div className="flex items-center space-x-2.5 font-mono text-[11px] leading-relaxed">
            {notice.isError ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{notice.text}</span>
          </div>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white p-1 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Permission Alert Banner */}
      <div className="mx-4 mt-2.5 shrink-0">
        <PermissionAlertBanner appName="User Manager" />
      </div>

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
                      id={`user-row-${user.username}`}
                      onClick={() => setSelectedUsername(user.username)}
                      onContextMenu={e => openContextMenu(e, 'user', user)}
                      className={`p-2.5 rounded-2xl cursor-pointer transition-all flex items-center justify-between select-none ${
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
                        <div className="text-xs font-semibold text-white flex items-center space-x-2">
                          <span>Administrator Privileges (sudo)</span>
                          {togglingSudoUser === selectedUserObj.username && (
                            <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400">Allow this user to execute administrative commands via sudo.</div>
                      </div>
                      <button
                        disabled={togglingSudoUser === selectedUserObj.username}
                        onClick={() => toggleSudoPrivilege(selectedUserObj.username, selectedUserObj.isSudo)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                          selectedUserObj.isSudo ? 'bg-blue-600' : 'bg-gray-700'
                        }`}
                        title={selectedUserObj.isSudo ? 'Click to revoke administrative privileges' : 'Click to grant administrative privileges'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            selectedUserObj.isSudo ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Lock Account Switch with proper async loading */}
                    <div className="flex items-center justify-between py-2 border-b border-white/[0.06]">
                      <div>
                        <div className="text-xs font-semibold text-white flex items-center space-x-2">
                          <span>Lock Account Access</span>
                          {lockingUser === selectedUserObj.username && (
                            <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          {selectedUserObj.isLocked
                            ? 'Account is currently locked. Password & SSH logins are disabled.'
                            : 'Disables all login access (password & SSH keys) for this user account.'}
                        </div>
                      </div>
                      <button
                        disabled={lockingUser === selectedUserObj.username}
                        onClick={() => toggleLock(selectedUserObj.username, selectedUserObj.isLocked)}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                          selectedUserObj.isLocked ? 'bg-amber-600' : 'bg-gray-700'
                        }`}
                        title={selectedUserObj.isLocked ? 'Click to unlock account' : 'Click to lock account'}
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
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
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
                        className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
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
                          className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
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
                          onClick={() => promptDeleteUser(selectedUserObj.username)}
                          className="px-3.5 py-1.5 bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white rounded-xl text-xs font-semibold border border-rose-500/30 transition-all flex items-center space-x-1.5 cursor-pointer active:scale-95 shadow-sm"
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
                  filteredGroups.map(grp => {
                    const isSelected = selectedGroupName === grp.name;
                    const mems = getGroupMembers(grp);
                    const hasMembers = mems.length > 0;
                    return (
                      <tr 
                        key={grp.name} 
                        id={`group-row-${grp.name}`}
                        onClick={() => setSelectedGroupName(grp.name)}
                        onContextMenu={e => openContextMenu(e, 'group', grp)}
                        className={`hover:bg-white/[0.04] transition-colors cursor-pointer select-none ${
                          isSelected ? 'bg-blue-600/25 ring-1 ring-blue-500/50 text-white font-medium' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-mono font-bold text-white flex items-center space-x-2">
                          <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span>{grp.name}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-400 font-mono">{grp.gid}</td>
                        <td className="py-2 px-3 text-gray-300 font-sans">
                          {mems.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {mems.map(m => (
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
                          <div className="flex items-center justify-end space-x-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditGroupModal(grp);
                                setEditGroupError(null);
                                setSelectedUserToAdd('');
                              }}
                              className="p-1 rounded-lg bg-blue-500/15 hover:bg-blue-500 text-blue-300 hover:text-white transition-all shadow-sm"
                              title="Edit Group (Add / Remove Users)"
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                promptDeleteGroup(grp);
                              }}
                              className={`p-1.5 rounded-xl transition-all cursor-pointer ${
                                hasMembers
                                  ? 'hover:bg-amber-500/20 text-gray-400 hover:text-amber-300'
                                  : 'hover:bg-rose-500/20 text-gray-400 hover:text-rose-400'
                              }`}
                              title={
                                hasMembers
                                  ? `Group has ${mems.length} member user(s). Click to view alert.`
                                  : "Delete Group"
                              }
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
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
                  sessions.map((sess, idx) => {
                    const isSelected = selectedSessionIndex === idx;
                    return (
                      <tr 
                        key={idx} 
                        id={`session-row-${idx}`}
                        onClick={() => setSelectedSessionIndex(idx)}
                        onContextMenu={e => openContextMenu(e, 'session', sess)}
                        className={`hover:bg-white/[0.04] transition-colors cursor-pointer select-none ${
                          isSelected ? 'bg-blue-600/25 ring-1 ring-blue-500/50 text-white font-medium' : ''
                        }`}
                      >
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
                            onClick={(e) => {
                              e.stopPropagation();
                              promptKickSession(sess);
                            }}
                            className="px-2.5 py-1 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/30 text-[10px] font-semibold transition-all cursor-pointer shadow-sm active:scale-95 flex items-center space-x-1 ml-auto"
                            title="Disconnect Session"
                          >
                            <LogOut className="w-3 h-3" />
                            <span>Kick</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
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
                disabled={isAddingUser}
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isAddingUser && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isAddingUser ? 'Creating...' : 'Create Account'}</span>
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
              <button type="button" onClick={() => { setShowAddGroupModal(false); setAddGroupError(null); }} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white cursor-pointer">
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
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isAddingGroup}
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                {isAddingGroup && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isAddingGroup ? 'Creating...' : 'Create Group'}</span>
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
              <button type="button" onClick={() => setPasswordModalUser(null)} className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordStatus && (
              <div className={`p-2.5 rounded-xl border text-xs font-mono flex items-center space-x-2 ${
                passwordStatus.isError
                  ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                  : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              }`}>
                {passwordStatus.isError ? (
                  <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                )}
                <span>{passwordStatus.text}</span>
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
                className="px-3.5 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newPassword || isSubmittingPassword}
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1.5 cursor-pointer"
              >
                {isSubmittingPassword && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSubmittingPassword ? 'Updating...' : 'Update Password'}</span>
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

      {/* Edit Group Modal (Add / Remove Users) */}
      {editGroupModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-lg p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Edit Group: {editGroupModal.name}</h3>
                  <span className="text-[10px] text-gray-400 font-mono">GID: {editGroupModal.gid}</span>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => {
                  setEditGroupModal(null);
                  setEditGroupError(null);
                  setSelectedUserToAdd('');
                }} 
                className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editGroupError && (
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{editGroupError}</div>
              </div>
            )}

            {/* Section 1: Add User to Group */}
            <div className="space-y-2 p-3.5 bg-[#101018] rounded-2xl border border-white/[0.06]">
              <label className="text-xs font-semibold text-white block">Add User to &ldquo;{editGroupModal.name}&rdquo;</label>
              <div className="flex space-x-2">
                <select
                  value={selectedUserToAdd}
                  onChange={e => setSelectedUserToAdd(e.target.value)}
                  className="flex-1 bg-[#141624] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                >
                  <option value="">-- Choose a user to add --</option>
                  {users
                    .filter(u => !(editGroupModal.members || []).includes(u.username))
                    .map(u => (
                      <option key={u.username} value={u.username}>
                        {u.username} (UID: {u.uid})
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  onClick={() => handleAddUserToGroup(editGroupModal.name, selectedUserToAdd)}
                  disabled={!selectedUserToAdd || editGroupLoading}
                  className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 shadow-md transition-all active:scale-95 shrink-0"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{editGroupLoading ? 'Adding...' : 'Add User'}</span>
                </button>
              </div>
            </div>

            {/* Section 2: Current Group Members */}
            <div className="flex-1 flex flex-col min-h-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300">
                  Current Group Members ({(editGroupModal.members || []).length})
                </span>
                <span className="text-[10px] text-gray-500">Click Remove to detach user</span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] border border-white/[0.08] rounded-2xl max-h-56 bg-[#101018] p-2 space-y-1 scrollbar-thin">
                {(editGroupModal.members || []).length === 0 ? (
                  <div className="py-8 text-center text-gray-500 text-xs">
                    No users currently belong to this group.
                  </div>
                ) : (
                  (editGroupModal.members || []).map(member => {
                    const uObj = users.find(u => u.username === member);
                    return (
                      <div key={member} className="flex items-center justify-between p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition-colors">
                        <div className="flex items-center space-x-2.5">
                          <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-xs text-white shadow-sm">
                            {member[0]?.toUpperCase()}
                          </div>
                          <div>
                            <div className="font-mono text-xs font-bold text-white">{member}</div>
                            {uObj && (
                              <div className="text-[10px] text-gray-400 font-sans">
                                UID: {uObj.uid} · {uObj.isSudo ? 'Administrator' : 'Standard'}
                              </div>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveUserFromGroup(editGroupModal.name, member)}
                          disabled={editGroupLoading}
                          className="px-2.5 py-1 bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white rounded-lg text-[11px] font-semibold transition-all flex items-center space-x-1"
                          title="Remove user from group"
                        >
                          <UserX className="w-3 h-3" />
                          <span>Remove</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  setEditGroupModal(null);
                  setEditGroupError(null);
                  setSelectedUserToAdd('');
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs text-white font-semibold transition-all active:scale-95 shadow-md"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Clamped Portal Context Menu */}
      {contextMenu && contextMenu.visible && (
        <PortalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="w-52 bg-[#1b1c2b]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl p-1.5 text-xs text-gray-200 divide-y divide-white/[0.06]"
        >
          {/* User Context Menu Items */}
          {contextMenu.type === 'user' && (
            <>
              <div className="py-1">
                <div className="px-2.5 py-1 text-[10px] font-bold text-gray-400 truncate uppercase">
                  User: {contextMenu.data.username}
                </div>
                <button
                  onClick={() => {
                    setPasswordModalUser(contextMenu.data.username);
                    setNewPassword('');
                    setPasswordStatus(null);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-xl transition-colors text-left"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Set Password</span>
                </button>
                <button
                  onClick={() => {
                    setGroupModalUser(contextMenu.data);
                    setCustomGroupName('');
                    setGroupStatus(null);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-xl transition-colors text-left"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Manage Groups</span>
                </button>
                <button
                  onClick={() => {
                    toggleSudoPrivilege(contextMenu.data.username, contextMenu.data.isSudo);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-xl transition-colors text-left"
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>{contextMenu.data.isSudo ? 'Revoke Sudo' : 'Grant Sudo'}</span>
                </button>
                <button
                  onClick={() => {
                    toggleLock(contextMenu.data.username, contextMenu.data.isLocked);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-xl transition-colors text-left"
                >
                  {contextMenu.data.isLocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  <span>{contextMenu.data.isLocked ? 'Unlock Account' : 'Lock Account'}</span>
                </button>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.data.username);
                    setNotice({ text: `Copied username '${contextMenu.data.username}'`, isError: false });
                    setTimeout(() => setNotice(null), 2500);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-left text-gray-300"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Username</span>
                </button>
                {contextMenu.data.username !== 'root' && (
                  <button
                    onClick={() => {
                      const userToDelete = contextMenu.data.username;
                      setContextMenu(null);
                      promptDeleteUser(userToDelete);
                    }}
                    className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-rose-600 hover:text-white rounded-xl transition-colors text-left text-rose-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete User</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* Group Context Menu Items */}
          {contextMenu.type === 'group' && (() => {
            const grp = contextMenu.data as GroupEntry;
            const mems = getGroupMembers(grp);
            const hasMembers = mems.length > 0;
            return (
              <>
                <div className="py-1">
                  <div className="px-2.5 py-1 text-[10px] font-bold text-gray-400 truncate uppercase">
                    Group: {grp.name} ({mems.length} users)
                  </div>
                  <button
                    onClick={() => {
                      setEditGroupModal(grp);
                      setEditGroupError(null);
                      setSelectedUserToAdd('');
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-xl transition-colors text-left font-medium text-blue-300"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Edit Group (Add/Remove)</span>
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(grp.name);
                      setNotice({ text: `Copied group name '${grp.name}'`, isError: false });
                      setTimeout(() => setNotice(null), 2500);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-left text-gray-300"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Group Name</span>
                  </button>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(String(grp.gid));
                      setNotice({ text: `Copied GID '${grp.gid}'`, isError: false });
                      setTimeout(() => setNotice(null), 2500);
                      setContextMenu(null);
                    }}
                    className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-left text-gray-300"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy GID ({grp.gid})</span>
                  </button>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => {
                      const groupToDelete = grp;
                      setContextMenu(null);
                      promptDeleteGroup(groupToDelete);
                    }}
                    className={`w-full flex items-center space-x-2 px-2.5 py-1.5 rounded-xl transition-colors text-left ${
                      hasMembers ? 'text-amber-400 hover:bg-amber-600 hover:text-white' : 'text-rose-400 hover:bg-rose-600 hover:text-white'
                    }`}
                    title={hasMembers ? `Group has ${mems.length} members` : 'Delete group'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{hasMembers ? `Delete Group (Has ${mems.length} users)` : 'Delete Group'}</span>
                  </button>
                </div>
              </>
            );
          })()}

          {/* Session Context Menu Items */}
          {contextMenu.type === 'session' && (
            <>
              <div className="py-1">
                <div className="px-2.5 py-1 text-[10px] font-bold text-gray-400 truncate uppercase">
                  Session: {contextMenu.data.user} ({contextMenu.data.tty})
                </div>
                <button
                  onClick={() => {
                    const sessionToKick = contextMenu.data;
                    setContextMenu(null);
                    promptKickSession(sessionToKick);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-rose-600 hover:text-white rounded-xl transition-colors text-left text-rose-300"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Kick / Disconnect</span>
                </button>
              </div>
              <div className="py-1">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.data.user);
                    setNotice({ text: `Copied username '${contextMenu.data.user}'`, isError: false });
                    setTimeout(() => setNotice(null), 2500);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-left text-gray-300"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Username</span>
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(contextMenu.data.tty);
                    setNotice({ text: `Copied TTY '${contextMenu.data.tty}'`, isError: false });
                    setTimeout(() => setNotice(null), 2500);
                    setContextMenu(null);
                  }}
                  className="w-full flex items-center space-x-2 px-2.5 py-1.5 hover:bg-white/10 rounded-xl transition-colors text-left text-gray-300"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy TTY</span>
                </button>
              </div>
            </>
          )}
        </PortalContextMenu>
      )}

      {/* Confirmation Alert Modal (Delete User, Delete Group, and Kick Session) */}
      {confirmModal && confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2.5">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                  confirmModal.confirmVariant === 'danger'
                    ? 'bg-rose-500/20 text-rose-400'
                    : confirmModal.confirmVariant === 'warning'
                    ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {confirmModal.icon ? <confirmModal.icon className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                </div>
                <h3 className="font-bold text-sm text-white">{confirmModal.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div>{confirmModal.message}</div>

            {/* Footer Buttons */}
            <div className="flex justify-end space-x-2 pt-3 border-t border-white/10">
              {!confirmModal.isAlertOnly && (
                <button
                  type="button"
                  disabled={confirmModal.isExecuting}
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                disabled={confirmModal.isExecuting}
                onClick={confirmModal.onConfirm}
                className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer ${
                  confirmModal.confirmVariant === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : confirmModal.confirmVariant === 'warning'
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {confirmModal.isExecuting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>{confirmModal.confirmText || 'Confirm'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Denied Alert Modal */}
      <PermissionAlertModal
        isOpen={!!restrictedAction}
        onClose={() => setRestrictedAction(null)}
        actionName={restrictedAction || ''}
        username={currentUsername}
        appName="User & Group Manager"
      />
    </div>
  );
}
