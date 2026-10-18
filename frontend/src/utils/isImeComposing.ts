import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * True for a key that belongs to an IME composition (Japanese, Chinese,
 * Korean): Enter, Escape and the arrows then confirm, dismiss or browse
 * candidates and must not act as shortcuts. WebKit delivers the confirming
 * Enter after `compositionend`, with `isComposing` already false; keyCode 229
 * still marks it there.
 */
export function isImeComposing(
  event: KeyboardEvent | ReactKeyboardEvent,
): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
