import { t } from "@lingui/core/macro";

import { getOptionalTranslation } from "@/hooks/i18n";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

/** Id of the facet the server adds while scheduled deliveries are on. */
export const SCHEDULE_FACET_ID = "schedule";

// The server's name for the built-in; a deployment that renames the facet
// keeps its own name untranslated.
// eslint-disable-next-line lingui/no-unlocalized-strings -- Compared, not shown
const BUILTIN_SCHEDULE_DISPLAY_NAME = "Schedule";

function builtinFacetDisplayName(facet: FacetInfo): string | null {
  return facet.id === SCHEDULE_FACET_ID &&
    facet.display_name === BUILTIN_SCHEDULE_DISPLAY_NAME
    ? t({ id: "facets.builtin.schedule.displayName", message: "Schedule" })
    : null;
}

export function getFacetDisplayName(facet: FacetInfo): string {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by facet ID
  const translationId = `facets.${facet.id}.display_name`;
  return (
    getOptionalTranslation(translationId) ??
    builtinFacetDisplayName(facet) ??
    facet.display_name
  );
}
