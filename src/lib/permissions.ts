import { useCallback } from 'react';
import { useConnectionStore } from './store';
import { UserPrivilegeInfo } from './types';

export function useUserPrivilege() {
  const { userPrivilege, activeConnectionId, fetchUserPrivilege, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const username = userPrivilege?.username || activeServer?.username || 'root';
  const isRoot = userPrivilege?.is_root ?? (username === 'root');
  const hasSudo = userPrivilege?.has_sudo ?? isRoot;
  const sudoType = userPrivilege?.sudo_type || (isRoot ? 'root' : 'none');
  const homeDir = userPrivilege?.home_dir || (username === 'root' ? '/root' : `/home/${username}`);
  const uid = userPrivilege?.uid ?? (username === 'root' ? 0 : 1000);

  const refreshPrivilege = useCallback(async () => {
    if (activeConnectionId) {
      return await fetchUserPrivilege(activeConnectionId);
    }
    return null;
  }, [activeConnectionId, fetchUserPrivilege]);

  return {
    userPrivilege,
    isRoot,
    hasSudo,
    sudoType,
    username,
    homeDir,
    uid,
    refreshPrivilege,
  };
}
