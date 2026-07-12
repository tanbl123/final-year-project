import { useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

// Client-side pagination over an in-memory list.
//
// The current page lives in the URL (?page=N) so it survives leaving for a
// detail page and coming back — the user returns to the page they were on
// instead of being bounced to page 1. Returns the current page slice plus the
// controls a list page needs.
//
// Pass `resetKey` (e.g. a serialized filter/search value) to jump back to page 1
// whenever it changes. It's compared against a ref so the reset fires ONLY on a
// real change — never on mount, which under React StrictMode's double-invoked
// effects would otherwise wipe a page just restored from the URL.
export function usePagination(items, pageSize = 10, resetKey) {
  const [searchParams, setSearchParams] = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // clamp during render so a shrinking list (filter/delete) never leaves us
  // stranded on an out-of-range page — no effect, no cascading re-render
  const page = Math.min(Math.max(1, Number(searchParams.get('page')) || 1), totalPages);

  const setPage = useCallback((p) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (p <= 1) next.delete('page'); else next.set('page', String(p));
      return next;
      // replace: don't stack a history entry per page click, so the browser
      // Back button jumps straight to the referrer, not through page numbers
    }, { replace: true });
  }, [setSearchParams]);

  const prevKey = useRef(resetKey);
  useEffect(() => {
    if (resetKey === undefined) return;
    if (prevKey.current !== resetKey) {
      prevKey.current = resetKey;
      setPage(1);
    }
  }, [resetKey, setPage]);

  const pageItems = useMemo(
    () => items.slice((page - 1) * pageSize, page * pageSize),
    [items, page, pageSize]);

  return { page, setPage, totalPages, pageItems };
}
