/**
 * Which server-called applies this pane started writing, kept across a reload: a replayed call
 * whose write had started must never write again, and one that finished answers as it did.
 */
export const WORD_APPLY_CALLS_KEY = "erato.addin.word.applyCalls";
const MAX_MARKERS = 20;

export type WordApplyCallMarker =
  | { callId: string; state: "writing"; identity: string }
  | { callId: string; state: "done"; identity: string; result: unknown };

/** The markers, or null when pane storage cannot be read. */
export function readWordApplyCallMarkers(): WordApplyCallMarker[] | null {
  try {
    const raw = globalThis.localStorage.getItem(WORD_APPLY_CALLS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (marker): marker is WordApplyCallMarker =>
            typeof marker === "object" &&
            marker !== null &&
            typeof (marker as WordApplyCallMarker).callId === "string" &&
            ((marker as WordApplyCallMarker).state === "writing" ||
              (marker as WordApplyCallMarker).state === "done"),
        )
      : [];
  } catch {
    return null;
  }
}

function writeMarker(marker: WordApplyCallMarker): void {
  try {
    const markers = (readWordApplyCallMarkers() ?? []).filter(
      (other) => other.callId !== marker.callId,
    );
    markers.push(marker);
    globalThis.localStorage.setItem(
      WORD_APPLY_CALLS_KEY,
      JSON.stringify(markers.slice(-MAX_MARKERS)),
    );
  } catch {
    // Without storage a replay after a reload answers unconfirmed, which also leads to a read.
  }
}

export const markWordApplyWriting = (callId: string, identity: string) =>
  writeMarker({ callId, state: "writing", identity });

export const markWordApplyDone = (
  callId: string,
  identity: string,
  result: unknown,
) => writeMarker({ callId, state: "done", identity, result });

/** This call's marker; null when storage cannot be read. */
export function wordApplyCallMarker(
  callId: string,
): WordApplyCallMarker | undefined | null {
  const markers = readWordApplyCallMarkers();
  return markers && markers.find((marker) => marker.callId === callId);
}
