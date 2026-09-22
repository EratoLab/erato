import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";

import type { WordDocumentCapture } from "../utils/wordDocumentCapture";
import type { WordReviewState } from "../utils/wordReviewState";
import type { ReactNode } from "react";

/** Keep one recovery batch in memory; reloading the pane loses it. */
export interface WordRevertSlot {
  messageId: string;
  identity: string;
  ooxml: string;
  batchKey?: string;
  afterFingerprint?: string;
}

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
  locationGeneration: 0,
  invalidateLocations: () => {},
});

/** Registry cards render inside the shared message list, so host state travels through context. */
export function WordWriteProvider({
  documentIdentity,
  capturesByAssistantMessageId,
  children,
}: {
  documentIdentity: string | null;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
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
