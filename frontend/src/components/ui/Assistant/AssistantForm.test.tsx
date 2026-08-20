import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaticFeatureConfigProvider } from "@/providers/FeatureConfigProvider";

import { AssistantForm } from "./AssistantForm";

import type { TokenUsageEstimationResult } from "@/hooks/chat/useTokenUsageEstimation";
import type {
  ChatModel,
  FileUploadItem,
  McpServerStatus,
} from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type React from "react";

const pdfFileCapability = {
  id: "pdf",
  extensions: ["pdf"],
  mime_types: ["application/pdf"],
  operations: ["extract_text"],
};

const mockModels: ChatModel[] = [
  {
    chat_provider_id: "mock-llm",
    model_display_name: "Mock LLM",
  },
  {
    chat_provider_id: "mock-llm-alt",
    model_display_name: "Mock LLM Alt",
  },
];

const estimateTokenUsageFromPartsMock = vi.fn();
const clearLastEstimationMock = vi.fn();
let mockedLastEstimation: TokenUsageEstimationResult | null = null;
let mockedIsLoading = false;

vi.mock("@/hooks/chat/useTokenUsageEstimation", () => ({
  useTokenUsageEstimation: () => ({
    estimateTokenUsageFromParts: estimateTokenUsageFromPartsMock,
    lastEstimation: mockedLastEstimation,
    clearLastEstimation: clearLastEstimationMock,
    isLoading: mockedIsLoading,
  }),
}));

vi.mock("@/hooks/ui", () => ({
  useFilePreviewModal: () => ({
    isPreviewModalOpen: false,
    fileToPreview: null,
    openPreviewModal: vi.fn(),
    closePreviewModal: vi.fn(),
  }),
}));

let mockedMcpServersData: { servers: McpServerStatus[] } | undefined =
  undefined;

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  usePromptOptimizer: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useFacets: () => ({
    data: {
      facets: [],
      global_facet_settings: null,
    },
  }),
  useListMcpServers: () => ({
    data: mockedMcpServersData,
  }),
}));

vi.mock("@/components/ui/FileUpload", () => ({
  AssistantFileUploadSelector: () => (
    <div data-testid="assistant-file-upload" />
  ),
  FileAttachmentsPreview: () => <div data-testid="file-attachments-preview" />,
}));

vi.mock("@/components/ui/Modal/FilePreviewModal", () => ({
  FilePreviewModal: () => null,
}));

