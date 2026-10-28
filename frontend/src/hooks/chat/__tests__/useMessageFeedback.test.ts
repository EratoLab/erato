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
  useDeleteMessageFeedback: vi.fn(),
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
import {
  useDeleteMessageFeedback,
  useSubmitMessageFeedback,
} from "@/lib/generated/v1betaApi/v1betaApiComponents";
import { useMessageFeedbackFeature } from "@/providers/FeatureConfigProvider";

describe("useMessageFeedback", () => {
  const mockMutateAsync = vi.fn();
  const mockDeleteMutateAsync = vi.fn();
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
    });

    vi.mocked(useDeleteMessageFeedback).mockReturnValue({
      mutateAsync: mockDeleteMutateAsync,
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
    });

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

  it("keeps the comment dialog open with an error when the submit fails for another reason", async () => {
    mockMutateAsync.mockRejectedValue({ status: 500 });

    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackDialog("message-123", "negative");
    });

    await act(async () => {
      await result.current.handleFeedbackDialogSubmit("Needs improvement");
    });

    expect(result.current.feedbackDialogState.isOpen).toBe(true);
    expect(result.current.feedbackDialogState.error).toBe(
      "Failed to submit feedback. Please try again.",
    );
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

  it("should remove feedback successfully", async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    const onFeedbackSuccess = vi.fn();

    const { result } = renderHook(() =>
      useMessageFeedback({ onFeedbackSuccess }),
    );

    let removeResult: { success: boolean; errorType?: string } | undefined;
    await act(async () => {
      removeResult = await result.current.handleFeedbackRemove("message-123");
    });

    expect(removeResult?.success).toBe(true);
    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
    });
    expect(onFeedbackSuccess).toHaveBeenCalledWith("message-123");
  });

  it("should report time limit errors when removing feedback", async () => {
    mockDeleteMutateAsync.mockRejectedValue({ status: 403 });

    const { result } = renderHook(() => useMessageFeedback());

    let removeResult: { success: boolean; errorType?: string } | undefined;
    await act(async () => {
      removeResult = await result.current.handleFeedbackRemove("message-123");
    });

    expect(removeResult?.success).toBe(false);
    expect(removeResult?.errorType).toBe("time_limit_exceeded");
  });

  it("should close the view dialog after removing its feedback", async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackViewDialog("message-123", {
        id: "feedback-id",
        sentiment: "positive",
        comment: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    expect(result.current.feedbackViewDialogState.isOpen).toBe(true);

    await act(async () => {
      await result.current.handleFeedbackViewDialogRemove();
    });

    expect(mockDeleteMutateAsync).toHaveBeenCalledWith({
      pathParams: { messageId: "message-123" },
    });
    expect(result.current.feedbackViewDialogState.isOpen).toBe(false);
  });

  it("sends one DELETE when Remove is clicked again while the first is pending", async () => {
    let resolveDelete: (value: undefined) => void = () => {};
    mockDeleteMutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );

    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackViewDialog("message-123", {
        id: "feedback-id",
        sentiment: "positive",
        comment: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.handleFeedbackViewDialogRemove();
      second = result.current.handleFeedbackViewDialogRemove();
    });

    expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1);
    expect(result.current.feedbackViewDialogState.isRemoving).toBe(true);

    await act(async () => {
      resolveDelete(undefined);
      await Promise.all([first, second]);
    });

    expect(result.current.feedbackViewDialogState.isOpen).toBe(false);
    expect(result.current.feedbackViewDialogState.isRemoving).toBe(false);
  });

  it("leaves another message's view dialog alone when a removal lands late", async () => {
    let rejectDelete: (reason: unknown) => void = () => {};
    mockDeleteMutateAsync.mockReturnValue(
      new Promise((_, reject) => {
        rejectDelete = reject;
      }),
    );
    const feedback = {
      id: "feedback-id",
      sentiment: "positive" as const,
      comment: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackViewDialog("message-123", feedback);
    });
    let removal: Promise<void> | undefined;
    act(() => {
      removal = result.current.handleFeedbackViewDialogRemove();
    });
    act(() => {
      result.current.closeFeedbackViewDialog();
      result.current.openFeedbackViewDialog("message-456", feedback);
    });

    await act(async () => {
      rejectDelete({ status: 500 });
      await removal;
    });

    expect(result.current.feedbackViewDialogState).toMatchObject({
      isOpen: true,
      messageId: "message-456",
      error: null,
      isRemoving: false,
    });
  });

  it("leaves another message's comment dialog open when a submit lands late", async () => {
    let resolveSubmit: (value: undefined) => void = () => {};
    mockMutateAsync.mockReturnValue(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackDialog("message-123", "negative");
    });
    let submit: Promise<void> | undefined;
    act(() => {
      submit = result.current.handleFeedbackDialogSubmit("Needs work");
    });
    act(() => {
      result.current.closeFeedbackDialog();
      result.current.openFeedbackDialog("message-456", "positive");
    });

    await act(async () => {
      resolveSubmit(undefined);
      await submit;
    });

    expect(result.current.feedbackDialogState).toMatchObject({
      isOpen: true,
      messageId: "message-456",
    });
  });

  it("should show an error in the view dialog when removal fails", async () => {
    mockDeleteMutateAsync.mockRejectedValue({ status: 403 });

    const { result } = renderHook(() => useMessageFeedback());

    act(() => {
      result.current.openFeedbackViewDialog("message-123", {
        id: "feedback-id",
        sentiment: "negative",
        comment: "Some comment",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });

    await act(async () => {
      await result.current.handleFeedbackViewDialogRemove();
    });

    expect(result.current.feedbackViewDialogState.isOpen).toBe(true);
    expect(result.current.feedbackViewDialogState.error).toBeTruthy();
    expect(result.current.feedbackViewDialogState.isRemoving).toBe(false);
  });
});
