import { i18n } from "@lingui/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientActionsSettings } from "../ClientActionsSettings";
import { createClientActionDecisionStore } from "../clientActionPolicy";

const facets = vi.hoisted(() => ({
  action_facets: [] as Array<{
    id: string;
    display_name: string;
    client_actions?: string[];
    client_actions_always_ask?: string[];
    presentation?: string;
  }>,
}));

vi.mock("@erato/frontend/library", () => ({
  RadioCard: ({
    label,
    helper,
    checked,
    disabled,
    onChange,
    name,
    value,
  }: {
    label: string;
    helper: string;
    checked: boolean;
    disabled?: boolean;
    onChange: () => void;
    name: string;
    value: string;
  }) => (
    <label>
      <input
        type="radio"
        aria-label={label}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span>{helper}</span>
    </label>
  ),
  useFacets: () => ({ data: facets }),
  usePersistedState: <T,>(_key: string, initialValue: T) =>
    useState(initialValue),
}));

type WordClientAction = "word.apply_edits";
const store = createClientActionDecisionStore({
  storageKey: "erato.addin.word.clientActionDecisions",
  isImplementedAction: (action) => action === "word.apply_edits",
});
const offerableActions = (allowed: readonly string[]): WordClientAction[] =>
  allowed.includes("word.apply_edits") ? ["word.apply_edits"] : [];
const displayLabel = (action: WordClientAction) =>
  action === "word.apply_edits" ? "Apply the suggested edits" : action;
const copy = {
  intro: "Decisions from the in-document confirmation live here.",
  alwaysAllowHelper: "Applies the edits without asking; undo stays available.",
};

function renderSettings() {
  return render(
    <ClientActionsSettings
      store={store}
      offerableActions={offerableActions}
      displayLabel={displayLabel}
      copy={copy}
    />,
  );
}

beforeEach(() => {
  i18n.activate("en");
});

afterEach(() => {
  cleanup();
  facets.action_facets = [];
});

describe("ClientActionsSettings (host-neutral)", () => {
  it("renders one decision row per host-offerable action with the host copy", () => {
    facets.action_facets = [
      {
        id: "word_edit_selection",
        display_name: "Edit selection",
        client_actions: ["word.apply_edits", "word.not_implemented"],
      },
      {
        id: "word_summarize",
        display_name: "Summarize",
        client_actions: ["word.not_implemented"],
      },
    ];
    renderSettings();

    const group = screen.getByRole("radiogroup", {
      name: "Apply the suggested edits",
    });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByText("Edit selection")).toBeInTheDocument();
    expect(screen.queryByText("Summarize")).not.toBeInTheDocument();
    expect(screen.getByText(/in-document confirmation/)).toBeInTheDocument();
    expect(screen.getByText(copy.alwaysAllowHelper)).toBeInTheDocument();
    // Defaults to ask.
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
  });

  it("writes the decision under facet/action when a row is chosen", () => {
    facets.action_facets = [
      {
        id: "word_edit_selection",
        display_name: "Edit selection",
        client_actions: ["word.apply_edits"],
      },
    ];
    renderSettings();
    const radios = screen.getAllByRole("radio");
    fireEvent.click(radios[2]);
    expect(radios[2]).toBeChecked();
    expect(radios[0]).not.toBeChecked();
  });

  it("locks always-allow when the deployment enforces confirmation", () => {
    facets.action_facets = [
      {
        id: "word_edit_selection",
        display_name: "Edit selection",
        client_actions: ["word.apply_edits"],
        client_actions_always_ask: ["word.apply_edits"],
      },
    ];
    renderSettings();
    const always = screen.getAllByRole("radio")[1];
    expect(always).toBeDisabled();
    expect(screen.queryByText(copy.alwaysAllowHelper)).not.toBeInTheDocument();
  });

  it("shows the empty state when no facet offers an implemented action", () => {
    facets.action_facets = [
      {
        id: "word_summarize",
        display_name: "Summarize",
        client_actions: ["word.not_implemented"],
      },
    ];
    renderSettings();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(
      screen.getByText(/No assistant-suggested actions/),
    ).toBeInTheDocument();
  });
});
