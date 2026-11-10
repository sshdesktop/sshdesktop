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
  // Guard against stale cache: If serverPriv username doesn't match active server config username, invalidate it
  const isStale = Boolean(serverPriv && activeServer?.username && serverPriv.username !== activeServer.username);
  const effectivePriv = isStale ? null : serverPriv;

  const username = effectivePriv?.username || fallbackUser;
  const isRoot = effectivePriv?.is_root ?? (username === 'root');
  const hasSudo = effectivePriv?.has_sudo ?? isRoot;
  const sudoType = effectivePriv?.sudo_type || (isRoot ? 'root' : 'none');
  const homeDir = effectivePriv?.home_dir || (username === 'root' ? '/root' : `/home/${username}`);
  const uid = effectivePriv?.uid ?? (username === 'root' ? 0 : 1000);

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
