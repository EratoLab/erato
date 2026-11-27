import { createApplyCallMarkers } from "../../core/clientActions/applyCallMarkers";

import type { ApplyCallMarker } from "../../core/clientActions/applyCallMarkers";

export const WORD_APPLY_CALLS_KEY = "erato.addin.word.applyCalls";

export type WordApplyCallMarker = ApplyCallMarker;

const markers = createApplyCallMarkers(WORD_APPLY_CALLS_KEY);

/** The markers, or null when pane storage cannot be read. */
export const readWordApplyCallMarkers = markers.read;

export const markWordApplyWriting = markers.markWriting;

export const markWordApplyDone = markers.markDone;

/** This call's marker; null when storage cannot be read. */
export const wordApplyCallMarker = markers.marker;
