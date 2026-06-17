/**
 * Frontend Lingui configuration for Erato.
 *
 * This file intentionally stays thin. The repository-specific formatter,
 * extractor, and catalog helper logic live in `@erato/frontend-utils`, while
 * this module only wires those pieces into Lingui's config shape.
 */
import { defineConfig } from "@lingui/cli";

import {
  buildThemeCatalogs,
  COMMON_EXCLUDES,
  CUSTOMER_COMPONENTS_GLOB,
  linguiExtraExtractor,
  sectionedPoFormatter,
} from "@erato/frontend-utils/lingui";

const ROOT_DIR = process.cwd();

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"], // English, German, French, Polish, and Spanish
  extractors: [linguiExtraExtractor],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: [...COMMON_EXCLUDES, CUSTOMER_COMPONENTS_GLOB],
    },
    ...buildThemeCatalogs(ROOT_DIR),
  ],
  compileNamespace: "json", // Generate JSON files, as those can be more easily loaded dynamically for the custom-theme
  // Use sectioned PO format that groups explicit IDs and unstable IDs separately
  format: sectionedPoFormatter({ lineNumbers: false }),
});
