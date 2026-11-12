import { useEffect, useRef, useCallback } from 'react';

/**
 * Cancels in-flight requests and discards stale promise resolutions whenever
 * the component unmounts OR the active SSH connection changes.
 */
export function useCancellableSshRequest(activeConnId?: string | null) {
  const epochRef = useRef(0);
  const controllersRef = useRef<Set<AbortController>>(new Set());

  const cancelAll = useCallback(() => {
    epochRef.current += 1;
    controllersRef.current.forEach((ctrl) => {
      try {
        ctrl.abort();
      } catch {
        // Ignore already aborted controllers
      }
    });
    controllersRef.current.clear();
  }, []);

  useEffect(() => {
    cancelAll();
    return () => {
      cancelAll();
    };
  }, [activeConnId, cancelAll]);

  const runCancellable = useCallback(
    async <T>(task: (ctx: { signal: AbortSignal; isStale: () => boolean }) => Promise<T>): Promise<T | null> => {
      const startEpoch = epochRef.current;
      const controller = new AbortController();
      controllersRef.current.add(controller);

      const isStale = () => startEpoch !== epochRef.current || controller.signal.aborted;

      try {
        const result = await task({ signal: controller.signal, isStale });
        return isStale() ? null : result;
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [],
  );

  return { runCancellable, cancelAll };
}
