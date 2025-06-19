import { defineConfig } from "@lingui/cli";
import { formatter as poFormatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"], // English, German, French, Polish, and Spanish
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["**/node_modules/**", "**/out/**", "**/.next/**", "**/test/**"],
    },
    {
      path: "<rootDir>/public/custom-theme/{name}/locales/{locale}/messages",
      include: ["<rootDir>/public/custom-theme/{name}/"],
      exclude: ["**/node_modules/**", "**/out/**", "**/.next/**", "**/test/**"],
    },
  ],
  compileNamespace: "json", // Generate JSON files, as those can be more easily loaded dynamically for the custom-theme
  // Use industry-standard PO format
  format: poFormatter({ lineNumbers: false }),
});
