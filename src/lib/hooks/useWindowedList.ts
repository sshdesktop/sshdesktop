import { useState, useMemo, useEffect, useCallback } from 'react';

/**
 * Windowed list pagination helper for rendering large remote tables/directories
 * without mounting thousands of DOM rows at once.
 */
export function useWindowedList<T>(items: T[], initialLimit = 200, step = 200, resetKey?: string | number) {
  const [limit, setLimit] = useState(initialLimit);

  useEffect(() => {
    setLimit(initialLimit);
  }, [initialLimit, resetKey]);

  const visibleItems = useMemo(() => items.slice(0, limit), [items, limit]);
  const hasMore = items.length > limit;
  const remaining = Math.max(0, items.length - visibleItems.length);

  const loadMore = useCallback(() => {
    setLimit((prev) => prev + step);
  }, [step]);

  const showAll = useCallback(() => {
    setLimit(items.length);
  }, [items.length]);

  const resetLimit = useCallback(() => {
    setLimit(initialLimit);
  }, [initialLimit]);

  return {
    visibleItems,
    totalCount: items.length,
    visibleCount: visibleItems.length,
    hasMore,
    remaining,
    loadMore,
    showAll,
    resetLimit,
  };
}
