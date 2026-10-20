import { getOptionalTranslation } from "@/hooks/i18n";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

export function getFacetDisplayName(facet: FacetInfo): string {
  // eslint-disable-next-line lingui/no-unlocalized-strings -- Translation key is dynamic by facet ID
  const translationId = `facets.${facet.id}.display_name`;
  return getOptionalTranslation(translationId) ?? facet.display_name;
}
