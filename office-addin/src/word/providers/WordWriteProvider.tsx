import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { markWordDocumentChanged } from "../utils/wordDocumentChangeSignal";
import { EMPTY_WORD_REVIEW } from "../utils/wordReviewState";
import {
  createWordApplyProgressStore,
  useWordApplyStageFrom,
} from "../utils/wordReviewStore";
import { setWordWriteBridge } from "../utils/wordWriteBridge";

import type { WordSelectionBackup } from "../utils/wordReplaceSelection";
import type { WordReviewState } from "../utils/wordReviewState";
import type { WordApplyProgressStore } from "../utils/wordReviewStore";
import type { WordSelectionWritten } from "../utils/wordSelectionTarget";
import type { WordMessageContext } from "../utils/wordWriteBridge";
import type { WordDocumentCapture } from "@erato/frontend/word-review";
import type { ReactNode } from "react";

/** Keep one recovery batch in memory; reloading the pane loses it. */
export interface WordRevertSlot {
  messageId: string;
  identity: string;
  ooxml: string;
  batchKey?: string;
  afterFingerprint?: string;
  /** A Replace of a selected passage: what it wrote, which Undo must still find unchanged, and the
   * written paragraphs as they were before it. `ooxml` holds the first backup's. */
  selection?: {
    written: WordSelectionWritten;
    backups: readonly WordSelectionBackup[];
  };
}

/** How long a run that outlived its timeout may keep every Word card waiting. */
export const WORD_OPERATION_CEILING_MS = 60_000;

export interface WordWriteContextValue {
  documentIdentity: string | null;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
  revertSlot: WordRevertSlot | null;
  setRevertSlot: (slot: WordRevertSlot | null) => void;
  /** Without `applyStage`: read a card's review through useWordReview. */
  reviews: ReadonlyMap<string, WordReviewState>;
  /** A patch's `applyStage` goes to the progress store, so progress redraws only its own card. */
  updateReview: (key: string, patch: Partial<WordReviewState>) => void;
  applyProgress: WordApplyProgressStore;
  /** One host operation at a time across every card, including navigation. */
  operationInProgress: boolean;
  beginOperation: () => boolean;
  endOperation: () => void;
  /**
   * Ends the operation once a run that timed out has really ended, the document changes, or the
   * ceiling passes. A write it queued may still land until then.
   */
  holdOperationUntil: (
    settled: Promise<void>,
    owner: string,
    ceilingMs?: number,
  ) => void;
  /** The card whose run is held: it has not ended yet, so Word is not responding. */
  heldOperationOwner: string | null;
  /** Puts a request back into the composer, focused. */
  restoreRequest: (message: string) => void;
  locationGeneration: number;
  invalidateLocations: () => void;
}

const EMPTY_CAPTURES: ReadonlyMap<string, WordDocumentCapture> = new Map();

const NO_MESSAGE_CONTEXT = (): WordMessageContext => ({});

const WordWriteContext = createContext<WordWriteContextValue>({
  documentIdentity: null,
  capturesByAssistantMessageId: EMPTY_CAPTURES,
  revertSlot: null,
  setRevertSlot: () => {},
  reviews: new Map(),
  updateReview: () => {},
  applyProgress: createWordApplyProgressStore(),
  operationInProgress: false,
  beginOperation: () => false,
  endOperation: () => {},
  holdOperationUntil: () => {},
  heldOperationOwner: null,
  restoreRequest: () => {},
  locationGeneration: 0,
  invalidateLocations: () => {},
});

/** Registry cards render inside the shared message list, so host state travels through context. */
export function WordWriteProvider({
  documentIdentity,
  capturesByAssistantMessageId,
  restoreRequest = () => {},
  messageContext = NO_MESSAGE_CONTEXT,
  children,
}: {
  documentIdentity: string | null;
  capturesByAssistantMessageId: ReadonlyMap<string, WordDocumentCapture>;
  restoreRequest?: (message: string) => void;
  /** The stored turn of an assistant message, for a change applied after the pane reloaded. */
  messageContext?: (messageId: string) => WordMessageContext;
  children: ReactNode;
}) {
  const [revertSlot, setRevertSlot] = useState<WordRevertSlot | null>(null);
  const [reviews, setReviews] = useState<ReadonlyMap<string, WordReviewState>>(
    () => new Map(),
  );
  const [applyProgress] = useState(createWordApplyProgressStore);
  const [operationInProgress, setOperationInProgress] = useState(false);
  const operationRef = useRef(false);
  const [locationGeneration, setLocationGeneration] = useState(0);
  const updateReview = useCallback(
    (key: string, patch: Partial<WordReviewState>) => {
      const { applyStage, ...rest } = patch;
      if ("applyStage" in patch) applyProgress.set(key, applyStage);
      if (Object.keys(rest).length === 0) return;
      setReviews((current) =>
        new Map(current).set(key, {
          ...(current.get(key) ?? EMPTY_WORD_REVIEW),
          ...rest,
        }),
      );
    },
    [applyProgress],
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
    markWordDocumentChanged();
  }, []);
  const [heldOperationOwner, setHeldOperationOwner] = useState<string | null>(
    null,
  );
  const releaseHoldRef = useRef<(() => void) | undefined>(undefined);
  const holdOperationUntil = useCallback(
    (
      settled: Promise<void>,
      owner: string,
      ceilingMs = WORD_OPERATION_CEILING_MS,
    ) => {
      releaseHoldRef.current?.();
      setHeldOperationOwner(owner);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(timer);
        if (releaseHoldRef.current === release)
          releaseHoldRef.current = undefined;
        setHeldOperationOwner(null);
        endOperation();
      };
      const timer = setTimeout(release, ceilingMs);
      releaseHoldRef.current = release;
      void settled.then(release, release);
    },
    [endOperation],
  );
  const invalidateLocations = useCallback(
    () => setLocationGeneration((value) => value + 1),
    [],
  );
  const identityRef = useRef(documentIdentity);
  identityRef.current = documentIdentity;
  const messageContextRef = useRef(messageContext);
  messageContextRef.current = messageContext;
  useEffect(() => {
    setWordWriteBridge({
      documentIdentity: () => identityRef.current,
      updateReview,
      beginOperation,
      endOperation,
      holdOperationUntil,
      setRevertSlot,
      invalidateLocations,
      messageContext: (messageId) => messageContextRef.current(messageId),
    });
    return () => setWordWriteBridge(null);
  }, [
    updateReview,
    beginOperation,
    endOperation,
    holdOperationUntil,
    invalidateLocations,
  ]);
  const value = useMemo<WordWriteContextValue>(
    () => ({
      documentIdentity,
      capturesByAssistantMessageId,
      revertSlot,
      setRevertSlot,
      reviews,
      updateReview,
      applyProgress,
      operationInProgress,
      beginOperation,
      endOperation,
      holdOperationUntil,
      heldOperationOwner,
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
      applyProgress,
      operationInProgress,
      beginOperation,
      endOperation,
      holdOperationUntil,
      heldOperationOwner,
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

/** One card's review, with its apply's progress. */
export function useWordReview(key: string): WordReviewState {
  const { reviews, applyProgress } = useContext(WordWriteContext);
  const review = reviews.get(key) ?? EMPTY_WORD_REVIEW;
  const applyStage = useWordApplyStageFrom(applyProgress, key);
  return useMemo(
    () => (applyStage === undefined ? review : { ...review, applyStage }),
    [review, applyStage],
  );
}

/** Every review, for a card that compares itself with its siblings. */
export function useWordReviews(): ReadonlyMap<string, WordReviewState> {
  return useContext(WordWriteContext).reviews;
}
