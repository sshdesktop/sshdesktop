import { useCallback } from 'react';
import { useConnectionStore } from './store';
import { UserPrivilegeInfo } from './types';

export function useUserPrivilege(connectionIdOverride?: string) {
  const { userPrivilege, userPrivileges, activeConnectionId, fetchUserPrivilege, connections } = useConnectionStore();
  const effectiveConnId = connectionIdOverride || activeConnectionId;
  const activeServer = connections.find(c => c.id === effectiveConnId);

  // Look up privilege strictly for this server
  const serverPriv = effectiveConnId 
    ? (userPrivileges?.[effectiveConnId] || (effectiveConnId === activeConnectionId ? userPrivilege : null))
    : null;

  const fallbackUser = activeServer?.username || 'root';
  const username = serverPriv?.username || fallbackUser;
  const isRoot = serverPriv?.is_root ?? (username === 'root');
  const hasSudo = serverPriv?.has_sudo ?? isRoot;
  const sudoType = serverPriv?.sudo_type || (isRoot ? 'root' : 'none');
  const homeDir = serverPriv?.home_dir || (username === 'root' ? '/root' : `/home/${username}`);
  const uid = serverPriv?.uid ?? (username === 'root' ? 0 : 1000);

  const refreshPrivilege = useCallback(async () => {
    if (effectiveConnId) {
      return await fetchUserPrivilege(effectiveConnId);
    }
    return null;
  }, [effectiveConnId, fetchUserPrivilege]);

  return {
    userPrivilege: serverPriv,
    isRoot,
    hasSudo,
    sudoType,
    username,
    homeDir,
    uid,
    refreshPrivilege,
  };
}
