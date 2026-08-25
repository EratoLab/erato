import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";

import { messages as enMessages } from "@/locales/en/messages.json";

import { ModelSwitchMarker } from "./ModelSwitchMarker";

import type { Messages } from "@lingui/core";

beforeAll(() => {
  i18n.load("en", enMessages as unknown as Messages);
  i18n.activate("en");
});

describe("ModelSwitchMarker", () => {
  it("names both sides of the transition", () => {
    render(
      <I18nProvider i18n={i18n}>
        <ModelSwitchMarker fromModel="Model One" toModel="Model Two" />
      </I18nProvider>,
    );

    const marker = screen.getByTestId("model-switch-marker");

    expect(marker).toHaveAttribute("role", "note");
    expect(marker).toHaveClass("w-full", "justify-center");
    expect(
      screen.getByText("Model changed from Model One to Model Two"),
    ).toBeInTheDocument();
  });

  it("takes its spacing from theme tokens so customer themes can retune it", () => {
    render(
      <I18nProvider i18n={i18n}>
        <ModelSwitchMarker fromModel="Model One" toModel="Model Two" />
      </I18nProvider>,
    );

    expect(screen.getByTestId("model-switch-marker")).toHaveStyle({
      gap: "var(--theme-spacing-control-gap)",
      marginBottom: "var(--theme-spacing-message-padding-y)",
    });
  });
});
