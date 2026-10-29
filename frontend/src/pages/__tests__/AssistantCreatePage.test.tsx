import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  AssistantForm: ({ onSubmit, onCancel }: AssistantFormProps) => (
    <>
      <button
        data-testid="submit-form-stub"
        onClick={() => {
          void onSubmit({
            name: "Reviewer",
            description: "",
            welcomeMessage: "",
            starterPrompts: [],
            prompt: "Review the draft.",
            defaultModel: null,
            facetIds: [],
            enforceFacetSettings: false,
            files: [],
            mcpServerIds: [],
          });
        }}
      />
      <button data-testid="cancel-form-stub" onClick={onCancel} />
    </>
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

function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
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

// One macrotask lets the save's promise chain settle; a redirect held behind
// a timer or a refetch would still be pending.
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("AssistantCreatePage", () => {
  beforeEach(() => {
    createAssistantMock.mockReset();
    createAssistantMock.mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns to the list as soon as the assistant is created, without waiting for the list to refetch", async () => {
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise(() => {}),
    );

    renderPage(queryClient);

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();

    expect(screen.getByTestId("assistants-list")).toBeInTheDocument();
    expect(createAssistantMock).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Assistant created successfully!" },
    ]);
  });

  it("stays on the form after a failed create, and cancelling clears the error toast", async () => {
    createAssistantMock.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();

    expect(screen.queryByTestId("assistants-list")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error" },
    ]);

    fireEvent.click(screen.getByTestId("cancel-form-stub"));
    await settle();

    expect(screen.getByTestId("assistants-list")).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
