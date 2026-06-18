import { defineConfig } from "@lingui/cli";

import {
  COMMON_EXCLUDES,
  linguiExtraExtractor,
  sectionedPoFormatter,
} from "@erato/frontend-utils/lingui";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"],
  extractors: [linguiExtraExtractor],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: COMMON_EXCLUDES,
    },
  ],
  compileNamespace: "json",
  format: sectionedPoFormatter({ lineNumbers: false }),
});
