import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";

import AssistantCreatePage from "../AssistantCreatePage";


import type { AssistantFormProps } from "@/components/ui/Assistant/AssistantForm";

const createAssistantMock = vi.fn();

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/components/ui/Assistant/AssistantForm", () => ({
  AssistantForm: ({ onSubmit }: AssistantFormProps) => (
    <button
      data-testid="submit-form-stub"
      onClick={() => {
        void onSubmit({
          name: "Reviewer",
          description: "",
          prompt: "Review the draft.",
          defaultModel: null,
          facetIds: [],
          enforceFacetSettings: false,
          files: [],
          mcpServerIds: [],
        });
      }}
    />
  ),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useAvailableModels: () => ({ data: [] }),
  useCreateAssistant: () => ({
    mutateAsync: createAssistantMock,
    isPending: false,
  }),
  listAssistantsQuery: () => ({ queryKey: ["assistants"] }),
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/assistants/new"]}>
        <Routes>
          <Route path="/assistants/new" element={<AssistantCreatePage />} />
          <Route
            path="/assistants/created"
            element={<div data-testid="assistants-list" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssistantCreatePage", () => {
  beforeEach(() => {
    createAssistantMock.mockReset();
    createAssistantMock.mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
  });

  it("returns to the list as soon as the assistant is created, confirming it in a toast", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));

    expect(await screen.findByTestId("assistants-list")).toBeInTheDocument();
    expect(createAssistantMock).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Assistant created successfully!" },
    ]);
  });

  it("stays on the form and reports a failed create in a toast", async () => {
    createAssistantMock.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));

    await waitFor(() => {
      expect(useToastStore.getState().toasts).toMatchObject([
        { variant: "error" },
      ]);
    });
    expect(screen.getByTestId("submit-form-stub")).toBeInTheDocument();
    expect(screen.queryByTestId("assistants-list")).not.toBeInTheDocument();
  });
});
