import { describe, expect, it } from "vitest";

import { sectionedPoFormatter } from "./index";

describe("sectionedPoFormatter", () => {
  it("round-trips custom metadata through PO comments", async () => {
    const formatter = sectionedPoFormatter({ lineNumbers: false });
    const catalog = {
      "assistant.form.description.helpText": {
        comments: ["js-lingui-explicit-id"],
        extra: {
          optional_component: true,
          translatorComments: [],
          flags: [],
        },
        origin: [["src/components/ui/Assistant/AssistantForm.tsx"]],
        translation: "Optional: Describe what this assistant does",
      },
    };

    const serialized = await formatter.serialize(catalog, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
      existing: null,
    });

    expect(serialized).toContain("#. js-lingui-extra: optional_component=true");

    const parsed = await formatter.parse(serialized, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
    });

    const parsedExtra =
      parsed["assistant.form.description.helpText"]?.extra ?? {};

    expect(parsedExtra.optional_component).toBe(true);
    expect(parsedExtra.flags).toEqual([]);
    expect(Array.isArray(parsedExtra.translatorComments)).toBe(true);
  });

  it("round-trips multiple extra fields including nested objects", async () => {
    const formatter = sectionedPoFormatter({ lineNumbers: false });
    const catalog = {
      "assistant.form.description.helpText": {
        comments: ["js-lingui-explicit-id"],
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
        origin: [["src/components/ui/Assistant/AssistantForm.tsx"]],
        translation: "Optional: Describe what this assistant does",
      },
    };

    const serialized = await formatter.serialize(catalog, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
      existing: null,
    });

    expect(serialized).toContain("#. js-lingui-extra: optional_component=true");
    expect(serialized).toContain(
      '#. js-lingui-extra: ui_behavior={"hideWhenEmpty":true,"fallback":{"key":"assistant.form.description.placeholder","strategy":"hide"}}',
    );
    expect(serialized).toContain('#. js-lingui-extra: visibility="optional"');

    const parsed = await formatter.parse(serialized, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
    });

    expect(parsed["assistant.form.description.helpText"]?.extra).toMatchObject({
      optional_component: true,
      ui_behavior: {
        hideWhenEmpty: true,
        fallback: {
          key: "assistant.form.description.placeholder",
          strategy: "hide",
        },
      },
      visibility: "optional",
    });
  });

  it("round-trips comment and context alongside custom metadata", async () => {
    const formatter = sectionedPoFormatter({ lineNumbers: false });
    const catalog = {
      "assistant.form.description.helpText": {
        comments: [
          "Shown below the assistant description field",
          "js-lingui-explicit-id",
        ],
        context: "assistant-form",
        extra: {
          optional_component: true,
        },
        origin: [["src/components/ui/Assistant/AssistantForm.tsx"]],
        translation: "Optional: Describe what this assistant does",
      },
    };

    const serialized = await formatter.serialize(catalog, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
      existing: null,
    });

    expect(serialized).toContain(
      "#. Shown below the assistant description field",
    );
    expect(serialized).toContain("#. js-lingui-extra: optional_component=true");
    expect(serialized).toContain('msgctxt "assistant-form"');

    const parsed = await formatter.parse(serialized, {
      locale: "en",
      sourceLocale: "en",
      filename: "src/locales/en/messages.po",
    });

    expect(parsed["assistant.form.description.helpText"]?.comments).toContain(
      "Shown below the assistant description field",
    );
    expect(parsed["assistant.form.description.helpText"]?.context).toBe(
      "assistant-form",
    );
    expect(
      parsed["assistant.form.description.helpText"]?.extra?.optional_component,
    ).toBe(true);
  });
});
