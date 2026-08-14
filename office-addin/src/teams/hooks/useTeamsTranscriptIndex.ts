import { useEffect, useReducer } from "react";

import { parseTeamsTranscriptIndex } from "../utils/teamsTranscriptIndex";

import type { TeamsTranscriptIndex } from "../utils/teamsTranscriptIndex";

/**
 * Reads a transcript's index block back out of the file, so a caller renders
 * what was uploaded instead of what it happens to remember building.
 *
 * Results are kept per `File` for as long as the file is referenced. Reading a
 * blob is asynchronous, and the composer re-renders on every keystroke: without
 * this, each render would start over from "not read yet" and the preview would
 * fall back to plain chips between the render and the parse that follows it.
 */
const INDEX_BY_FILE = new WeakMap<File, TeamsTranscriptIndex | null>();

export interface TeamsTranscriptIndexRead {
  /** Null while reading, and for a file that carries no usable block. */
  index: TeamsTranscriptIndex | null;
  /** True until this file has been read — nothing is known about it yet. */
  isReading: boolean;
}

const NOTHING_TO_READ: TeamsTranscriptIndexRead = {
  index: null,
  isReading: false,
};

export function useTeamsTranscriptIndex(
  file: File | null,
): TeamsTranscriptIndexRead {
  const [, onRead] = useReducer((reads: number) => reads + 1, 0);

  useEffect(() => {
    if (!file || INDEX_BY_FILE.has(file)) return;
    let alive = true;
    const settle = (index: TeamsTranscriptIndex | null) => {
      INDEX_BY_FILE.set(file, index);
      if (alive) onRead();
    };
    void file.text().then(
      (text) => settle(parseTeamsTranscriptIndex(text)),
      // An unreadable file is indistinguishable from one without a block: the
      // caller has nothing to render either way.
      () => settle(null),
    );
    return () => {
      alive = false;
    };
  }, [file]);

  if (!file) return NOTHING_TO_READ;
  if (!INDEX_BY_FILE.has(file)) return { index: null, isReading: true };
  return { index: INDEX_BY_FILE.get(file) ?? null, isReading: false };
}
