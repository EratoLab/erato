// Its own module so the registry can read the contract without importing the
// surface barrel, which pulls in the components and would close an import
// cycle back through the registry.

import type { ComponentRegistry } from "@/config/componentRegistry";

// Bump on breaking changes to the shared host surface. Kits compare this at
// startup and warn loudly when their expected contract does not match.
export const ERATO_SHARED_SURFACE_VERSION = 1;

// Bump on purely additive growth of the surface, so a kit can require a name
// that exists without demanding a new major.
export const ERATO_SHARED_SURFACE_MINOR = 11;

/**
 * Per extension point, the minor at which that point's contract last grew a
 * rule an override has to carry. Each entry costs the customer a kit rebuild,
 * so add one only when a pre-bump override is genuinely wrong.
 *
 * Lives here, not in `componentRegistry.ts`: forks keep their own copy of that
 * file (`checkout --ours`), so a requirement recorded there would never reach
 * the fork that needs it.
 */
export const EXTENSION_POINT_REQUIRED_SURFACE_MINOR: Partial<
  Record<keyof ComponentRegistry, number>
> = {
  ChatHistoryList: 8,
};

export type ComponentKitVersionStance = "warn" | "enforce";

/**
 * `"warn"` logs a stale override and installs it anyway; `"enforce"` drops that
 * one registration, so the host renders its own component for that point and
 * the kit's other overrides stay.
 */
export const DEFAULT_COMPONENT_KIT_VERSION_STANCE: ComponentKitVersionStance =
  "warn";
