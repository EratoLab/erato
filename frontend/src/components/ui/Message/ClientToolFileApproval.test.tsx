import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useConfirmationRegistryStore } from "@/hooks/chat/store/confirmationRegistryStore";
import { useClientToolFileApproval } from "@/hooks/chat/useClientToolFileApproval";
import { fetchProfile } from "@/lib/generated/v1betaApi/v1betaApiComponents";

import { ClientToolFileApprovals } from "./ClientToolFileApproval";

import type { UserProfile } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  fetchProfile: vi.fn(),
}));
vi.mock("../FileUpload/AttachmentTile", () => ({
  AttachmentTile: ({
    file,
    selection,
    onActivate,
  }: {
    file: File;
    selection: { selected: boolean; onToggle: () => void };
    onActivate: () => void;
  }) => (
    <div>
      <label>
        <input
          type="checkbox"
          checked={selection.selected}
          onChange={selection.onToggle}
        />
        {file.name}
      </label>
      <button onClick={onActivate}>Preview {file.name}</button>
    </div>
  ),
}));
vi.mock("../FilePreview/FilePreviewContent", () => ({
  FilePreviewContent: ({ url }: { url: string }) => (
    <div data-testid="preview">{url}</div>
  ),
}));
let approveFiles: ReturnType<typeof useClientToolFileApproval>["approveFiles"];
const context = { chatId: "chat", messageId: "message", toolCallId: "call" };
function Harness({ messageId = "message" }: { messageId?: string }) {
  const approval = useClientToolFileApproval();
  approveFiles = approval.approveFiles;
  return <ClientToolFileApprovals messageId={messageId} />;
}
const files = [
  new File(["first"], "first.txt"),
  new File(["second"], "second.txt"),
];
beforeEach(() => {
  vi.mocked(fetchProfile).mockReset();
  vi.mocked(fetchProfile).mockResolvedValue({
    client_tool_file_approval: "ask",
  } as UserProfile);
});
it("previews local bytes and returns only selected files", async () => {
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:local-preview");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  render(<Harness />);
  let result!: Promise<ReadonlySet<File>>;
  await act(async () => {
    result = approveFiles(files, context);
  });
  fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
  expect(create).toHaveBeenCalledWith(files[0]);
  expect(screen.getByTestId("preview")).toHaveTextContent("blob:local-preview");
  fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
  expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  expect(revoke).toHaveBeenCalledWith("blob:local-preview");
  expect(screen.getByRole("checkbox", { name: "first.txt" })).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Preview first.txt" }));
  expect(screen.getByTestId("preview")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview second.txt" }));
  expect(create).toHaveBeenLastCalledWith(files[1]);
  fireEvent.click(screen.getByRole("checkbox", { name: "second.txt" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Upload selected files" }),
  );
  expect(await result).toEqual(new Set([files[0]]));
  expect(revoke).toHaveBeenCalledWith("blob:local-preview");
});
it.each(["never_allow", "always_allow"] as const)(
  "honors backend policy %s without prompting",
  async (policy) => {
    vi.mocked(fetchProfile).mockResolvedValue({
      client_tool_file_approval: policy,
    } as UserProfile);
    render(<Harness />);
    expect(await approveFiles(files, context)).toEqual(
      new Set(policy === "always_allow" ? files : []),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  },
);
it.each(["abort", "unmount", "reject"])(
  "rejects pending files on %s",
  async (mode) => {
    const controller = new AbortController();
    const { unmount } = render(<Harness />);
    let result!: Promise<ReadonlySet<File>>;
    await act(async () => {
      result = approveFiles(files, { ...context, signal: controller.signal });
    });
    await act(async () => {
      if (mode === "abort") controller.abort();
      else if (mode === "unmount") unmount();
      else fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
    });
    expect(await result).toEqual(new Set());
  },
);
it("fails closed when the backend preference cannot be read", async () => {
  vi.mocked(fetchProfile).mockRejectedValue(new Error("offline"));
  render(<Harness />);
  await expect(approveFiles(files, context)).rejects.toThrow("offline");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps approvals with their originating messages when navigating and holds the queue", async () => {
  const { rerender } = render(<Harness />);
  let first!: Promise<ReadonlySet<File>>;
  let second!: Promise<ReadonlySet<File>>;
  await act(async () => {
    first = approveFiles(files, context);
    second = approveFiles([files[0]], {
      ...context,
      messageId: "second-message",
      toolCallId: "second-call",
    });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "second.txt" }));
  rerender(<Harness messageId="unrelated-message" />);
  expect(
    screen.queryByTestId("client-tool-file-approval"),
  ).not.toBeInTheDocument();
  rerender(<Harness messageId="second-message" />);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Upload selected files" }),
  );
  expect(await second).toEqual(new Set([files[0]]));
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(true);
  rerender(<Harness />);
  expect(
    screen.getByRole("checkbox", { name: "second.txt" }),
  ).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Reject all" }));
  expect(await first).toEqual(new Set());
  expect(useConfirmationRegistryStore.getState().hasPending("chat")).toBe(
    false,
  );
});
