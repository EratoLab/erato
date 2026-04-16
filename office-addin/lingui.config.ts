import { defineConfig } from "@lingui/cli";

import {
  COMMON_EXCLUDES,
  CUSTOMER_COMPONENTS_GLOB,
  linguiExtraExtractor,
  sectionedPoFormatter,
} from "../frontend/lingui-extractor";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"],
  extractors: [linguiExtraExtractor],
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: [
        ...COMMON_EXCLUDES,
        CUSTOMER_COMPONENTS_GLOB,
        "**/__tests__/**",
      ],
    },
  ],
  compileNamespace: "json",
  format: sectionedPoFormatter({ lineNumbers: false }),
});
