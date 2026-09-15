// Its own module so the registry can read the contract without importing the
// surface barrel, which pulls in the components and would close an import
// cycle back through the registry.

import type { ComponentRegistry } from "@/config/componentRegistry";

// Bump on breaking changes to the shared host surface. Kits compare this at
// startup and warn loudly when their expected contract does not match.
export const ERATO_SHARED_SURFACE_VERSION = 1;

// Bump on purely additive growth of the surface, so a kit can require a name
// that exists without demanding a new major.
export const ERATO_SHARED_SURFACE_MINOR = 9;

/**
 * Per extension point, the minor at which that point's contract last grew a
 * rule an override has to carry: a kit built before it cannot be carrying the
 * rule, whatever it renders. Per point, not one global floor, so a kit stale
 * for one point keeps its other overrides. Each entry costs the customer a kit
 * rebuild, so add one only when a pre-bump override is genuinely wrong.
 *
 * Lives here, not in `componentRegistry.ts`: forks keep their own copy of that
 * file (`checkout --ours`), so a requirement recorded there would never reach
 * the fork that needs it.
 */
export const EXTENSION_POINT_REQUIRED_SURFACE_MINOR: Partial<
  Record<keyof ComponentRegistry, number>
> = {
  // 1.7 handed the row contract to the host (composed badges and the gated
  // menu hook) and 1.8 added the subline, the options builder and the stable
  // ids. The requirement is 8 because that is the first minor a kit could
  // declare: `builtAgainstSharedSurfaceMinor` did not exist before it.
  ChatHistoryList: 8,
};

export type ComponentKitVersionStance = "warn" | "enforce";

/**
 * `"warn"` logs a stale override and installs it anyway; `"enforce"` drops that
 * one registration, so the host renders its own component for that point and
 * the kit's other overrides stay.
 *
 * Only the default. A deployment overrides it for itself with
 * `window.ERATO_COMPONENT_KIT_VERSION_STANCE`, set in the same script slot that
 * loads the kit bundles — a customer who has rebuilt every kit enforces without
 * waiting for a host release, and without the rest of the fleet losing its UI.
 * The default is `"warn"` because kits deployed today declare nothing at all.
 */
export const DEFAULT_COMPONENT_KIT_VERSION_STANCE: ComponentKitVersionStance =
  "warn";
