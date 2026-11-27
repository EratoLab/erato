import { hostShellWithCapability } from "@/lib/hostShell";

/** What each kind is for: see the shell contract's `haptics` capability. */
export type HapticKind = "selection" | "light" | "success" | "warning";

/**
 * Plays a short haptic in a host app that offers one (`haptics`), for a
 * moment the person should feel, never for ordinary taps. Without the
 * capability (a browser) nothing happens; a failed request changes nothing.
 */
export function playHaptic(kind: HapticKind): void {
  const shell = hostShellWithCapability("haptics", 1);
  if (!shell) return;
  try {
    void shell.request("haptics.play", { kind }).catch(() => {});
  } catch {
    // A host whose request throws instead of rejecting must not break the action.
  }
}
