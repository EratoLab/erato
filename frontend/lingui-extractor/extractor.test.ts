import { describe, expect, it } from "vitest";

import { extractLinguiExtraMetadata } from "./index";

describe("linguiExtraExtractor", () => {
  it("extracts metadata from Lingui macro descriptors", async () => {
    const extracted = await extractLinguiExtraMetadata(
      "src/example.tsx",
      `
        import { t } from "@lingui/core/macro";

        export const helpText = t({
          id: "assistant.form.description.helpText",
          message: "Optional: Describe what this assistant does",
          extra: {
            optional_component: true,
          },
        });
      `,
      {},
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({
      id: "assistant.form.description.helpText",
      message: "Optional: Describe what this assistant does",
      comment: "js-lingui-extra: optional_component=true",
    });
  });

  it("extracts multiple extra fields including nested objects", async () => {
    const extracted = await extractLinguiExtraMetadata(
      "src/example.tsx",
      `
        import { t } from "@lingui/core/macro";

        export const helpText = t({
          id: "assistant.form.description.helpText",
          message: "Optional: Describe what this assistant does",
          extra: {
            optional_component: true,
            ui_behavior: {
              hideWhenEmpty: true,
              fallback: {
                key: "assistant.form.description.placeholder",
                strategy: "hide",
              },
            },
            visibility: "optional",
          },
        });
      `,
      {},
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.comment).toBe(
      [
        "js-lingui-extra: optional_component=true",
        'js-lingui-extra: ui_behavior={"hideWhenEmpty":true,"fallback":{"key":"assistant.form.description.placeholder","strategy":"hide"}}',
        'js-lingui-extra: visibility="optional"',
      ].join("\n"),
    );
  });

  it("preserves comment and context alongside extracted metadata", async () => {
    const extracted = await extractLinguiExtraMetadata(
      "src/example.tsx",
      `
        import { t } from "@lingui/core/macro";

        export const helpText = t({
          id: "assistant.form.description.helpText",
          message: "Optional: Describe what this assistant does",
          comment: "Shown below the assistant description field",
          context: "assistant-form",
          extra: {
            optional_component: true,
          },
        });
      `,
      {},
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({
      id: "assistant.form.description.helpText",
      message: "Optional: Describe what this assistant does",
      context: "assistant-form",
      comment: [
        "Shown below the assistant description field",
        "js-lingui-extra: optional_component=true",
      ].join("\n"),
    });
  });
});
