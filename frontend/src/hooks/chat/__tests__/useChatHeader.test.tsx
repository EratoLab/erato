import { skipToken } from "@tanstack/react-query";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatHeader } from "../useChatHeader";

import type { ChatDetail } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { ReactNode } from "react";

const mockUseChatDetail = vi.fn();
const mockUseGenerationStatusFor = vi.fn();

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useChatDetail: (...args: unknown[]) => mockUseChatDetail(...args),
}));

vi.mock("../store/generationStatusStore", () => ({
  useGenerationStatusFor: (...args: unknown[]) =>
    mockUseGenerationStatusFor(...args),
}));

vi.mock("@/providers/ChatProvider", () => ({
  useChatContext: () => ({ unarchiveChat: vi.fn() }),
}));

const renderHeader = (header: ReactNode) =>
  render(<MemoryRouter>{header}</MemoryRouter>);

const delegatedRun = (overrides: Partial<ChatDetail> = {}): ChatDetail => ({
  id: "run-1",
  title_resolved: "Summarize the numbers",
  is_pinned: false,
  mcp_write_tools_enabled: true,
  can_edit: true,
  assistant_id: "assistant-1",
  assistant_name: "Research Helper",
  provenance_kind: "delegation",
  origin_chat_id: "origin-1",
  origin_chat_title: "Quarterly planning",
  ...overrides,
});

describe("useChatHeader", () => {
  beforeEach(() => {
    mockUseChatDetail.mockReset();
    mockUseGenerationStatusFor.mockReset();
    mockUseGenerationStatusFor.mockReturnValue(undefined);
  });

  it("asks for the chat by id rather than reading a listing row", () => {
    mockUseChatDetail.mockReturnValue({ data: delegatedRun() });

    renderHook(() => useChatHeader("run-1"));

    expect(mockUseChatDetail).toHaveBeenCalledWith({
      pathParams: { chatId: "run-1" },
    });
  });

  it("renders a header for a delegated run and leaves its composer open", () => {
    mockUseChatDetail.mockReturnValue({ data: delegatedRun() });

    const { result } = renderHook(() => useChatHeader("run-1"));

    expect(result.current.header).not.toBeNull();
    expect(result.current.composerLocked).toBe(false);
  });

  it("renders nothing for a chat the user started themselves", () => {
    mockUseChatDetail.mockReturnValue({
      data: delegatedRun({ provenance_kind: undefined }),
    });

    const { result } = renderHook(() => useChatHeader("chat-1"));

    expect(result.current.header).toBeNull();
    expect(result.current.composerLocked).toBe(false);
  });

  it("closes an archived chat's composer and offers the way back", () => {
    mockUseChatDetail.mockReturnValue({
      data: delegatedRun({
        id: "chat-1",
        provenance_kind: undefined,
        archived_at: "2026-08-19T10:00:00Z",
      }),
    });

    const { result } = renderHook(() => useChatHeader("chat-1"));
    expect(result.current.composerLocked).toBe(true);

    renderHeader(result.current.header);
    expect(screen.getByTestId("archived-chat-notice")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Unarchive" }),
    ).toBeInTheDocument();
  });

  it("leaves the composer open while the chat has not loaded", () => {
    mockUseChatDetail.mockReturnValue({ data: undefined });

    const { result } = renderHook(() => useChatHeader("run-1"));

    expect(result.current.header).toBeNull();
    expect(result.current.composerLocked).toBe(false);
  });

  it("closes the composer while the delegate is still writing the run", () => {
    mockUseChatDetail.mockReturnValue({ data: delegatedRun() });
    mockUseGenerationStatusFor.mockReturnValue({
      kind: "running",
      startedAt: "2026-08-19T10:00:00Z",
      localSeenAt: 0,
    });

    const { result } = renderHook(() => useChatHeader("run-1"));

    expect(result.current.composerLocked).toBe(true);
  });

  it("leaves the composer alone while an adopted run streams the owner's own turn", () => {
    mockUseChatDetail.mockReturnValue({
      data: delegatedRun({ adopted_at: "2026-08-19T09:00:00Z" }),
    });
    mockUseGenerationStatusFor.mockReturnValue({
      kind: "running",
      startedAt: "2026-08-19T10:00:00Z",
      localSeenAt: 0,
    });

    const { result } = renderHook(() => useChatHeader("run-1"));

    expect(result.current.composerLocked).toBe(false);
  });

  it("gives a run the archive cascade took one notice and no way back", () => {
    mockUseChatDetail.mockReturnValue({
      data: delegatedRun({ archived_at: "2026-08-19T10:00:00Z" }),
    });

    const { result } = renderHook(() => useChatHeader("run-1"));
    expect(result.current.composerLocked).toBe(true);

    renderHeader(result.current.header);
    expect(screen.getByTestId("delegated-run-header")).toBeInTheDocument();
    expect(screen.getAllByTestId("archived-chat-notice")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Unarchive" })).toBeNull();
  });

  it("does not fetch without a chat id", () => {
    mockUseChatDetail.mockReturnValue({ data: undefined });

    renderHook(() => useChatHeader(undefined));

    expect(mockUseChatDetail).toHaveBeenCalledWith(skipToken);
  });
});
