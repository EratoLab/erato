import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AssistantEditPage from "../AssistantEditPage";

import type { AssistantFormProps } from "@/components/ui/Assistant/AssistantForm";
import type { Assistant } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

let assistant: Assistant;
const updateAssistantMock = vi.fn().mockResolvedValue({});

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
  AssistantForm: ({ initialData, onSubmit }: AssistantFormProps) => (
    <button
      data-testid="submit-form-stub"
      onClick={() => {
        void onSubmit({
          name: initialData?.name ?? "",
          description: initialData?.description ?? "",
          prompt: initialData?.prompt ?? "",
          defaultModel: initialData?.defaultModel ?? null,
          facetIds: initialData?.facetIds ?? [],
          enforceFacetSettings: initialData?.enforceFacetSettings ?? false,
          files: initialData?.files ?? [],
          mcpServerIds: initialData?.mcpServerIds ?? [],
        });
      }}
    />
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

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/assistants/edit/assistant-1"]}>
        <Routes>
          <Route
            path="/assistants/edit/:id"
            element={<AssistantEditPage />}
          ></Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AssistantEditPage", () => {
  beforeEach(() => {
    updateAssistantMock.mockClear();
    assistant = {
      id: "assistant-1",
      name: "Unrestricted assistant",
      description: null,
      prompt: "You are an assistant without server restrictions.",
      default_chat_provider: null,
      facet_ids: null,
      enforce_facet_settings: false,
      files: [],
      mcp_server_ids: null,
      can_edit: true,
    } as unknown as Assistant;
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
});
