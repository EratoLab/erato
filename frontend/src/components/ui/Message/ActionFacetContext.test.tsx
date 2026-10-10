import { i18n } from "@lingui/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ActionFacetContext } from "./ActionFacetContext";

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
});
afterEach(cleanup);

const quote = () => screen.getByText("Selection").nextElementSibling!;

describe("ActionFacetContext", () => {
  it("keeps the selection's paragraph breaks", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{ selected_text: "First paragraph.\nSecond one." }}
      />,
    );

    expect(quote().textContent).toBe("First paragraph.\nSecond one.");
    expect(quote()).toHaveClass("whitespace-pre-line");
  });

  it("labels the markers kept_items explains", () => {
    render(
      <ActionFacetContext
        actionFacetArgs={{
          selected_text: "See ⟦1⟧link⟦/1⟧ on ⟦2⟧.",
          kept_items: [
            "⟦1⟧…⟦/1⟧ a link around the text between; that text may change",
            '⟦2⟧ a field showing "2026-10-10"',
          ].join("\n"),
        }}
      />,
    );

    expect(quote().textContent).toBe("See [link]link[/link] on [2026-10-10].");
  });

  it("leaves the text alone without kept_items", () => {
    render(
      <ActionFacetContext actionFacetArgs={{ selected_text: "Plain ⟦1⟧." }} />,
    );

    expect(quote().textContent).toBe("Plain ⟦1⟧.");
  });
});
