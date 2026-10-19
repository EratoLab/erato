import { composerContextChipFaceConformanceFailures } from "@erato/frontend/conformance";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import { ExampleComposerContextChipFace } from "./ExampleComposerContextChipFace";

i18n.loadAndActivate({ locale: "en", messages: {} });

it("keeps the host's context chip contract", () => {
  expect(
    composerContextChipFaceConformanceFailures(ExampleComposerContextChipFace, {
      render: (element) =>
        render(<I18nProvider i18n={i18n}>{element}</I18nProvider>),
    }),
  ).toEqual([]);
});
