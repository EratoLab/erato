import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the dependencies
vi.mock("@lingui/react", () => ({
  useLingui: () => ({
    _: (descriptor: { message: string }) => descriptor.message,
  }),
}));

vi.mock("@/lib/generated/v1betaApi/v1betaApiComponents", () => ({
  useSubmitMessageFeedback: vi.fn(),
}));

vi.mock("@/providers/FeatureConfigProvider", () => ({
  useMessageFeedbackFeature: vi.fn(),
}));

vi.mock("@/utils/debugLogger", () => ({
  createLogger: () => ({
    log: vi.fn(),
  }),
}));

import { useMessageFeedback } from "@/hooks/chat/useMessageFeedback";
import { useSubmitMessageFeedback } from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";

describe("useMessageFeedback", () => {
  const mockMutateAsync = vi.fn();
  const mockFeedbackConfig = {
    enabled: true,
    commentsEnabled: true,
    editTimeLimitSeconds: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mocks
    vi.mocked(useSubmitMessageFeedback).mockReturnValue({
      mutateAsync: mockMutateAsync,
      // Add other required mutation properties
      mutate: vi.fn(),
      reset: vi.fn(),
      data: undefined,
      error: null,
      isError: false,
      isIdle: true,
      isPending: false,
      isPaused: false,
      isSuccess: false,
      status: "idle",
      variables: undefined,
      failureCount: 0,
      failureReason: null,
      submittedAt: 0,
      context: undefined,
    } as ReturnType<typeof useSubmitMessageFeedback>);

    vi.mocked(useMessageFeedbackFeature).mockReturnValue(mockFeedbackConfig);
  });

  it("should initialize with closed dialog state", () => {
    const { result } = renderHook(() => useMessageFeedback());

    expect(result.current.feedbackDialogState).toEqual({
      isOpen: false,
      messageId: null,
      sentiment: null,
      mode: "create",
      initialComment: "",
      error: null,
    });
  });

  it("should return feedback config from provider", () => {
    const { result } = renderHook(() => useMessageFeedback());

    expect(result.current.feedbackConfig).toEqual(mockFeedbackConfig);
  });

  it("should submit feedback successfully", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "feedback-id",
      message_id: "message-123",
      sentiment: "positive",
      comment: null,
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useMessageFeedback());

    let submitResult: { success: boolean; errorType?: string } | undefined;
    await act(async () => {
      submitResult = await result.current.handleFeedbackSubmit(
        "message-123",
        "positive",
      );
    });

    expect(submitResult?.success).toBe(true);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
      body: {
        sentiment: "positive",
        comment: undefined,
      },
    });
  });

  it("should submit feedback with comment", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "feedback-id",
      message_id: "message-123",
      sentiment: "negative",
      comment: "Not helpful",
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useMessageFeedback());

    let submitResult: { success: boolean; errorType?: string } | undefined;
    await act(async () => {
      submitResult = await result.current.handleFeedbackSubmit(
        "message-123",
        "negative",
        "Not helpful",
      );
    });

    expect(submitResult?.success).toBe(true);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
      body: {
        sentiment: "negative",
        comment: "Not helpful", // Comment is passed through with type assertion
      },
    });
  });

  it("should handle feedback submission errors", async () => {
    mockMutateAsync.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useMessageFeedback());

    let submitResult: { success: boolean; errorType?: string } | undefined;
    await act(async () => {
      submitResult = await result.current.handleFeedbackSubmit(
        "message-123",
        "positive",
      );
    });

    expect(submitResult?.success).toBe(false);
  });

  it("should open feedback dialog", () => {
    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackDialog("message-123", "positive");
    });

    expect(result.current.feedbackDialogState).toEqual({
      isOpen: true,
      messageId: "message-123",
      sentiment: "positive",
      mode: "create",
      initialComment: "",
      error: null,
    });
  });

  it("should close feedback dialog and reset state", () => {
    const { result } = renderHook(() => useMessageFeedback());

    // First open the dialog
    act(() => {
      result.current.openFeedbackDialog("message-123", "positive");
    });

    expect(result.current.feedbackDialogState.isOpen).toBe(true);

    // Then close it
    act(() => {
      result.current.closeFeedbackDialog();
    });

    expect(result.current.feedbackDialogState).toEqual({
      isOpen: false,
      messageId: null,
      sentiment: null,
      mode: "create",
      initialComment: "",
      error: null,
    });
  });

  it("should handle feedback dialog submission", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "feedback-id",
      message_id: "message-123",
      sentiment: "negative",
      comment: "Needs improvement",
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useMessageFeedback());

    // Open dialog first
    act(() => {
      result.current.openFeedbackDialog("message-123", "negative");
    });

    // Submit with comment
    await act(async () => {
      await result.current.handleFeedbackDialogSubmit("Needs improvement");
    });

    // Should have called mutation
    expect(mockMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
      body: {
        sentiment: "negative",
        comment: "Needs improvement", // Comment is passed through
      },
    });

    // Should close dialog
    await waitFor(() => {
      expect(result.current.feedbackDialogState.isOpen).toBe(false);
    });
  });

  it("should not submit if dialog state is invalid", async () => {
    const { result } = renderHook(() => useMessageFeedback());

    // Try to submit without opening dialog
    await act(async () => {
      await result.current.handleFeedbackDialogSubmit("Some comment");
    });

    // Should not have called mutation
    expect(mockMutateAsync).not.toHaveBeenCalled();

    // Should still close dialog
    expect(result.current.feedbackDialogState.isOpen).toBe(false);
  });

  it("should trim whitespace from comments", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "feedback-id",
      message_id: "message-123",
      sentiment: "positive",
      comment: "Great",
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useMessageFeedback());

    await act(async () => {
      await result.current.handleFeedbackSubmit(
        "message-123",
        "positive",
        "  Great  ",
      );
    });

    // The implementation trims the comment before submission
    expect(mockMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
      body: {
        sentiment: "positive",
        comment: "Great", // Comment is trimmed and passed through
      },
    });
  });
});
