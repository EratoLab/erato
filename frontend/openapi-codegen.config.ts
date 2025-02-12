import {
  generateReactQueryComponents,
  generateSchemaTypes,
} from "@openapi-codegen/typescript";
import { defineConfig } from "@openapi-codegen/cli";

export default defineConfig({
  v1betaApi: {
    from: {
      relativePath: "../backend/generated/openapi.json",
      source: "file",
    },
    outputDir: "src/lib/generated/v1betaApi",
    to: async (context) => {
      const filenamePrefix = "v1betaApi";
      const { schemasFiles } = await generateSchemaTypes(context, {
        filenamePrefix,
      });
      await generateReactQueryComponents(context, {
        filenamePrefix,
        schemasFiles,
      });
    },
  },
});
