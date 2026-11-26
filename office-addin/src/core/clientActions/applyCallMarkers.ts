/**
 * Which server-called writes this pane started, kept across a reload: a replayed call whose write
 * had started must never write again, and one that finished answers as it did.
 */
export type ApplyCallMarker =
  | { callId: string; state: "writing"; identity: string }
  | { callId: string; state: "done"; identity: string; result: unknown };

export interface ApplyCallMarkers {
  /** The markers, or null when pane storage cannot be read. */
  read: () => ApplyCallMarker[] | null;
  markWriting: (callId: string, identity: string) => void;
  markDone: (callId: string, identity: string, result: unknown) => void;
  /** This call's marker; null when storage cannot be read. */
  marker: (callId: string) => ApplyCallMarker | undefined | null;
  forget: (callId: string) => void;
}

const MAX_MARKERS = 20;

export function createApplyCallMarkers(storageKey: string): ApplyCallMarkers {
  const read = (): ApplyCallMarker[] | null => {
    try {
      const raw = globalThis.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter(
            (marker): marker is ApplyCallMarker =>
              typeof marker === "object" &&
              marker !== null &&
              typeof (marker as ApplyCallMarker).callId === "string" &&
              ((marker as ApplyCallMarker).state === "writing" ||
                (marker as ApplyCallMarker).state === "done"),
          )
        : [];
    } catch {
      return null;
    }
  };
  const store = (change: (markers: ApplyCallMarker[]) => ApplyCallMarker[]) => {
    try {
      globalThis.localStorage.setItem(
        storageKey,
        JSON.stringify(change(read() ?? []).slice(-MAX_MARKERS)),
      );
    } catch {
      // Without storage a replay after a reload answers unconfirmed, which also leads to a read.
    }
  };
  const write = (marker: ApplyCallMarker) =>
    store((markers) => [
      ...markers.filter((other) => other.callId !== marker.callId),
      marker,
    ]);
  return {
    read,
    markWriting: (callId, identity) =>
      write({ callId, state: "writing", identity }),
    markDone: (callId, identity, result) =>
      write({ callId, state: "done", identity, result }),
    marker: (callId) => {
      const markers = read();
      return markers && markers.find((marker) => marker.callId === callId);
    },
    forget: (callId) =>
      store((markers) => markers.filter((marker) => marker.callId !== callId)),
  };
}
