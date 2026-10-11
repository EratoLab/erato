import { wordWriteHost } from "./wordWriteHost";
import { subscribeToOfficeSelectionChanged } from "../../hooks/officeSelectionChangedBroker";

type Listener = () => void;

const listeners = new Set<Listener>();
let installed = false;

/** Paragraph events miss formatting-only edits, so selection changes also count as changes. */
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

function install(): void {
  if (installed) return;
  installed = true;
  subscribeToOfficeSelectionChanged({
    onSelectionChanged: markWordDocumentChanged,
  });
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
      const handler = async () => markWordDocumentChanged();
      context.document.onParagraphAdded.add(handler);
      context.document.onParagraphChanged.add(handler);
      context.document.onParagraphDeleted.add(handler);
      await context.sync();
    });
  } catch {
    // Hosts that refuse the events still report selection changes and our own writes.
  }
}

export function resetWordDocumentChangeSignalForTests(): void {
  listeners.clear();
  installed = false;
}
