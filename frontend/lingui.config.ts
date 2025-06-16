import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "de", "fr", "pl", "es"], // English, German, French, Polish, and Spanish
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}/messages",
      include: ["src"],
      exclude: ["**/node_modules/**", "**/out/**", "**/.next/**", "**/test/**"],
    },
  ],
  compileNamespace: "ts", // Generate TypeScript files
  format: "po", // Use industry-standard PO format
});
