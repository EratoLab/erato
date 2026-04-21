import { useCallback, useRef, useState } from "react";

export interface EmailDedupSet {
  /**
   * Render-visible mirror of the dedup set. Suitable for predicates that
   * drive UI (e.g. suppressing the current-email preview when the email is
   * already attached). Lags the ref by at most one render — never read it
   * from inside an async event handler that may race with another handler.
   */
  ids: ReadonlySet<string>;
  /** Synchronous read against the ref. Safe across `await` boundaries. */
  has: (messageId: string) => boolean;
  /**
   * Atomic check-and-add. Returns `true` if the id was newly added, `false`
   * if already present. Two synchronous calls with the same id are
   * guaranteed to return `true` then `false` — this is what makes the hook
   * safe under the cross-await race that a `useState<Set>` cannot solve.
   */
  tryAdd: (messageId: string) => boolean;
  /** Rolls back a prior `tryAdd`. No-op if the id is not present. */
  remove: (messageId: string) => void;
}

export function useEmailDedupSet(): EmailDedupSet {
  const ref = useRef<Set<string>>(new Set());
  const [ids, setIds] = useState<ReadonlySet<string>>(ref.current);

  const has = useCallback((messageId: string): boolean => {
    return ref.current.has(messageId);
  }, []);

  const tryAdd = useCallback((messageId: string): boolean => {
    if (ref.current.has(messageId)) {
      return false;
    }
    ref.current.add(messageId);
    setIds(new Set(ref.current));
    return true;
  }, []);

  const remove = useCallback((messageId: string): void => {
    if (!ref.current.has(messageId)) {
      return;
    }
    ref.current.delete(messageId);
    setIds(new Set(ref.current));
  }, []);

  return { ids, has, tryAdd, remove };
}
