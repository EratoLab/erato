import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useToastStore } from "@/components/ui/Toast/toastStore";

import AssistantEditPage from "../AssistantEditPage";

import type { AssistantFormProps } from "@/components/ui/Assistant/AssistantForm";
import type { Assistant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

let assistant: Assistant;
const updateAssistantMock = vi.fn().mockResolvedValue({});

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useAssistantsFeature: () => ({ enabled: true, usageViewEnabled: false }),
}));

vi.mock("@/hooks/ui", () => ({
  usePageAlignment: () => ({
    containerClasses: "container",
    horizontalPadding: "px-4",
  }),
}));

vi.mock("@/components/ui/Sharing", () => ({
  SharingDialog: () => null,
  SharingErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
}));

// The form itself is exercised in its own tests; the stub hands the hydrated
// draft straight back so this suite pins only the page's request building.
vi.mock("@/components/ui/Assistant/AssistantForm", () => ({
  AssistantForm: ({ initialData, onSubmit, onCancel }: AssistantFormProps) => (
    <>
      <button
        data-testid="submit-form-stub"
        onClick={() => {
          void onSubmit({
            name: initialData?.name ?? "",
            description: initialData?.description ?? "",
            welcomeMessage: "",
            starterPrompts: [],
            prompt: initialData?.prompt ?? "",
            defaultModel: initialData?.defaultModel ?? null,
            facetIds: initialData?.facetIds ?? [],
            enforceFacetSettings: initialData?.enforceFacetSettings ?? false,
            files: initialData?.files ?? [],
            mcpServerIds: initialData?.mcpServerIds ?? [],
          });
        }}
      />
      <button data-testid="cancel-form-stub" onClick={onCancel} />
    </>
  ),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useGetAssistant: () => ({
    data: assistant,
    isLoading: false,
    error: null,
  }),
  useAvailableModels: () => ({ data: [] }),
  useAssistantHubConfig: () => ({ data: undefined }),
  useUpdateAssistant: () => ({
    mutateAsync: updateAssistantMock,
    isPending: false,
  }),
  listAssistantsQuery: () => ({ queryKey: ["assistants"] }),
  getAssistantQuery: () => ({ queryKey: ["assistant"] }),
}));

function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/assistants/edit/assistant-1"]}>
        <Routes>
          <Route
            path="/assistants/edit/:id"
            element={<AssistantEditPage />}
          ></Route>
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

describe("AssistantEditPage", () => {
  beforeEach(() => {
    updateAssistantMock.mockReset();
    updateAssistantMock.mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
    assistant = {
      id: "assistant-1",
      name: "Unrestricted assistant",
      description: null,
      prompt: "You are an assistant without server restrictions.",
      default_chat_provider: null,
      facet_ids: null,
      starter_prompts: [],
      enforce_facet_settings: false,
      files: [],
      mcp_server_ids: null,
      can_edit: true,
    } as unknown as Assistant;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("always sends mcp_server_ids, spelling an empty selection as []", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));

    await waitFor(() => {
      expect(updateAssistantMock).toHaveBeenCalledTimes(1);
    });
    const { body } = updateAssistantMock.mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    // An omitted field would leave the restriction unchanged on the backend,
    // so the empty selection must travel explicitly as [].
    expect(body).toHaveProperty("mcp_server_ids");
    expect(body.mcp_server_ids).toEqual([]);
  });

  it("round-trips a configured server subset into the request body", async () => {
    assistant = {
      ...assistant,
      mcp_server_ids: ["search-server"],
    };

    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));

    await waitFor(() => {
      expect(updateAssistantMock).toHaveBeenCalledTimes(1);
    });
    const { body } = updateAssistantMock.mock.calls[0][0] as {
      body: Record<string, unknown>;
    };
    expect(body.mcp_server_ids).toEqual(["search-server"]);
  });

  it("returns to the list as soon as the save lands, with the saved assistant cached", async () => {
    const savedAssistant = { ...assistant, name: "Renamed assistant" };
    updateAssistantMock.mockResolvedValueOnce(savedAssistant);
    const queryClient = new QueryClient();
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise(() => {}),
    );

    renderPage(queryClient);

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();

    expect(screen.getByTestId("assistants-list")).toBeInTheDocument();
    // A refetch would be aborted by the page unmounting, restoring the
    // pre-save copy, so the response itself has to land in the cache.
    expect(queryClient.getQueryData(["assistant"])).toEqual(savedAssistant);
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success", title: "Assistant updated successfully!" },
    ]);
  });

  it("stays on the form after a failed save, and a successful retry replaces the error toast", async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();

    expect(screen.queryByTestId("assistants-list")).not.toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error" },
    ]);

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();

    expect(screen.getByTestId("assistants-list")).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "success" },
    ]);
  });

  it("drops a failed save's error toast once the user leaves the page", async () => {
    updateAssistantMock.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderPage();

    fireEvent.click(screen.getByTestId("submit-form-stub"));
    await settle();
    expect(useToastStore.getState().toasts).toMatchObject([
      { variant: "error" },
    ]);

    unmount();

    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
