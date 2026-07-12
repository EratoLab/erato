import { useCallback, useEffect, useRef, useState } from "react";

interface UseTransientLabelOptions {
  /** Duration the active state stays on before auto-resetting. Default: 2000 ms. */
  delay?: number;
  /**
   * Text to surface in the sr-only live region while active, for screen
   * readers that would otherwise only observe a silent icon/label swap.
   * When omitted no `srAnnouncement` text is produced.
   */
  announcement?: string;
}

interface UseTransientLabelResult {
  /** True for `delay` ms after `trigger` is called, then false. */
  isActive: boolean;
  /**
   * Call this to start the transient active window. Safe to call while
   * already active — restarts the timer from zero.
   */
  trigger: () => void;
  /**
   * Non-empty while `isActive` and an `announcement` was supplied; empty
   * string otherwise. Render inside a `role="status"` / `aria-live="polite"`
   * sr-only element to announce success to screen readers that would not
   * detect a silent icon swap.
   *
   * @example
   * <p role="status" className="sr-only">{srAnnouncement}</p>
   */
  srAnnouncement: string;
}

/**
 * Drives the transient ~2 s label-swap success feedback pattern.
 *
 * `isActive` becomes `true` when `trigger` is called and automatically resets
 * to `false` after `delay` ms (default 2000). The timer is cleared if the
 * component unmounts before it fires — no timer leaks. Calling `trigger`
 * while already active restarts the timer.
 *
 * @example
 * const { isActive: isCopied, trigger: triggerCopied, srAnnouncement } =
 *   useTransientLabel({ announcement: t`Copied to clipboard` });
 *
 * // in handler:
 * await navigator.clipboard.writeText(text);
 * triggerCopied();
 *
 * // in render:
 * {isCopied ? <CheckIcon /> : <CopyIcon />}
 * <p role="status" className="sr-only">{srAnnouncement}</p>
 */
export function useTransientLabel({
  delay = 2000,
  announcement,
}: UseTransientLabelOptions = {}): UseTransientLabelResult {
  const [isActive, setIsActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setIsActive(true);
    timerRef.current = setTimeout(() => {
      setIsActive(false);
      timerRef.current = null;
    }, delay);
  }, [delay]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return {
    isActive,
    trigger,
    srAnnouncement: isActive && announcement ? announcement : "",
  };
}
