import { hostShellWithCapability } from "@/lib/hostShell";

// eslint-disable-next-line lingui/no-unlocalized-strings
const SYSTEM_GLASS_CAPABILITY = "systemGlass";
const SYSTEM_GLASS_ATTRIBUTE = "data-system-glass";

/**
 * A host app that draws floating glass controls around the page
 * (`systemGlass` capability) gets a matching frosted navigation layer, which
 * globals.css keys on this attribute. Call it before the first render: the
 * host decides once per page load.
 */
export function markSystemGlass(root: HTMLElement): void {
  root.toggleAttribute(
    SYSTEM_GLASS_ATTRIBUTE,
    hostShellWithCapability(SYSTEM_GLASS_CAPABILITY, 1) !== null,
  );
}

/** Whether `markSystemGlass` marked this page. */
export function hasSystemGlass(): boolean {
  return document.documentElement.hasAttribute(SYSTEM_GLASS_ATTRIBUTE);
}
