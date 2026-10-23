import { useEffect, useMemo, useReducer } from "react";

import { parseTeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";

import type { TeamsTranscriptIndex } from "@/utils/teams/teamsTranscriptIndex";

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

const READING: TeamsTranscriptIndexRead = { index: null, isReading: true };

const READS_IN_FLIGHT = new WeakMap<
  File,
  Promise<TeamsTranscriptIndex | null>
>();

/**
 * Reads a file's index into the same cache the hooks answer from, so a caller
 * that awaits it before handing the file over gets a first render that already
 * knows the conversation.
 */
export function readTeamsTranscriptIndex(
  file: File,
): Promise<TeamsTranscriptIndex | null> {
  if (INDEX_BY_FILE.has(file)) {
    return Promise.resolve(INDEX_BY_FILE.get(file) ?? null);
  }
  const inFlight = READS_IN_FLIGHT.get(file);
  if (inFlight) return inFlight;
  const read = Promise.resolve()
    .then(() => file.text())
    .then(
      (text) => parseTeamsTranscriptIndex(text),
      // An unreadable file is indistinguishable from one without a block: the
      // caller has nothing to render either way.
      () => null,
    )
    .then((index) => {
      INDEX_BY_FILE.set(file, index);
      READS_IN_FLIGHT.delete(file);
      return index;
    });
  READS_IN_FLIGHT.set(file, read);
  return read;
}

const readOf = (file: File): TeamsTranscriptIndexRead =>
  INDEX_BY_FILE.has(file)
    ? { index: INDEX_BY_FILE.get(file) ?? null, isReading: false }
    : READING;

export function useTeamsTranscriptIndex(
  file: File | null,
): TeamsTranscriptIndexRead {
  const [, onRead] = useReducer((reads: number) => reads + 1, 0);

  useEffect(() => {
    if (!file || INDEX_BY_FILE.has(file)) return;
    let alive = true;
    void readTeamsTranscriptIndex(file).then(() => {
      if (alive) onRead();
    });
    return () => {
      alive = false;
    };
  }, [file]);

  if (!file) return NOTHING_TO_READ;
  return readOf(file);
}

/**
 * The same read for several transcripts at once. Pass a memoized list: the map
 * is rebuilt only when a file or a read changes, so it can key a memo.
 */
export function useTeamsTranscriptIndexes(
  files: readonly File[],
): ReadonlyMap<File, TeamsTranscriptIndexRead> {
  const [, onRead] = useReducer((reads: number) => reads + 1, 0);

  useEffect(() => {
    const pending = files.filter((file) => !INDEX_BY_FILE.has(file));
    if (pending.length === 0) return;
    let alive = true;
    void Promise.all(pending.map(readTeamsTranscriptIndex)).then(() => {
      if (alive) onRead();
    });
    return () => {
      alive = false;
    };
  }, [files]);

  const settledKey = files
    .map((file) => (INDEX_BY_FILE.has(file) ? "1" : "0"))
    .join("");
  return useMemo(
    () =>
      new Map(
        files.map((file, position) => [
          file,
          settledKey[position] === "1" ? readOf(file) : READING,
        ]),
      ),
    [files, settledKey],
  );
}
