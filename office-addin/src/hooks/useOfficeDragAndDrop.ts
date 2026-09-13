import { useEffect, useRef, useState } from "react";

import { subscribeToOfficeDragAndDrop } from "./officeDragAndDropBroker";

interface UseOfficeDragAndDropOptions {
  /**
   * Called on drop with the resolved files (messages arrive as `.eml`,
   * attachments keep their original type). Exceptions are logged and
   * swallowed so one throwing caller doesn't poison the broker.
   */
  onDrop: (files: File[]) => void | Promise<void>;
  /**
   * Called with the dropped item count before the items are read into
   * Files. May return a release; it runs once `onDrop` has settled, or at
   * once when the drop carried nothing.
   */
  onDropStart?: (count: number) => void | (() => void);
  /** When true, the component does not subscribe to the broker. */
  disabled?: boolean;
}

interface UseOfficeDragAndDropResult {
  isDragActive: boolean;
}

/**
 * Subscribes to Office.js `DragAndDropEvent` via a module-level singleton
 * broker. The broker registers the Office.js handler exactly once regardless
 * of how many React consumers mount, which is essential under React 18/19
 * StrictMode where effects double-invoke and naive per-component
 * `addHandlerAsync` calls race and end up firing drops twice.
 *
 * Target surfaces: Outlook on the web, New Outlook on Windows. Classic
 * Outlook on Windows and Outlook on Mac receive drops as native File DOM
 * events and are handled by the shared `useConversationDropzone` path.
 */
export function useOfficeDragAndDrop({
  onDrop,
  onDropStart,
  disabled = false,
}: UseOfficeDragAndDropOptions): UseOfficeDragAndDropResult {
  const [isDragActive, setIsDragActive] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onDropStartRef = useRef(onDropStart);
  onDropStartRef.current = onDropStart;

  useEffect(() => {
    if (disabled) {
      setIsDragActive(false);
      return;
    }
    let release: (() => void) | null = null;
    const unsubscribe = subscribeToOfficeDragAndDrop({
      onDragover: () => setIsDragActive(true),
      onDropStart: (count) => {
        release?.();
        const next = onDropStartRef.current?.(count);
        release = typeof next === "function" ? next : null;
      },
      onDrop: (files) => {
        setIsDragActive(false);
        const settle = release;
        release = null;
        if (files.length === 0) {
          settle?.();
          return;
        }
        void Promise.resolve(onDropRef.current(files))
          .catch((error) => {
            console.warn("[useOfficeDragAndDrop] onDrop threw:", error);
          })
          .finally(() => settle?.());
      },
    });
    return unsubscribe;
  }, [disabled]);

  return { isDragActive };
}
