import { useState } from 'react';
import { useConnectionStore } from '../store';
import { sshConnect, sshDisconnect } from '../tauri-api';

export function useSSH() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { connect, disconnect } = useConnectionStore();

  const handleConnect = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      await sshConnect(id);
      await connect(id);
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    setLoading(true);
    try {
      await sshDisconnect(id);
      await disconnect(id);
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, handleConnect, handleDisconnect };
}
