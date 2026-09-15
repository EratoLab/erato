// Its own module so the registry can read the contract without importing the
// surface barrel, which pulls in the components and would close an import
// cycle back through the registry.

import type { ComponentRegistry } from "@/config/componentRegistry";

// Bump on breaking changes to the shared host surface. Kits compare this at
// startup and warn loudly when their expected contract does not match.
export const ERATO_SHARED_SURFACE_VERSION = 1;

// Bump on purely additive growth of the surface, so a kit can require a name
// that exists without demanding a new major.
export const ERATO_SHARED_SURFACE_MINOR = 8;

/**
 * Per extension point, the minor at which that point's contract last grew a
 * rule an override has to carry. A kit built before that minor cannot be
 * carrying the rule, whatever it renders — which is the failure this guards:
 * a kit that replaced the whole chat-history list and dropped a shipped
 * feature with no error and no failing test.
 *
 * Per point rather than one global floor because the points evolve
 * independently: a kit stale for the row list is usually current for the five
 * other things it overrides, and a single floor would retire all six.
 *
 * Add an entry only when an override that predates the bump is genuinely
 * wrong, not for every additive surface name — every entry is a kit rebuild
 * the customer has to do.
 *
 * Lives here, not in `componentRegistry.ts`: forks keep their own copy of that
 * file (`checkout --ours`), so a requirement recorded there would never reach
 * the fork that needs it.
 */
export const EXTENSION_POINT_REQUIRED_SURFACE_MINOR: Partial<
  Record<keyof ComponentRegistry, number>
> = {
  // 1.8 handed the row contract to the host: composed badges, the subline and
  // the gated menu. An override built before it draws none of them.
  ChatHistoryList: 8,
};

export type ComponentKitVersionStance = "warn" | "enforce";

/**
 * THE SWITCH for the requirements above. `"warn"` logs a stale override and
 * installs it anyway; `"enforce"` drops that one registration so the host
 * renders its own component for that point, leaving the kit's other overrides
 * in place.
 *
 * Ships as `"warn"` because every kit deployed today declares nothing and so
 * counts as the oldest contract: enforcing before customers have rebuilt would
 * revert real UI. Flip this line once they have.
 */
export const COMPONENT_KIT_VERSION_STANCE: ComponentKitVersionStance = "warn";
