import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudFilePicker } from "./CloudFilePicker";

import type { CloudDrive, CloudItem } from "@/lib/api/cloudProviders/types";

vi.mock("@/components/providers/ThemeProvider", () => ({
  useTheme: () => ({ iconMappings: {} }),
}));
vi.mock("@/providers/FeatureConfigProvider", () => ({
  useCloudProvidersFeature: () => ({ sharepointShowDisclaimer: false }),
}));

const state = vi.hoisted(() => ({
  partial: false,
  error: false,
  retry: vi.fn(),
}));
const drive: CloudDrive = {
  id: "finance",
  name: "Finance",
  drive_type: "documentLibrary",
  kind: "sharepoint_site_library",
  provider: "sharepoint",
};
const budget: CloudItem = {
  id: "same-id",
  name: "Budget.pdf",
  is_folder: false,
  drive_id: "finance",
  provider: "sharepoint",
};
vi.mock("@/hooks/cloud/useCloudData", () => ({
  useCloudData: ({ driveId }: { driveId: string | null }) => ({
    drives: [drive],
    items: driveId ? [budget] : [],
    isLoading: false,
    error: null,
    refetchDrives: vi.fn(),
    refetchItems: vi.fn(),
  }),
}));
vi.mock("@/hooks/cloud/useCloudSearch", () => ({
  useCloudSearch: ({ query }: { query: string }) => ({
    drives: [drive],
    files: query.trim()
      ? [
          {
            ...budget,
            name: query === "Ledger" ? "Ledger.pdf" : "Budget.pdf",
            drive_id: query === "Ledger" ? "sales" : "finance",
            drive_name: query === "Ledger" ? "Sales" : "Finance",
            parent_path: "/Annual reports",
          },
        ]
      : [],
    isLoading: false,
    error: state.error,
    partial: state.partial,
    truncated: false,
    refetch: state.retry,
  }),
}));

beforeEach(() => {
  state.partial = false;
  state.error = false;
  vi.clearAllMocks();
});

function setup() {
  const onFilesSelected = vi.fn();
  const onClose = vi.fn();
  render(
    <CloudFilePicker
      isOpen
      provider="sharepoint"
      onClose={onClose}
      onFilesSelected={onFilesSelected}
      multiple
      maxFiles={3}
    />,
  );
  return { onFilesSelected, onClose };
}
function search(query: string) {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: query } });
}

describe("SharePoint file picker", () => {
  it("keeps cross-drive selections across searches and navigation, and submits canonical IDs", async () => {
    const { onFilesSelected } = setup();
    search("Budget");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Budget.pdf" }),
    );
    search("Ledger");
    expect(
      screen.queryByRole("checkbox", { name: "Budget.pdf" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Ledger.pdf" }),
    );
    expect(
      within(screen.getByRole("list", { name: "Selected files" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open drive" }));
    expect(screen.getByRole("checkbox", { name: "Select" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Select (2)" }));
    expect(onFilesSelected).toHaveBeenCalledWith([
      expect.objectContaining({ drive_id: "finance", item_id: "same-id" }),
      expect.objectContaining({ drive_id: "sales", item_id: "same-id" }),
    ]);
  });

  it("can remove a selection that is not in the current results", async () => {
    setup();
    search("Budget");
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Budget.pdf" }),
    );
    search("Ledger");
    await screen.findByRole("checkbox", { name: "Ledger.pdf" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Budget.pdf" }));
    expect(
      screen.queryByRole("list", { name: "Selected files" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select" })).toBeDisabled();
  });

  it("shows successful partial results without an unactionable warning or retry", async () => {
    state.partial = true;
    setup();
    search("Budget");
    await screen.findByRole("checkbox", { name: "Budget.pdf" });
    expect(
      screen.queryByText(/Some locations could not be searched/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("shows errors as errors rather than empty results", async () => {
    state.error = true;
    setup();
    search("Budget");
    await waitFor(() =>
      expect(screen.getByText(/Search failed/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/No matching drives/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledOnce();
  });
});
