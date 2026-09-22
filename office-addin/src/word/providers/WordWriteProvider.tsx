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

/**
 * The one revert the pane holds. Single slot by ratified decision: single use,
 * in memory, replaced by the next batch that writes, and gone on pane reload.
 * Nothing about it is persisted — least of all into the .docx.
 */
export interface WordRevertSlot {
  /** The message whose card may offer the revert. */
  messageId: string;
  /** Document the snapshot was taken from; the revert is gated on it too. */
  identity: string;
  /** OOXML of the whole body immediately before the batch. */
  ooxml: string;
  batchKey?: string;
  afterFingerprint?: string;
}

export interface WordWriteContextValue {
  /** Identity of the document this pane has open, `null` when unknown. */
  documentIdentity: string | null;
  /** Send-time captures, keyed by the assistant message they answered. */
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

/**
 * Fails closed with no provider: no identity and no captures means every write
 * gate reports a stated reason and nothing executes. That is the correct
 * behaviour if the registered card ever renders outside the Word tree.
 */
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

/**
 * Supplies the write path with everything it cannot get from the artifact:
 * the pane's CURRENT document identity (the artifact carries the SEND-TIME
 * one — comparing the two is the identity gate) and the send-time captures.
 *
 * A context rather than props because the consumer is a component registered
 * into `componentRegistry.HostCardCodeBlock` and rendered deep inside the
 * shared message list, which has no Word-shaped props to thread.
 */
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