vi.mock("@/components/ui/Controls/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));

vi.mock("@/components/ui/Feedback/Alert", () => ({
  Alert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

function renderForm({
  tokenUsageEstimationOverride,
  contextWarningThreshold = 0.5,
  contextFileContributorThreshold = 0.05,
}: {
  tokenUsageEstimationOverride?: TokenUsageEstimationResult | null;
  contextWarningThreshold?: number;
  contextFileContributorThreshold?: number;
}) {
  return render(
    <StaticFeatureConfigProvider
      config={{
        assistants: {
          enabled: false,
          showRecentItems: false,
          showRecentItemsCollapsible: false,
          contextWarningThreshold,
          contextFileContributorThreshold,
        },
      }}
    >
      <AssistantForm
        onSubmit={vi.fn()}
        tokenUsageEstimationOverride={tokenUsageEstimationOverride ?? null}
      />
    </StaticFeatureConfigProvider>,
  );
}

const mockMcpServers: McpServerStatus[] = [
  {
    id: "search-server",
    authentication_mode: "none",
    connection_status: "SUCCESS",
  },
  {
    id: "oauth-server",
    authentication_mode: "oauth2",
    connection_status: "NEEDS_AUTHENTICATION",
  },
];

function renderFormWithMcpServers({
  initialData,
}: {
  initialData?: React.ComponentProps<typeof AssistantForm>["initialData"];
} = {}) {
  const onSubmit =
    vi.fn<React.ComponentProps<typeof AssistantForm>["onSubmit"]>();
  const result = render(
    <MemoryRouter>
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
          userPreferences: { mcpServersTabEnabled: true },
        }}
      >
        <AssistantForm
          mode={initialData ? "edit" : "create"}
          assistantId={initialData ? "assistant-1" : undefined}
          initialData={initialData}
          onSubmit={onSubmit}
          disableLiveTokenUsageEstimation
        />
      </StaticFeatureConfigProvider>
    </MemoryRouter>,
  );
  return { onSubmit, ...result };
}

describe("AssistantForm", () => {
  beforeEach(() => {
    estimateTokenUsageFromPartsMock.mockReset();
    clearLastEstimationMock.mockReset();
    mockedLastEstimation = null;
    mockedIsLoading = false;
    mockedMcpServersData = undefined;
  });

  it("estimates edit-mode context from the draft files without assistant_id", async () => {
    const existingFile = {
      id: "file-1",
      filename: "long-file-100k-words.pdf",
      download_url: "https://example.com/file-1",
      file_capability: pdfFileCapability,
    } as FileUploadItem;

    render(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm
          mode="edit"
          assistantId="assistant-1"
          initialData={{
            name: "Existing assistant",
            prompt:
              "You are a helpful assistant that should use uploaded files.",
            files: [existingFile],
          }}
          onSubmit={vi.fn()}
        />
      </StaticFeatureConfigProvider>,
    );

    await waitFor(() => {
      expect(estimateTokenUsageFromPartsMock).toHaveBeenCalled();
    });

    expect(estimateTokenUsageFromPartsMock).toHaveBeenLastCalledWith({
      new_chat: {},
      system_prompt:
        "You are a helpful assistant that should use uploaded files.",
      new_message_content: "Existing assistant",
      file: { input_files_ids: ["file-1"] },
      selected_facet_ids: [],
    });
  });

  it("hides context warning details below the configured threshold", () => {
    renderForm({
      contextWarningThreshold: 0.5,
      tokenUsageEstimationOverride: {
        tokenUsage: {
          stats: {
            total_tokens: 400,
            max_tokens: 1000,
            remaining_tokens: 600,
          },
          file_details: [
            {
              filename: "notes.md",
              token_count: 40,
            },
          ],
        },
        isLoading: false,
        error: null,
        isApproachingLimit: false,
        isCriticallyClose: false,
        usagePercentage: 0.4,
        exceedsLimit: false,
      } as TokenUsageEstimationResult,
    });

    expect(screen.queryByText("Used context: 40%")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Largest file context contributors:"),
    ).not.toBeInTheDocument();
  });

  it("shows all contributing files when the threshold is set to zero", () => {
    renderForm({
      contextWarningThreshold: 0,
      contextFileContributorThreshold: 0,
      tokenUsageEstimationOverride: {
        tokenUsage: {
          stats: {
            total_tokens: 400,
            max_tokens: 1000,
            remaining_tokens: 600,
          },
          file_details: [
            {
              filename: "tiny-context.md",
              token_count: 40,
            },
            {
              filename: "bigger-context.md",
              token_count: 120,
            },
          ],
        },
        isLoading: false,
        error: null,
        isApproachingLimit: false,
        isCriticallyClose: false,
        usagePercentage: 0.4,
        exceedsLimit: false,
      } as TokenUsageEstimationResult,
    });

    expect(screen.getByText("Used context: 40%")).toBeInTheDocument();
    expect(
      screen.getByText("Largest file context contributors:"),
    ).toBeInTheDocument();
    expect(screen.getByText("tiny-context.md: 4.0%")).toBeInTheDocument();
    expect(screen.getByText("bigger-context.md: 12.0%")).toBeInTheDocument();
  });

  it("clears previous estimates when the form becomes empty", async () => {
    render(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm onSubmit={vi.fn()} />
      </StaticFeatureConfigProvider>,
    );

    await waitFor(() => {
      expect(clearLastEstimationMock).toHaveBeenCalled();
    });
  });

  it("rehydrates edit form state when initial data arrives after mount", async () => {
    const { rerender } = render(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm
          mode="edit"
          assistantId="assistant-1"
          onSubmit={vi.fn()}
        />
      </StaticFeatureConfigProvider>,
    );

    const loadedFile = {
      id: "file-2",
      filename: "loaded.pdf",
      download_url: "https://example.com/file-2",
      file_capability: pdfFileCapability,
    } as FileUploadItem;

    rerender(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm
          mode="edit"
          assistantId="assistant-1"
          initialData={{
            name: "Loaded assistant",
            prompt: "You are a helpful assistant loaded after mount.",
            files: [loadedFile],
          }}
          onSubmit={vi.fn()}
        />
      </StaticFeatureConfigProvider>,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Loaded assistant")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(estimateTokenUsageFromPartsMock).toHaveBeenLastCalledWith({
        new_chat: {},
        system_prompt: "You are a helpful assistant loaded after mount.",
        new_message_content: "Loaded assistant",
        file: { input_files_ids: ["file-2"] },
        selected_facet_ids: [],
      });
    });
  });

  it("shows the latest estimate instead of the loading placeholder when a refresh is in progress", () => {
    mockedIsLoading = true;
    mockedLastEstimation = {
      tokenUsage: {
        stats: {
          total_tokens: 400,
          user_message_tokens: 0,
          history_tokens: 400,
          file_tokens: 0,
          max_tokens: 1000,
          remaining_tokens: 600,
          chat_provider_id: "mock-provider",
        },
        file_details: [],
      },
      isLoading: false,
      error: null,
      isApproachingLimit: false,
      isCriticallyClose: false,
      usagePercentage: 0.4,
      exceedsLimit: false,
    };

    renderForm({
      contextWarningThreshold: 0,
      tokenUsageEstimationOverride: null,
    });

    expect(
      screen.queryByText("Estimating token usage..."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Used context: 40%")).toBeInTheDocument();
  });

  it("defaults the assistant model selector to 'No default model' and submits a null model", async () => {
    const onSubmit = vi.fn();

    render(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm availableModels={mockModels} onSubmit={onSubmit} />
      </StaticFeatureConfigProvider>,
    );

    expect(screen.getByTitle("No default model")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Model-less assistant" },
    });
    fireEvent.change(screen.getByLabelText(/system prompt/i), {
      target: {
        value: "You are a helpful assistant without a pinned model.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /create assistant/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: null,
      }),
    );
  });

  it("shows a warning when Sharepoint files are attached", () => {
    render(
      <StaticFeatureConfigProvider
        config={{
          assistants: {
            enabled: false,
            showRecentItems: false,
            showRecentItemsCollapsible: false,
            contextWarningThreshold: 0.5,
            contextFileContributorThreshold: 0.05,
          },
        }}
      >
        <AssistantForm
          onSubmit={vi.fn()}
          initialData={{
            files: [
              {
                id: "sharepoint-file",
                filename: "sharepoint-report.pdf",
                download_url: "https://example.com/sharepoint-report.pdf",
                file_contents_unavailable_missing_permissions: false,
                file_capability: pdfFileCapability,
                is_sharepoint_file: true,
              } as FileUploadItem,
            ],
          }}
        />
      </StaticFeatureConfigProvider>,
    );

    expect(
      screen.getByText(
        "Some files are linked from Sharepoint. If you share this assistant, ensure those files are also shared with recipients.",
      ),
    ).toBeInTheDocument();
  });

  it("renders the MCP server control with the all-servers default state", () => {
    mockedMcpServersData = { servers: mockMcpServers };

    renderFormWithMcpServers();

    expect(screen.getByText("MCP Servers")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "search-server" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "oauth-server" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("mcp-server-selector-summary")).toHaveTextContent(
      "No servers selected — this assistant can use every server available to the person chatting with it.",
    );
    expect(
      screen.getByTestId("mcp-server-connect-oauth-server"),
    ).toBeInTheDocument();
  });

  it("hides the MCP server control when no servers are listed", () => {
    mockedMcpServersData = { servers: [] };

    renderFormWithMcpServers();

    expect(screen.queryByText("MCP Servers")).not.toBeInTheDocument();
  });

  it("submits the selected MCP server ids", () => {
    mockedMcpServersData = { servers: mockMcpServers };

    const { onSubmit } = renderFormWithMcpServers();

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Server-bound assistant" },
    });
    fireEvent.change(screen.getByLabelText(/system prompt/i), {
      target: { value: "You are an assistant with restricted servers." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "search-server" }));
    fireEvent.click(screen.getByRole("button", { name: /create assistant/i }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServerIds: ["search-server"],
      }),
    );
  });

  it("hydrates an existing MCP server subset in edit mode", () => {
    mockedMcpServersData = { servers: mockMcpServers };

    renderFormWithMcpServers({
      initialData: {
        name: "Existing assistant",
        prompt: "You are an assistant with a configured server subset.",
        mcpServerIds: ["oauth-server"],
      },
    });

    expect(
      screen.getByRole("checkbox", { name: "oauth-server" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "search-server" }),
    ).not.toBeChecked();
    expect(screen.getByTestId("mcp-server-selector-summary")).toHaveTextContent(
      "This assistant can only use the selected servers.",
    );
  });

  it("keeps attached server ids untouched until the listing has answered", async () => {
    const onSubmit =
      vi.fn<React.ComponentProps<typeof AssistantForm>["onSubmit"]>();
    // A fresh element per render pass; reusing one element reference would let
    // React bail out of re-rendering and never re-read the listing mock.
    const makeFormTree = () => (
      <MemoryRouter>
        <StaticFeatureConfigProvider
          config={{
            assistants: {
              enabled: false,
              showRecentItems: false,
              showRecentItemsCollapsible: false,
              contextWarningThreshold: 0.5,
              contextFileContributorThreshold: 0.05,
            },
            userPreferences: { mcpServersTabEnabled: true },
          }}
        >
          <AssistantForm
            mode="edit"
            assistantId="assistant-1"
            initialData={{
              name: "Existing assistant",
              prompt: "You are an assistant whose listing is still loading.",
              mcpServerIds: ["ghost-server", "search-server"],
            }}
            onSubmit={onSubmit}
            disableLiveTokenUsageEstimation
          />
        </StaticFeatureConfigProvider>
      </MemoryRouter>
    );

    // Listing still unanswered: nothing may be sanitized away.
    mockedMcpServersData = undefined;
    const { rerender } = render(makeFormTree());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerIds: ["ghost-server", "search-server"],
        }),
      );
    });

    // Once the listing answers, the unknown id is dropped with a warning.
    mockedMcpServersData = { servers: mockMcpServers };
    rerender(makeFormTree());

    await waitFor(() => {
      expect(
        screen.getByText(
          "Some previously configured MCP servers are no longer available and were removed from this assistant.",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          mcpServerIds: ["search-server"],
        }),
      );
    });
  });

  it("drops configured MCP servers missing from the listing and warns", async () => {
    mockedMcpServersData = { servers: mockMcpServers };

    const { onSubmit } = renderFormWithMcpServers({
      initialData: {
        name: "Existing assistant",
        prompt: "You are an assistant with a stale server subset.",
        mcpServerIds: ["ghost-server", "search-server"],
      },
    });

    expect(
      screen.getByText(
        "Some previously configured MCP servers are no longer available and were removed from this assistant.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServerIds: ["search-server"],
        }),
      );
    });
  });
});
