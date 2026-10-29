import {
  noteWordChangeEventsActive,
  recordWordParagraphEvent,
} from "./wordChangeJournal";
import { withWordTimeout } from "./wordTimeout";
import { wordWriteHost } from "./wordWriteHost";

import type { WordParagraphEvent } from "./wordChangeJournal";

type Listener = () => void;

const TRACKING_PROBE_TIMEOUT_MS = 2_000;

const listeners = new Set<Listener>();
let installed = false;
let paragraphEventsActive = false;

export function subscribeWordDocumentChanged(listener: Listener): () => void {
  listeners.add(listener);
  install();
  return () => {
    listeners.delete(listener);
  };
}

export function markWordDocumentChanged(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A listener must not stop the others from hearing about the change.
    }
  }
}

/** Without these events a text edit in Word reaches the pane by no other signal. */
export function wordParagraphEventsActive(): boolean {
  return paragraphEventsActive;
}

/** One property, so returning to the pane can notice a Track Changes toggle without a full read. */
export async function readWordChangeTrackingMode(): Promise<string | null> {
  const word = wordWriteHost();
  if (!word) return null;
  try {
    return await withWordTimeout(
      word.run(async (context) => {
        context.document.load("changeTrackingMode");
        await context.sync();
        return String(context.document.changeTrackingMode);
      }),
      TRACKING_PROBE_TIMEOUT_MS,
      () => new Error("tracking probe timed out"),
    );
  } catch {
    return null;
  }
}

function install(): void {
  if (installed) return;
  installed = true;
  void installParagraphEvents();
}

async function installParagraphEvents(): Promise<void> {
  const word = wordWriteHost();
  if (
    !word ||
    !globalThis.Office?.context?.requirements?.isSetSupported?.(
      "WordApi",
      "1.6",
    )
  )
    return;
  try {
    await word.run(async (context) => {
      const handler = async (event: WordParagraphEvent) => {
        recordWordParagraphEvent(event);
        markWordDocumentChanged();
      };
      context.document.onParagraphAdded.add(handler);
      context.document.onParagraphChanged.add(handler);
      context.document.onParagraphDeleted.add(handler);
      await context.sync();
    });
    paragraphEventsActive = true;
    noteWordChangeEventsActive();
  } catch {
    // Callers then treat every return to the pane as a change.
  }
}

export function resetWordDocumentChangeSignalForTests(): void {
  listeners.clear();
  installed = false;
  paragraphEventsActive = false;
}
