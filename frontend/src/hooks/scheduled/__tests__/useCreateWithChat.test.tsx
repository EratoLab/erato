import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readComposerPreset } from "@/hooks/chat/useComposerPreset";

import { useCreateWithChat } from "../useCreateWithChat";

import type { FacetInfo } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const facets = vi.hoisted(() => ({ current: [] as FacetInfo[] }));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useFacets: () => ({ data: { facets: facets.current } }),
}));

function Probe() {
  const createWithChat = useCreateWithChat();
  const location = useLocation();
  return (
    <>
      <button
        type="button"
        disabled={!createWithChat}
        onClick={() => createWithChat?.()}
      >
        create
      </button>
      <output data-testid="path">{location.pathname}</output>
      <output data-testid="preset">
        {JSON.stringify(readComposerPreset(location.state))}
      </output>
    </>
  );
}

const renderProbe = () =>
  render(
    <MemoryRouter initialEntries={["/scheduled"]}>
      <Probe />
    </MemoryRouter>,
  );

describe("useCreateWithChat", () => {
  beforeEach(() => {
    facets.current = [];
  });

  it("is unavailable while the user has no schedule facet", () => {
    facets.current = [
      { id: "web_search", display_name: "Web search", default_enabled: false },
    ];
    renderProbe();

    expect(screen.getByRole("button", { name: "create" })).toBeDisabled();
  });

  it("opens a new chat with the schedule facet preselected", () => {
    facets.current = [
      { id: "schedule", display_name: "Schedule", default_enabled: false },
    ];
    renderProbe();

    act(() => screen.getByRole("button", { name: "create" }).click());

    expect(screen.getByTestId("path")).toHaveTextContent("/chat/new");
    expect(
      JSON.parse(screen.getByTestId("preset").textContent ?? "null"),
    ).toEqual({ facetIds: ["schedule"] });
  });
});
