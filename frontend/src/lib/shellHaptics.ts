import { hostShellWithCapability } from "@/lib/hostShell";

// eslint-disable-next-line lingui/no-unlocalized-strings
const HAPTICS_CAPABILITY = "haptics";

/** What each kind is for: see the shell contract's `haptics` capability. */
export type HapticKind = "selection" | "light" | "success" | "warning";

/**
 * Plays a short haptic in a host app that offers one (`haptics`), for a
 * moment the person should feel: a message sent, a recording started or
 * stopped, a decision taken. Never for ordinary taps. Without the capability
 * (a browser) nothing happens; a failed request changes nothing either.
 */
export function playHaptic(kind: HapticKind): void {
  const shell = hostShellWithCapability(HAPTICS_CAPABILITY, 1);
  if (!shell) return;
  try {
    // eslint-disable-next-line lingui/no-unlocalized-strings
    void shell.request("haptics.play", { kind }).catch(() => {});
  } catch {
    // A host whose request throws instead of rejecting must not break the action.
  }
}
