import { hostShell, hostShellWithCapability } from "@/lib/hostShell";
import { createValueStore, useValueStore } from "@/utils/chat/valueStore";

// eslint-disable-next-line lingui/no-unlocalized-strings
const SYSTEM_GLASS_CAPABILITY = "systemGlass";
// eslint-disable-next-line lingui/no-unlocalized-strings
const SYSTEM_GLASS_CHANGED = "systemGlass.changed";
const SYSTEM_GLASS_ATTRIBUTE = "data-system-glass";

const systemGlass = createValueStore(false);

/**
 * A host app that draws floating glass controls around the page
 * (`systemGlass` capability) gets a matching frosted navigation layer, which
 * globals.css keys on this attribute. Call it once before the first render.
 * The setting behind it can change while the app runs; the capabilities keep
 * their start value, so the page hears the host's event either way.
 */
export function markSystemGlass(root: HTMLElement): void {
  const apply = (available: boolean) => {
    root.toggleAttribute(SYSTEM_GLASS_ATTRIBUTE, available);
    systemGlass.set(available);
  };
  apply(hostShellWithCapability(SYSTEM_GLASS_CAPABILITY, 1) !== null);
  hostShell()?.on(SYSTEM_GLASS_CHANGED, (payload) => {
    if (isAvailability(payload)) apply(payload.available);
  });
}

/** Whether the page is marked; re-renders when the host's answer changes. */
export function useSystemGlass(): boolean {
  return useValueStore(systemGlass);
}

function isAvailability(value: unknown): value is { available: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).available === "boolean"
  );
}
