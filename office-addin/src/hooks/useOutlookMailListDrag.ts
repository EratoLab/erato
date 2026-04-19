import { useCallback, useEffect, useRef, useState } from "react";

import {
  MAILLISTROW_TRANSFER_TYPE,
  parseOutlookMailListPayload,
  type OutlookMailListDragItem,
} from "../utils/outlookMailListDragParse";

interface UseOutlookMailListDragOptions {
  /** Called on drop with the parsed mail-list items (one per dragged row). */
  onDrop: (items: OutlookMailListDragItem[]) => void | Promise<void>;
  /** When true, no listeners are registered and `isDragActive` stays false. */
  disabled?: boolean;
}

interface UseOutlookMailListDragResult {
  isDragActive: boolean;
}

/**
 * Listens for the undocumented OWA/New Outlook "drag email from mail list"
 * gesture. That drag is NOT a native file drag — it carries a custom
 * `maillistrow` string payload and no `Files` entry — so react-dropzone's
 * file-detection path cannot surface it. This hook runs in parallel to the
 * shared conversation dropzone, detects `maillistrow` drags at the window
 * level, and exposes its own `isDragActive` state so the caller can mirror
 * the existing drop overlay.
 *
 * Resilience notes:
 *   - The payload shape is an OWA-internal contract and may change without
 *     notice. Parsing is delegated to `parseOutlookMailListPayload` which
 *     returns null (not throws) when the shape drifts.
 *   - Listeners are registered on `window` in capture phase so they see the
 *     drag regardless of which element in the iframe is the direct target.
 *   - dragleave with `relatedTarget === null` indicates the drag has left the
 *     iframe entirely; only then do we clear `isDragActive`.
 */
export function useOutlookMailListDrag({
  onDrop,
  disabled = false,
}: UseOutlookMailListDragOptions): UseOutlookMailListDragResult {
  const [isDragActive, setIsDragActive] = useState(false);
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const isMailListDrag = useCallback((event: DragEvent): boolean => {
    if (!event.dataTransfer) {
      return false;
    }
    return Array.from(event.dataTransfer.types).includes(
      MAILLISTROW_TRANSFER_TYPE,
    );
  }, []);

  useEffect(() => {
    if (disabled) {
      setIsDragActive(false);
      return;
    }

    const handleDragEnter = (event: DragEvent) => {
      if (isMailListDrag(event)) {
        setIsDragActive(true);
      }
    };

    const handleDragOver = (event: DragEvent) => {
      if (isMailListDrag(event)) {
        // Required so the browser will fire a subsequent `drop`.
        event.preventDefault();
        setIsDragActive(true);
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      // relatedTarget === null means the drag left the whole document.
      if (event.relatedTarget === null) {
        setIsDragActive(false);
      }
    };

    const handleDrop = (event: DragEvent) => {
      if (!isMailListDrag(event)) {
        return;
      }
      event.preventDefault();
      setIsDragActive(false);
      const raw = event.dataTransfer?.getData(MAILLISTROW_TRANSFER_TYPE) ?? "";
      const items = parseOutlookMailListPayload(raw);
      if (items && items.length > 0) {
        void onDropRef.current(items);
      }
    };

    window.addEventListener("dragenter", handleDragEnter, true);
    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("dragleave", handleDragLeave, true);
    window.addEventListener("drop", handleDrop, true);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter, true);
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("dragleave", handleDragLeave, true);
      window.removeEventListener("drop", handleDrop, true);
    };
  }, [disabled, isMailListDrag]);

  return { isDragActive };
}
