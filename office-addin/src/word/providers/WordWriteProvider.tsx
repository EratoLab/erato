import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";

import type { WordReviewState } from "../utils/wordReviewState";
import type { WordSelectionWritten } from "../utils/wordSelectionTarget";
import type { WordDocumentCapture } from "@erato/frontend/word-review";
import type { ReactNode } from "react";

/** Keep one recovery batch in memory; reloading the pane loses it. */
export interface WordRevertSlot {
  messageId: string;
  identity: string;
  ooxml: string;
  batchKey?: string;
  afterFingerprint?: string;
  /** A Replace of a selected paragraph: what it wrote, which Undo must still find unchanged, and
   * the paragraph's text before it. */
  selection?: { written: WordSelectionWritten; rangeText: string };
}

/** How long a run that outlived its timeout may keep every Word card waiting. */
export const WORD_OPERATION_CEILING_MS = 60_000;

export interface WordWriteContextValue {
  documentIdentity: string | null;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
  revertSlot: WordRevertSlot | null;
  setRevertSlot: (slot: WordRevertSlot | null) => void;
  reviews: ReadonlyMap<string, WordReviewState>;
  updateReview: (key: string, patch: Partial<WordReviewState>) => void;
  /** One host operation at a time across every card, including navigation. */
  operationInProgress: boolean;
  beginOperation: () => boolean;
  endOperation: () => void;
  /**
   * Ends the operation once a run that timed out has really ended, the document changes, or the
   * ceiling passes. A write it queued may still land until then.
   */
  holdOperationUntil: (settled: Promise<void>, ceilingMs?: number) => void;
  /** A held run has not ended yet. */
  hostNotResponding: boolean;
  /** Puts a request back into the composer, focused. */
  restoreRequest: (message: string) => void;
  locationGeneration: number;
  invalidateLocations: () => void;
}

const EMPTY_CAPTURES: ReadonlyMap<string, WordDocumentCapture> = new Map();

const WordWriteContext = createContext<WordWriteContextValue>({
  documentIdentity: null,
  capturesByAssistantMessageId: EMPTY_CAPTURES,
  revertSlot: null,
  setRevertSlot: () => {},
  reviews: new Map(),
  updateReview: () => {},
  operationInProgress: false,
  beginOperation: () => false,
  endOperation: () => {},
  holdOperationUntil: () => {},
  hostNotResponding: false,
  restoreRequest: () => {},
  locationGeneration: 0,
  invalidateLocations: () => {},
});

/** Registry cards render inside the shared message list, so host state travels through context. */
export function WordWriteProvider({
  documentIdentity,
  capturesByAssistantMessageId,
  restoreRequest = () => {},
  children,
}: {
  documentIdentity: string | null;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
  restoreRequest?: (message: string) => void;
  children: ReactNode;
}) {
  const [revertSlot, setRevertSlot] = useState<WordRevertSlot | null>(null);
  const [reviews, setReviews] = useState<ReadonlyMap<string, WordReviewState>>(
    () => new Map(),
  );
  const [operationInProgress, setOperationInProgress] = useState(false);
  const operationRef = useRef(false);
  const [locationGeneration, setLocationGeneration] = useState(0);
  const updateReview = useCallback(
    (key: string, patch: Partial<WordReviewState>) => {
      setReviews((current) =>
        new Map(current).set(key, {
          ...(current.get(key) ?? EMPTY_WORD_REVIEW),
          ...patch,
        }),
      );
    },
    [],
  );
  const beginOperation = useCallback(() => {
    if (operationRef.current) return false;
    operationRef.current = true;
    setOperationInProgress(true);
    return true;
  }, []);
  const endOperation = useCallback(() => {
    operationRef.current = false;
    setOperationInProgress(false);
  }, []);
  const [hostNotResponding, setHostNotResponding] = useState(false);
  const releaseHoldRef = useRef<(() => void) | undefined>(undefined);
  const holdOperationUntil = useCallback(
    (settled: Promise<void>, ceilingMs = WORD_OPERATION_CEILING_MS) => {
      releaseHoldRef.current?.();
      setHostNotResponding(true);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        if (releaseHoldRef.current === release)
          releaseHoldRef.current = undefined;
        setHostNotResponding(false);
        endOperation();
      };
      const timer = setTimeout(release, ceilingMs);
      releaseHoldRef.current = release;
      void settled.then(release, release);
    },
    [endOperation],
  );
  // Another document cannot receive the late write.
  useEffect(() => releaseHoldRef.current?.(), [documentIdentity]);
  const invalidateLocations = useCallback(
    () => setLocationGeneration((value) => value + 1),
    [],
  );
  const value = useMemo<WordWriteContextValue>(
    () => ({
      documentIdentity,
      capturesByAssistantMessageId,
      revertSlot,
      setRevertSlot,
      reviews,
      updateReview,
      operationInProgress,
      beginOperation,
      endOperation,
      holdOperationUntil,
      hostNotResponding,
      restoreRequest,
      locationGeneration,
      invalidateLocations,
    }),
    [
      documentIdentity,
      capturesByAssistantMessageId,
      revertSlot,
      reviews,
      updateReview,
      operationInProgress,
      beginOperation,
      endOperation,
      holdOperationUntil,
      hostNotResponding,
      restoreRequest,
      locationGeneration,
      invalidateLocations,
    ],
  );
  return (
    <WordWriteContext.Provider value={value}>
      {children}
    </WordWriteContext.Provider>
  );
}

export function useWordWrite(): WordWriteContextValue {
  return useContext(WordWriteContext);
}
