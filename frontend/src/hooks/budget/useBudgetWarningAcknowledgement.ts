import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type BudgetWarningSeverity = "warning" | "error";
type Acknowledgement = BudgetWarningSeverity | null;

const memory = new Map<string, Acknowledgement>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readAcknowledgement(key: string): Acknowledgement {
  // Keep changes during this page's lifetime even if storage is blocked.
  const inMemory = memory.get(key);
  if (inMemory !== undefined) return inMemory;
  try {
    const stored = window.sessionStorage.getItem(key);
    return stored === "warning" || stored === "error" ? stored : null;
  } catch {
    return null;
  }
}

function writeAcknowledgement(key: string, severity: Acknowledgement) {
  if (readAcknowledgement(key) === severity) return;
  memory.set(key, severity);
  try {
    if (severity === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, severity);
    }
  } catch {
    // The in-memory value is still available to other composer instances.
  }
  listeners.forEach((listener) => listener());
}

/**
 * A null severity means tracking is disabled or spending is below threshold.
 * An undefined severity means there is no confirmed budget state to act on.
 */
export function useBudgetWarningAcknowledgement(
  userId: string | undefined,
  confirmedSeverity: BudgetWarningSeverity | null | undefined,
) {
  const key = userId ? `erato:budget-warning-dismissed:${userId}` : null;
  const [localAcknowledgement, setLocalAcknowledgement] =
    useState<Acknowledgement>(null);
  const sessionAcknowledgement = useSyncExternalStore(
    subscribe,
    () => (key ? readAcknowledgement(key) : null),
    () => null,
  );
  const acknowledgement = key ? sessionAcknowledgement : localAcknowledgement;

  const setAcknowledgement = useCallback(
    (severity: Acknowledgement) => {
      if (key) {
        writeAcknowledgement(key, severity);
      } else {
        setLocalAcknowledgement(severity);
      }
    },
    [key],
  );

  useEffect(() => {
    if (key) setLocalAcknowledgement(null);
  }, [key]);

  useEffect(() => {
    if (
      confirmedSeverity !== undefined &&
      acknowledgement !== null &&
      acknowledgement !== confirmedSeverity
    ) {
      setAcknowledgement(null);
    }
  }, [acknowledgement, confirmedSeverity, setAcknowledgement]);

  return [acknowledgement, setAcknowledgement] as const;
}
